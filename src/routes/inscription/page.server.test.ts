import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_TAKEN_MESSAGE, createBorrower } from '$lib/server/auth';
import { closeDb, getDb } from '$lib/server/db';
import { actions } from './+page.server';

type ActionEvent = Parameters<typeof actions.default>[0];
type Field = 'email' | 'displayName' | 'password';
type RegisterFailure = {
  status: number;
  data: { email: string; displayName: string; errors: Partial<Record<Field, string>> };
};

const PASSWORD = 'mot de passe solide';

function postEvent(fields: Record<string, string>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const url = new URL('http://localhost/inscription');
  const cookies = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  const event = {
    request: new Request(url, { method: 'POST', body }),
    url,
    cookies,
    locals: { user: null }
  } as unknown as ActionEvent;
  return { event, cookies };
}

/** Exécute l'action et capture la redirection levée, le cas échéant. */
async function register(fields: Record<string, string>) {
  const { event, cookies } = postEvent(fields);
  try {
    const outcome: unknown = await actions.default(event);
    return { outcome, cookies };
  } catch (thrown) {
    if (isRedirect(thrown)) return { outcome: thrown as unknown, cookies };
    throw thrown;
  }
}

function asFailure(outcome: unknown): RegisterFailure {
  if (!isActionFailure(outcome)) throw new Error('Échec d’action attendu.');
  return outcome as unknown as RegisterFailure;
}

function userCount(): number {
  return (getDb().prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
}

type StoredEvent = {
  created_at: number;
  type: string;
  user_id: number | null;
  subject: string | null;
};

function storedEvents(): StoredEvent[] {
  return getDb()
    .prepare('SELECT created_at, type, user_id, subject FROM security_events ORDER BY id')
    .all() as StoredEvent[];
}

/** Toutes les colonnes des événements écrits, en texte, pour la chasse aux secrets. */
function eventColumns(): string[] {
  const rows = getDb().prepare('SELECT * FROM security_events').all() as Record<string, unknown>[];
  return rows.flatMap((row) => Object.values(row).map((value) => String(value)));
}

afterEach(() => {
  closeDb();
});

describe('action /inscription', () => {
  it('crée un emprunteur puis redirige vers /connexion sans cookie de session', async () => {
    const { outcome, cookies } = await register({
      email: '  Lecteur@Example.FR ',
      displayName: '  Lecteur  ',
      password: PASSWORD
    });

    if (!isRedirect(outcome)) throw new Error('Redirection attendue.');
    expect(outcome.status).toBe(303);
    expect(new URL(outcome.location, 'http://localhost').pathname).toBe('/connexion');
    expect(cookies.set).not.toHaveBeenCalled();

    const row = getDb().prepare('SELECT email, display_name, role FROM users').get();
    expect(row).toEqual({ email: 'lecteur@example.fr', display_name: 'Lecteur', role: 'borrower' });
  });

  it('journalise l’inscription avec l’identifiant du compte créé', async () => {
    const before = Date.now();

    await register({
      email: '  Lecteur@Example.FR ',
      displayName: 'Lecteur',
      password: PASSWORD
    });

    const { id } = getDb().prepare('SELECT id FROM users').get() as { id: number };
    const events = storedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'signup',
      user_id: id,
      subject: 'lecteur@example.fr'
    });
    expect(Number.isSafeInteger(events[0].created_at)).toBe(true);
    expect(events[0].created_at).toBeGreaterThanOrEqual(before);
  });

  it('n’écrit ni mot de passe ni hachage dans les colonnes de l’événement', async () => {
    await register({ email: 'lecteur@example.fr', displayName: 'Lecteur', password: PASSWORD });

    const { password_hash } = getDb()
      .prepare('SELECT password_hash FROM users')
      .get() as { password_hash: string };
    const columns = eventColumns();
    expect(columns.length).toBeGreaterThan(0);
    for (const value of columns) {
      expect(value).not.toContain(PASSWORD);
      expect(value).not.toContain(password_hash);
      expect(value).not.toContain('$argon2');
    }
  });

  it('ignore un champ role envoyé avec le formulaire', async () => {
    await register({
      email: 'pirate@example.fr',
      displayName: 'Pirate',
      password: PASSWORD,
      role: 'bookseller'
    });

    expect(getDb().prepare('SELECT role FROM users').get()).toEqual({ role: 'borrower' });
  });

  const invalidCases: [string, Record<string, string>, Field][] = [
    [
      'un mot de passe de 11 caractères',
      { email: 'a@example.fr', displayName: 'A', password: 'x'.repeat(11) },
      'password'
    ],
    [
      'un mot de passe de 257 caractères',
      { email: 'a@example.fr', displayName: 'A', password: 'x'.repeat(257) },
      'password'
    ],
    ['un e-mail invalide', { email: 'pas-un-email', displayName: 'A', password: PASSWORD }, 'email'],
    ['un nom affiché vide', { email: 'a@example.fr', displayName: '   ', password: PASSWORD }, 'displayName']
  ];

  for (const [label, fields, field] of invalidCases) {
    it(`refuse ${label} : 400, aucun compte créé, aucun événement journalisé`, async () => {
      const before = userCount();
      const { outcome, cookies } = await register(fields);

      const failure = asFailure(outcome);
      expect(failure.status).toBe(400);
      expect(failure.data.errors[field]).toEqual(expect.any(String));
      expect(failure.data).not.toHaveProperty('password');
      expect(JSON.stringify(failure.data)).not.toContain(fields.password);
      expect(userCount()).toBe(before);
      expect(cookies.set).not.toHaveBeenCalled();
      expect(storedEvents()).toEqual([]);
    });
  }

  it('refuse un e-mail déjà utilisé avec une casse différente', async () => {
    const created = await createBorrower(getDb(), {
      email: 'lecteur@example.fr',
      displayName: 'Lecteur',
      password: PASSWORD
    });
    expect(created.ok).toBe(true);
    const before = userCount();

    const { outcome } = await register({
      email: 'LECTEUR@example.fr',
      displayName: 'Autre',
      password: 'un autre mot de passe'
    });

    const failure = asFailure(outcome);
    expect(failure.status).toBe(400);
    expect(failure.data.errors.email).toBe(EMAIL_TAKEN_MESSAGE);
    expect(failure.data.email).toBe('LECTEUR@example.fr');
    expect(failure.data.displayName).toBe('Autre');
    expect(JSON.stringify(failure.data)).not.toContain('un autre mot de passe');
    expect(userCount()).toBe(before);
    // Le compte préexistant vient de createBorrower, qui ne journalise rien :
    // un e-mail déjà pris ne laisse donc aucun événement.
    expect(storedEvents()).toEqual([]);
  });
});
