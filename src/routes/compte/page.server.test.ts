import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANONYMIZED_DISPLAY_NAME, anonymizedEmail } from '$lib/server/account';
import {
  LOGIN_FAILED_MESSAGE,
  MAX_LOGIN_FAILURES,
  PASSWORD_MAX_LENGTH,
  SESSION_COOKIE_NAME,
  createBookseller,
  createBorrower,
  createSession,
  recordLoginFailure,
  validateSessionToken,
  type AuthUser
} from '$lib/server/auth';
import { closeDb, getDb } from '$lib/server/db';
import ComptePage from './+page.svelte';
import { actions, load } from './+page.server';

type Failure = { status: number; data: { message: string; passwordError?: boolean } };
type UserRow = {
  email: string;
  display_name: string;
  password_hash: string;
  role: string;
  deleted_at: number | null;
};

const PASSWORD = 'mot de passe solide';
const BORROWER_EMAIL = 'lecteur@example.fr';
const HOSTILE_NAME = '<script>alert(1)</script> Robert\'); DROP TABLE users;--';
// Le module de route n'exporte que `load` et `actions` : le libellé attendu est
// recopié ici, ce qui fige aussi la formulation du refus 409.
const ACTIVE_LOAN_MESSAGE =
  'Vous avez encore un prêt en cours. Rendez vos livres à la librairie avant de supprimer votre compte.';
// 18 septembre 2026, 12 h UTC = 14 h à Paris (heure d'été).
const T0 = Date.UTC(2026, 8, 18, 12, 0, 0);

/** `Blob` admis pour envoyer une valeur non textuelle, comme le ferait un fichier. */
type FormFields = Record<string, string | Blob>;

function fakeEvent(path: string, fields: FormFields = {}, user: AuthUser | null = null) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const url = new URL(path, 'http://localhost');
  const cookies = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  const request = new Request(url, { method: 'POST', body });
  return { event: { request, url, cookies, locals: { user } }, cookies };
}

/** Exécute une action ou un load et capture la redirection levée, le cas échéant. */
async function outcomeOf(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (thrown) {
    if (isRedirect(thrown)) return thrown;
    throw thrown;
  }
}

function asFailure(outcome: unknown): Failure {
  if (!isActionFailure(outcome)) throw new Error('Échec d’action attendu.');
  return outcome as unknown as Failure;
}

function asRedirect(outcome: unknown) {
  if (!isRedirect(outcome)) throw new Error('Redirection attendue.');
  return outcome;
}

async function borrower(email = BORROWER_EMAIL, displayName = 'Lecteur'): Promise<AuthUser> {
  const created = await createBorrower(getDb(), { email, displayName, password: PASSWORD });
  if (!created.ok) throw new Error('Compte emprunteur de test non créé.');
  return created.user;
}

async function bookseller(email = 'libraire@example.fr'): Promise<AuthUser> {
  const created = await createBookseller(getDb(), {
    email,
    displayName: 'Jeanne',
    password: PASSWORD
  });
  if (!created.ok) throw new Error('Compte libraire de test non créé.');
  return created.user;
}

/** Un livre neuf par prêt : l'index d'unicité n'autorise qu'un prêt actif par livre. */
function addBook(): number {
  const inserted = getDb()
    .prepare("INSERT INTO books (title, author) VALUES ('Le Rivage des Syrtes', 'Julien Gracq')")
    .run();
  return Number(inserted.lastInsertRowid);
}

