import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '$lib/server/auth';
import { BOOKSELLER_ONLY_MESSAGE, type CatalogueEntry } from '$lib/server/catalogue';
import { closeDb, getDb } from '$lib/server/db';
import { load as catalogueLoad } from '../../../+page.server';
import { load as libraireLayoutLoad } from '../../+layout.server';
import { actions } from './+page.server';

type ActionEvent = Parameters<typeof actions.default>[0];
type Failure = {
  status: number;
  data: { title: string; author: string; errors: Partial<Record<'title' | 'author', string>> };
};

const SQL_PAYLOAD = "'; DROP TABLE books;--";

const BOOKSELLER: AuthUser = {
  id: 1,
  email: 'libraire@example.fr',
  displayName: 'Libraire',
  role: 'bookseller'
};
const BORROWER: AuthUser = {
  id: 2,
  email: 'lecteur@example.fr',
  displayName: 'Lecteur',
  role: 'borrower'
};

/** Exécute un load ou une action et capture la redirection ou l'erreur HTTP levée. */
async function outcomeOf(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (thrown) {
    if (isRedirect(thrown) || isHttpError(thrown)) return thrown;
    throw thrown;
  }
}

function addBookAs(user: AuthUser | null, fields: Record<string, string>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const url = new URL('http://localhost/libraire/livres/nouveau');
  const event = {
    request: new Request(url, { method: 'POST', body }),
    url,
    locals: { user }
  } as unknown as ActionEvent;
  return outcomeOf(() => actions.default(event));
}

function layoutAs(user: AuthUser | null) {
  return outcomeOf(() =>
    libraireLayoutLoad({ locals: { user } } as unknown as Parameters<typeof libraireLayoutLoad>[0])
  );
}

async function publicCatalogue(): Promise<CatalogueEntry[]> {
  const data = await catalogueLoad({ locals: { user: null } } as unknown as Parameters<
    typeof catalogueLoad
  >[0]);
  return (data as { books: CatalogueEntry[] }).books;
}

function bookCount(): number {
  return (getDb().prepare('SELECT count(*) AS n FROM books').get() as { n: number }).n;
}

function asFailure(outcome: unknown): Failure {
  if (!isActionFailure(outcome)) throw new Error('Échec d’action attendu.');
  return outcome as unknown as Failure;
}

function expectForbidden(outcome: unknown) {
  if (!isHttpError(outcome)) throw new Error('Erreur HTTP attendue.');
  expect(outcome.status).toBe(403);
  expect(outcome.body.message).toBe(BOOKSELLER_ONLY_MESSAGE);
}

function expectLoginRedirect(outcome: unknown) {
  if (!isRedirect(outcome)) throw new Error('Redirection attendue.');
  expect(outcome.status).toBe(303);
  expect(outcome.location).toBe('/connexion');
}

afterEach(() => {
  closeDb();
});

describe('garde du layout /libraire', () => {
  it('redirige un visiteur anonyme vers /connexion', async () => {
    expectLoginRedirect(await layoutAs(null));
  });

  it('refuse un emprunteur avec une 403 en français', async () => {
    expectForbidden(await layoutAs(BORROWER));
  });

  it('laisse passer le libraire', async () => {
    await expect(layoutAs(BOOKSELLER)).resolves.toBeUndefined();
  });
});

describe('action /libraire/livres/nouveau', () => {
  const valid = { title: 'Le Petit Prince', author: 'Antoine de Saint-Exupéry' };

  it('refuse un visiteur anonyme sans créer de livre', async () => {
    expectLoginRedirect(await addBookAs(null, valid));
    expect(bookCount()).toBe(0);
  });

  it('refuse un emprunteur (403) sans créer de livre', async () => {
    expectForbidden(await addBookAs(BORROWER, valid));
    expect(bookCount()).toBe(0);
  });

  it('ignore un champ role envoyé par un emprunteur', async () => {
    expectForbidden(await addBookAs(BORROWER, { ...valid, role: 'bookseller' }));
    expect(bookCount()).toBe(0);
  });

  it('ajoute un livre sans espaces autour, visible « disponible » au catalogue', async () => {
    const outcome = await addBookAs(BOOKSELLER, {
      title: '  Le Petit Prince ',
      author: ' Antoine de Saint-Exupéry  '
    });

    expect(outcome).toEqual({ added: valid });
    expect(await publicCatalogue()).toEqual([
      { id: expect.any(Number), ...valid, status: 'available' }
    ]);
  });

  it('accepte un titre et un auteur de 200 caractères exactement', async () => {
    const outcome = await addBookAs(BOOKSELLER, { title: 't'.repeat(200), author: 'a'.repeat(200) });

    expect(isActionFailure(outcome)).toBe(false);
    expect(bookCount()).toBe(1);
  });

  const invalidCases: [string, Record<string, string>, 'title' | 'author'][] = [
    ['un titre vide', { title: '', author: 'Voltaire' }, 'title'],
    ['un titre fait d’espaces', { title: '   ', author: 'Voltaire' }, 'title'],
    ['un titre de 201 caractères', { title: 'x'.repeat(201), author: 'Voltaire' }, 'title'],
    ['un titre absent', { author: 'Voltaire' }, 'title'],
    ['un auteur vide', { title: 'Candide', author: '' }, 'author'],
    ['un auteur de 201 caractères', { title: 'Candide', author: 'x'.repeat(201) }, 'author'],
    ['un titre avec un caractère de contrôle', { title: 'Candide', author: 'Voltaire' }, 'title']
  ];

  for (const [label, fields, field] of invalidCases) {
    it(`refuse ${label} : 400 et aucun livre créé`, async () => {
      const before = bookCount();

      const failure = asFailure(await addBookAs(BOOKSELLER, fields));

      expect(failure.status).toBe(400);
      expect(failure.data.errors[field]).toEqual(expect.any(String));
      expect(bookCount()).toBe(before);
    });
  }

  it('conserve les valeurs saisies après une erreur', async () => {
    const failure = asFailure(await addBookAs(BOOKSELLER, { title: ' Candide ', author: '' }));

    expect(failure.data.title).toBe('Candide');
    expect(failure.data.author).toBe('');
    expect(Object.keys(failure.data.errors)).toEqual(['author']);
  });

  it('stocke littéralement une charge utile SQL et un titre HTML, tables intactes', async () => {
    await addBookAs(BOOKSELLER, { title: SQL_PAYLOAD, author: SQL_PAYLOAD });
    await addBookAs(BOOKSELLER, { title: '<script>alert(1)</script>', author: 'Anonyme' });

    const stored = getDb().prepare('SELECT title, author FROM books ORDER BY id').all();
    expect(stored).toEqual([
      { title: SQL_PAYLOAD, author: SQL_PAYLOAD },
      { title: '<script>alert(1)</script>', author: 'Anonyme' }
    ]);
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all();
    expect(tables).toEqual([
      { name: 'books' },
      { name: 'loans' },
      { name: 'login_failures' },
      { name: 'sessions' },
      { name: 'users' }
    ]);
  });
});
