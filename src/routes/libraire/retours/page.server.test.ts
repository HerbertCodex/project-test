import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '$lib/server/auth';
import { BOOKSELLER_ONLY_MESSAGE, addBook } from '$lib/server/catalogue';
import { closeDb, getDb } from '$lib/server/db';
import { BORROWER_ONLY_MESSAGE } from '$lib/server/loans';
import { actions, load } from './+page.server';

type ActiveLoan = {
  id: number;
  title: string;
  borrowerName: string;
  dueOn: { iso: string; label: string };
  overdue: boolean;
};
type LoadData = { loans: ActiveLoan[]; page: number; pageSize: number; totalItems: number; totalPages: number };

function insertUser(email: string, role: Role): AuthUser {
  const displayName = `Compte ${role}`;
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, 'hash-factice', ?, 0)`
    )
    .run(email, displayName, role);
  return { id: Number(result.lastInsertRowid), email, displayName, role };
}

function bookseller(): AuthUser {
  return insertUser('libraire@example.fr', 'bookseller');
}

function borrower(): AuthUser {
  return insertUser('lecteur@example.fr', 'borrower');
}

function createBook(title: string): number {
  const created = addBook(getDb(), { title, author: 'Auteur' });
  if (!created.ok) throw new Error('Livre de test non créé.');
  return created.book.id;
}

function insertLoan(bookId: number, userId: number, borrowedOn: string, dueOn: string): number {
  const result = getDb()
    .prepare('INSERT INTO loans (book_id, user_id, borrowed_on, due_on) VALUES (?, ?, ?, ?)')
    .run(bookId, userId, borrowedOn, dueOn);
  return Number(result.lastInsertRowid);
}

function loanRow(loanId: number): { returned_on: string | null } {
  return getDb().prepare('SELECT returned_on FROM loans WHERE id = ?').get(loanId) as {
    returned_on: string | null;
  };
}

/** Exécute un load ou une action et capture la redirection ou l'erreur HTTP levée. */
async function outcomeOf(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (thrown) {
    if (isRedirect(thrown) || isHttpError(thrown)) return thrown;
    throw thrown;
  }
}

function loadAs(user: AuthUser | null, search = ''): Promise<unknown> {
  const url = new URL(`http://localhost/libraire/retours${search}`);
  return outcomeOf(() => load({ url, locals: { user } } as unknown as Parameters<typeof load>[0]));
}

function returnAs(user: AuthUser | null, fields: Record<string, string>): Promise<unknown> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const url = new URL('http://localhost/libraire/retours');
  const event = { request: new Request(url, { method: 'POST', body }), url, locals: { user } };
  return outcomeOf(() => actions.default(event as unknown as Parameters<typeof actions.default>[0]));
}

function asFailure(outcome: unknown): { status: number } {
  if (!isActionFailure(outcome)) throw new Error('Échec d’action attendu.');
  return outcome as unknown as { status: number };
}

function expectForbidden(outcome: unknown, message = BOOKSELLER_ONLY_MESSAGE) {
  if (!isHttpError(outcome)) throw new Error('Erreur HTTP attendue.');
  expect(outcome.status).toBe(403);
  expect(outcome.body.message).toBe(message);
}

function expectLoginRedirect(outcome: unknown) {
  if (!isRedirect(outcome)) throw new Error('Redirection attendue.');
  expect(outcome.status).toBe(303);
  expect(outcome.location).toBe('/connexion');
}

afterEach(() => {
  closeDb();
});

describe('pagination de /libraire/retours', () => {
  it('pagine à 25 lignes avec un ordre total et stable entre deux pages', async () => {
    const seller = bookseller();
    const reader = borrower();
    for (let i = 0; i < 30; i++) {
      const bookId = createBook(`Livre ${String(i).padStart(2, '0')}`);
      const month = String(2 + Math.floor(i / 20)).padStart(2, '0');
      const day = String(1 + (i % 20)).padStart(2, '0');
      insertLoan(bookId, reader.id, '2026-01-01', `2026-${month}-${day}`);
    }

    const first = (await loadAs(seller, '?page=1')) as LoadData;
    const second = (await loadAs(seller, '?page=2')) as LoadData;

    expect(first.loans).toHaveLength(25);
    expect(second.loans).toHaveLength(5);
    expect(first.totalItems).toBe(30);
    expect(first.totalPages).toBe(2);
    const firstIds = first.loans.map((loan) => loan.id);
    const secondIds = second.loans.map((loan) => loan.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
  });

  it.each(['0', '999', 'abc', '1.5'])(
    '?page=%s répond avec un contenu borné, sans erreur',
    async (page) => {
      const seller = bookseller();
      const reader = borrower();
      const bookId = createBook('Germinal');
      insertLoan(bookId, reader.id, '2026-01-01', '2026-01-31');

      const outcome = (await loadAs(seller, `?page=${page}`)) as LoadData;

      expect(outcome.page).toBe(1);
      expect(outcome.loans).toHaveLength(1);
    }
  );
});

describe('action de retour sur la page affichée', () => {
  it('enregistre le retour d’un prêt visible sur la page courante', async () => {
    const seller = bookseller();
    const reader = borrower();
    const bookId = createBook('Germinal');
    const loanId = insertLoan(bookId, reader.id, '2026-01-01', '2026-01-31');

    const outcome = await returnAs(seller, { loanId: String(loanId) });

    expect(outcome).toMatchObject({ returned: { title: 'Germinal' } });
    expect(loanRow(loanId).returned_on).not.toBeNull();
  });

  it('refuse un identifiant de prêt mal formé', async () => {
    const seller = bookseller();

    const failure = asFailure(await returnAs(seller, { loanId: 'abc' }));

    expect(failure.status).toBe(400);
  });
});

describe('autorisation de /libraire/retours', () => {
  it('un paramètre de page manipulé ne contourne pas le contrôle d’accès au chargement', async () => {
    const seller = bookseller();
    const reader = borrower();
    const bookId = createBook('Germinal');
    insertLoan(bookId, reader.id, '2026-01-01', '2026-01-31');

    for (const search of ['?page=2', '?page=0', '?page=abc', '?page=999999']) {
      expectLoginRedirect(await loadAs(null, search));
      expectForbidden(await loadAs(reader, search));
    }
    // Contrôle passant, avec seller, pour vérifier que le rendu reste normal.
    expect(await loadAs(seller, '?page=abc')).toMatchObject({ page: 1 });
  });

  it('un anonyme ou un emprunteur ne peut pas enregistrer de retour', async () => {
    const seller = bookseller();
    const reader = borrower();
    const bookId = createBook('Germinal');
    const loanId = insertLoan(bookId, reader.id, '2026-01-01', '2026-01-31');

    expectLoginRedirect(await returnAs(null, { loanId: String(loanId) }));
    expectForbidden(await returnAs(reader, { loanId: String(loanId) }));

    expect(loanRow(loanId).returned_on).toBeNull();
    // Le seller peut toujours agir, contrôle confirmé non affecté.
    const outcome = await returnAs(seller, { loanId: String(loanId) });
    expect(outcome).toMatchObject({ returned: { title: 'Germinal' } });
  });
});