function addLoan(userId: number, returnedOn: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on)
       VALUES (?, ?, '2026-01-05', '2026-02-04', ?)`
    )
    .run(addBook(), userId, returnedOn);
}

function addSale(booksellerId: number): void {
  getDb()
    .prepare(
      `INSERT INTO sales (book_id, bookseller_id, quantity, unit_price_cents, total_cents, sold_on)
       VALUES (?, ?, 1, 1200, 1200, '2026-09-18')`
    )
    .run(addBook(), booksellerId);
}

function userRow(id: number): UserRow {
  return getDb()
    .prepare('SELECT email, display_name, password_hash, role, deleted_at FROM users WHERE id = ?')
    .get(id) as UserRow;
}

function countOf(sql: string, ...params: unknown[]): number {
  return (getDb().prepare(sql).get(...params) as { n: number }).n;
}

function eventTypes(): string[] {
  return (getDb().prepare('SELECT type FROM security_events').all() as { type: string }[]).map(
    (row) => row.type
  );
}

async function remove(user: AuthUser, fields: FormFields) {
  const { event, cookies } = fakeEvent('/compte', fields, user);
  const outcome = await outcomeOf(() =>
    actions.supprimer(event as unknown as Parameters<typeof actions.supprimer>[0])
  );
  return { outcome, cookies };
}

function loadFor(user: AuthUser | null, path = '/compte') {
  const { event } = fakeEvent(path, {}, user);
  return outcomeOf(() => load(event as unknown as Parameters<typeof load>[0]));
}

function renderPage(
  data: { displayName: string; role: string; activeLoanCount: number; hasActiveLoan: boolean },
  form: unknown = null
): string {
  return render(ComptePage, { props: { data, form } as never }).body;
}

afterEach(() => {
  vi.useRealTimers();
  closeDb();
});

describe('load /compte', () => {
  it('renvoie le nom affiché des deux rôles sans e-mail ni identifiant', async () => {
    const reader = await borrower();
    const seller = await bookseller();
    addLoan(reader.id, null);
    addLoan(reader.id, null);

    const readerData = await loadFor(reader);
    const sellerData = await loadFor(seller);

    expect(readerData).toEqual({
      displayName: 'Lecteur',
      role: 'borrower',
      activeLoanCount: 2,
      hasActiveLoan: true
    });
    expect(sellerData).toEqual({
      displayName: 'Jeanne',
      role: 'bookseller',
      activeLoanCount: 0,
      hasActiveLoan: false
    });
    const serialized = JSON.stringify([readerData, sellerData]);
    expect(serialized).not.toContain(BORROWER_EMAIL);
    expect(serialized).not.toContain('libraire@example.fr');
    expect(serialized).not.toContain(`"id"`);
  });

  it('affiche le nombre exact de prêts en cours pour un, puis plusieurs', async () => {
    const reader = await borrower();

    const noLoan = await loadFor(reader);
    expect(noLoan).toEqual({
      displayName: 'Lecteur',
      role: 'borrower',
      activeLoanCount: 0,
      hasActiveLoan: false
    });

    addLoan(reader.id, null);
    const oneLoan = await loadFor(reader);
    expect(oneLoan).toEqual({
      displayName: 'Lecteur',
      role: 'borrower',
      activeLoanCount: 1,
      hasActiveLoan: true
    });

    addLoan(reader.id, null);
    addLoan(reader.id, null);
    const threeLoans = await loadFor(reader);
    expect(threeLoans).toEqual({
      displayName: 'Lecteur',
      role: 'borrower',
      activeLoanCount: 3,
      hasActiveLoan: true
    });
  });

  it('redirige un visiteur anonyme en 303 vers /connexion', async () => {
    const outcome = await loadFor(null);

    expect(asRedirect(outcome)).toMatchObject({ status: 303, location: '/connexion' });
  });

  it('ne lit rien de l’URL : un GET portant des paramètres de suppression n’écrit rien', async () => {
    const reader = await borrower();
    const before = userRow(reader.id);

    const data = await loadFor(
      reader,
      `/compte?supprimer=1&password=${encodeURIComponent(PASSWORD)}&confirm=oui`
    );

    expect(data).toEqual({
      displayName: 'Lecteur',
      role: 'borrower',
      activeLoanCount: 0,
      hasActiveLoan: false
    });
    expect(userRow(reader.id)).toEqual(before);
    expect(countOf('SELECT count(*) AS n FROM security_events')).toBe(0);
  });
});

describe('action ?/supprimer : refus', () => {
  it('redirige un visiteur anonyme sans rien écrire', async () => {
    const reader = await borrower();
    const { event } = fakeEvent('/compte', { password: PASSWORD }, null);

    const outcome = await outcomeOf(() =>
      actions.supprimer(event as unknown as Parameters<typeof actions.supprimer>[0])
    );

    expect(asRedirect(outcome)).toMatchObject({ status: 303, location: '/connexion' });
    expect(userRow(reader.id).deleted_at).toBeNull();
  });

  it('refuse un mot de passe vide, absent, non textuel ou trop long sans toucher au compte', async () => {
    const reader = await borrower();

    const cases: FormFields[] = [
      { password: '' },
      {},
      { password: new Blob([PASSWORD]) },
      { password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) },
      { password: 'x'.repeat(100_000) }
    ];
    for (const fields of cases) {
      const { outcome } = await remove(reader, fields);
      const failure = asFailure(outcome);
      expect(failure.status).toBe(400);
      expect(failure.data.message).toBe(LOGIN_FAILED_MESSAGE);
    }

    expect(userRow(reader.id).deleted_at).toBeNull();
    // Aucun calcul Argon2 n'a eu lieu : ces refus ne comptent pas comme échecs.
    expect(countOf('SELECT count(*) AS n FROM login_failures')).toBe(0);
    expect(eventTypes()).toEqual([]);
  });

  it('refuse un mauvais mot de passe en 400 sans renvoyer la saisie', async () => {
    const reader = await borrower();

    const { outcome, cookies } = await remove(reader, { password: 'mauvais mot de passe' });

    const failure = asFailure(outcome);
    expect(failure.status).toBe(400);
    expect(failure.data.message).toBe(LOGIN_FAILED_MESSAGE);
    expect(failure.data.passwordError).toBe(true);
    expect(JSON.stringify(failure.data)).not.toContain('mauvais mot de passe');
    expect(cookies.delete).not.toHaveBeenCalled();
    expect(userRow(reader.id).deleted_at).toBeNull();
    expect(eventTypes()).toEqual(['login_failure']);
  }, 30_000);

  it('refuse la suppression en 409 tant qu’un prêt est en cours', async () => {
    const reader = await borrower();
    const token = createSession(getDb(), reader.id).token;
    addLoan(reader.id, null);
    const before = userRow(reader.id);

    const { outcome, cookies } = await remove(reader, { password: PASSWORD });

    const failure = asFailure(outcome);
    expect(failure.status).toBe(409);
    expect(failure.data.message).toBe(ACTIVE_LOAN_MESSAGE);
    expect(failure.data.passwordError).toBe(false);
    expect(userRow(reader.id)).toEqual(before);
    expect(validateSessionToken(getDb(), token)).not.toBeNull();
    expect(countOf('SELECT count(*) AS n FROM loans WHERE returned_on IS NULL')).toBe(1);
    expect(countOf('SELECT count(*) AS n FROM login_failures')).toBe(0);
    expect(eventTypes()).not.toContain('account_deleted');
    expect(cookies.delete).not.toHaveBeenCalled();
  });

  it('refuse en 429 pendant un blocage et annonce l’heure de fin à Paris', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const reader = await borrower();
    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES; attempt++) {
      recordLoginFailure(getDb(), BORROWER_EMAIL);
    }

    const { outcome, cookies } = await remove(reader, { password: PASSWORD });

    const failure = asFailure(outcome);
    expect(failure.status).toBe(429);
    expect(failure.data.message).toBe('Trop de tentatives. Réessayez à partir de 14 h 15.');
    expect(failure.data.passwordError).toBe(false);
    expect(userRow(reader.id).deleted_at).toBeNull();
    expect(cookies.delete).not.toHaveBeenCalled();
    // Le compteur n'est pas incrémenté : le mot de passe n'a pas été vérifié.
    expect(countOf('SELECT "count" AS n FROM login_failures WHERE email = ?', BORROWER_EMAIL)).toBe(
      MAX_LOGIN_FAILURES
    );
    expect(eventTypes()).toEqual(['lockout_attempt']);
  });
});

describe('action ?/supprimer : suppression', () => {
  it('anonymise le compte de la session, ferme toutes ses sessions et redirige', async () => {
    const reader = await borrower();
    const first = createSession(getDb(), reader.id).token;
    const second = createSession(getDb(), reader.id).token;
    addLoan(reader.id, '2026-01-20');

    const { outcome, cookies } = await remove(reader, { password: PASSWORD });

    expect(asRedirect(outcome)).toMatchObject({ status: 303, location: '/compte/supprime' });
    expect(cookies.delete).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({ path: '/', httpOnly: true, secure: true, sameSite: 'lax' })
    );

    const row = userRow(reader.id);
    expect(row.email).toBe(anonymizedEmail(reader.id));
    expect(row.display_name).toBe(ANONYMIZED_DISPLAY_NAME);
    expect(row.role).toBe('borrower');
    expect(row.deleted_at).not.toBeNull();
    expect(countOf('SELECT count(*) AS n FROM sessions WHERE user_id = ?', reader.id)).toBe(0);
    expect(validateSessionToken(getDb(), first)).toBeNull();
    expect(validateSessionToken(getDb(), second)).toBeNull();
    // Le prêt rendu reste rattaché à la ligne anonymisée.
    expect(countOf('SELECT count(*) AS n FROM loans WHERE user_id = ?', reader.id)).toBe(1);
    expect(eventTypes()).toContain('account_deleted');
  }, 30_000);

  it('supprime aussi un compte libraire en conservant ses ventes', async () => {
    const seller = await bookseller();
    createSession(getDb(), seller.id);
    addSale(seller.id);

    const { outcome } = await remove(seller, { password: PASSWORD });

    expect(asRedirect(outcome)).toMatchObject({ status: 303, location: '/compte/supprime' });
    const row = userRow(seller.id);
    expect(row.display_name).toBe(ANONYMIZED_DISPLAY_NAME);
    expect(row.role).toBe('bookseller');
    expect(countOf('SELECT count(*) AS n FROM sales WHERE bookseller_id = ?', seller.id)).toBe(1);
    expect(countOf('SELECT count(*) AS n FROM sessions WHERE user_id = ?', seller.id)).toBe(0);
  }, 30_000);

  it('traite le compte de la session malgré des champs userId, email et role hostiles', async () => {
    const reader = await borrower();
    const victim = await borrower('victime@example.fr', 'Victime');
    const victimBefore = userRow(victim.id);

    const { outcome } = await remove(reader, {
      password: PASSWORD,
      userId: String(victim.id),
      email: 'victime@example.fr',
      role: 'bookseller'
    });

    expect(asRedirect(outcome)).toMatchObject({ status: 303, location: '/compte/supprime' });
    expect(userRow(reader.id).deleted_at).not.toBeNull();
    expect(userRow(reader.id).role).toBe('borrower');
    expect(userRow(victim.id)).toEqual(victimBefore);
  }, 30_000);
});

describe('rendu de /compte', () => {
  it('rend un nom affiché hostile comme du texte et sépare l’action irréversible', () => {
    const body = renderPage({
      displayName: HOSTILE_NAME,
      role: 'borrower',
      activeLoanCount: 0,
      hasActiveLoan: false
    });

    expect(body).not.toContain('<script');
    expect(body).toMatch(/&lt;script(>|&gt;)alert\(1\)&lt;\/script(>|&gt;)/);
    expect(body).toContain('DROP TABLE users;--');
    expect(body).toContain('Action irréversible');
    expect(body).toContain('Supprimer définitivement mon compte');
    expect(body).toContain('action="?/supprimer"');
    expect(body).toContain('method="POST"');
    expect(body).toContain('for="password"');
    expect(body).toContain('id="password-hint"');
    // Le nom affiché n'a pas d'attribut à lui : rien d'hostile n'entre dans un href.
    expect(body).not.toContain('href="<');
  });

  it('relie le message d’erreur 400 au champ mot de passe', () => {
    const body = renderPage(
      { displayName: 'Lecteur', role: 'borrower', activeLoanCount: 0, hasActiveLoan: false },
      { message: LOGIN_FAILED_MESSAGE, passwordError: true }
    );

    expect(body).toContain('notice--error');
    expect(body).toContain('id="password-error"');
    expect(body).toMatch(/class="field-error[^"]*"[^>]*id="password-error"/);
    expect(body).toContain('aria-invalid="true"');
    expect(body).toContain('aria-describedby="password-hint password-error"');
    expect(body).toContain(LOGIN_FAILED_MESSAGE);
  });

  it('n’attribue pas l’erreur au champ pour un refus 409 ou 429', () => {
    const refused = renderPage(
      { displayName: 'Lecteur', role: 'borrower', activeLoanCount: 1, hasActiveLoan: true },
      { message: ACTIVE_LOAN_MESSAGE, passwordError: false }
    );
    expect(refused).toContain('notice--error');
    expect(refused).toContain(ACTIVE_LOAN_MESSAGE);
    expect(refused).not.toContain('aria-invalid');
    expect(refused).not.toContain('password-error');
    // Le refus est appliqué par le serveur ; le bouton reste dans l'ordre de tabulation.
    expect(refused).toContain('aria-disabled="true"');
    expect(refused).not.toMatch(/<button[^>]*\sdisabled/);

    const locked = renderPage(
      { displayName: 'Lecteur', role: 'borrower', activeLoanCount: 0, hasActiveLoan: false },
      { message: 'Trop de tentatives. Réessayez à partir de 14 h 15.', passwordError: false }
    );
    expect(locked).toContain('Réessayez à partir de 14 h 15.');
    expect(locked).not.toContain('aria-invalid');
  });

  it('annonce au libraire que ses ventes sont conservées', () => {
    const body = renderPage({
      displayName: 'Jeanne',
      role: 'bookseller',
      activeLoanCount: 0,
      hasActiveLoan: false
    });

    expect(body).toContain('Libraire');
    expect(body).toContain('les ventes que vous avez enregistrées');
    expect(body).toContain('Supprimer définitivement mon compte');
  });

  it('affiche « Aucun » à 0 prêt, le nombre exact à 1 et à plusieurs prêts en cours', () => {
    const none = renderPage({
      displayName: 'Lecteur',
      role: 'borrower',
      activeLoanCount: 0,
      hasActiveLoan: false
    });
    expect(none).toContain('Aucun');
    expect(none).not.toContain('voir mes prêts');

    const one = renderPage({
      displayName: 'Lecteur',
      role: 'borrower',
      activeLoanCount: 1,
      hasActiveLoan: true
    });
    expect(one).toMatch(/\b1\s*—/);
    expect(one).toContain('voir mes prêts');
    expect(one).not.toContain('Au moins un');

    const many = renderPage({
      displayName: 'Lecteur',
      role: 'borrower',
      activeLoanCount: 3,
      hasActiveLoan: true
    });
    expect(many).toMatch(/\b3\s*—/);
    expect(many).toContain('voir mes prêts');
    expect(many).not.toContain('Au moins un');
  });
});
