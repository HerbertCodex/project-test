import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CatalogueTable from '$lib/components/CatalogueTable.svelte';
import type { AuthUser, Role } from '$lib/server/auth';
import { addBook, BOOKSELLER_ONLY_MESSAGE, type CatalogueEntry } from '$lib/server/catalogue';
import { closeDb, getDb } from '$lib/server/db';
import {
  BOOK_NOT_FOUND_MESSAGE,
  BOOK_UNAVAILABLE_MESSAGE,
  BORROWER_ONLY_MESSAGE,
  LOAN_NOT_RETURNABLE_MESSAGE,
  borrowBook,
  listBorrowerLoans,
  parseRecordId,
  recordReturn,
  type ActiveLoan,
  type BorrowerLoans
} from '$lib/server/loans';
import { actions as catalogueActions, load } from './+page.server';
import { actions as returnActions, load as returnsLoad } from './libraire/retours/+page.server';
import { load as myLoansLoad } from './mes-prets/+page.server';
import MyLoansPage from './mes-prets/+page.svelte';

const SQL_PAYLOAD = "'; DROP TABLE books;--";
const HOSTILE_TITLE = '<script>alert(1)</script>';

type LoadEvent = Parameters<typeof load>[0];

async function catalogueFor(user: AuthUser | null): Promise<CatalogueEntry[]> {
  const data = await load({ locals: { user } } as unknown as LoadEvent);
  return (data as { books: CatalogueEntry[] }).books;
}

function insertUser(email: string, displayName: string, role: Role = 'borrower'): AuthUser {
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, 0)`
    )
    .run(email, displayName, 'hash-factice', role);
  return { id: Number(result.lastInsertRowid), email, displayName, role };
}

function createBook(
  title: string,
  author: string,
  sale: { price?: string; saleStock?: string } = {}
): number {
  const created = addBook(getDb(), { title, author, ...sale });
  if (!created.ok) throw new Error('Livre de test non créé.');
  return created.book.id;
}

function tableNames(): string[] {
  return (
    getDb()
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

/** Horloge injectée : seul Date est simulé, les promesses et minuteurs restent réels. */
function setNow(iso: string): void {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
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

function postForm(path: string, fields: Record<string, string>): { request: Request; url: URL } {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const url = new URL(path, 'http://localhost');
  return { request: new Request(url, { method: 'POST', body }), url };
}

function borrowAs(user: AuthUser | null, fields: Record<string, string>): Promise<unknown> {
  const event = { ...postForm('/?/emprunter', fields), locals: { user } };
  return outcomeOf(() =>
    catalogueActions.emprunter(event as unknown as Parameters<typeof catalogueActions.emprunter>[0])
  );
}

function returnAs(user: AuthUser | null, fields: Record<string, string>): Promise<unknown> {
  const event = { ...postForm('/libraire/retours', fields), locals: { user } };
  return outcomeOf(() =>
    returnActions.default(event as unknown as Parameters<typeof returnActions.default>[0])
  );
}

function returnsLoadAs(user: AuthUser | null): Promise<unknown> {
  const url = new URL('http://localhost/libraire/retours');
  return outcomeOf(() =>
    returnsLoad({ url, locals: { user } } as unknown as Parameters<typeof returnsLoad>[0])
  );
}

function myLoansAs(user: AuthUser | null, search = ''): Promise<unknown> {
  const url = new URL(`http://localhost/mes-prets${search}`);
  return outcomeOf(() =>
    myLoansLoad({ url, locals: { user } } as unknown as Parameters<typeof myLoansLoad>[0])
  );
}

type LoanRow = {
  id: number;
  book_id: number;
  user_id: number;
  borrowed_on: string;
  due_on: string;
  returned_on: string | null;
};

function loanRows(): LoanRow[] {
  return getDb().prepare('SELECT * FROM loans ORDER BY id').all() as LoanRow[];
}

function insertLoan(
  bookId: number,
  userId: number,
  borrowedOn: string,
  dueOn: string,
  returnedOn: string | null = null
): number {
  const result = getDb()
    .prepare(
      'INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on) VALUES (?, ?, ?, ?, ?)'
    )
    .run(bookId, userId, borrowedOn, dueOn, returnedOn);
  return Number(result.lastInsertRowid);
}

function asFailure(outcome: unknown): { status: number; data: Record<string, unknown> } {
  if (!isActionFailure(outcome)) throw new Error('Échec d’action attendu.');
  return outcome as unknown as { status: number; data: Record<string, unknown> };
}

function expectForbidden(outcome: unknown, message: string) {
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
  vi.useRealTimers();
  closeDb();
});

describe('load / (catalogue public)', () => {
  it('liste les livres sans connexion avec seulement id, titre, auteur, statut, prix et vente', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur Secret');
    const borrowedId = createBook('Le Petit Prince', 'Antoine de Saint-Exupéry');
    createBook('Candide', 'Voltaire');
    getDb()
      .prepare('INSERT INTO loans (book_id, user_id, borrowed_on, due_on) VALUES (?, ?, ?, ?)')
      .run(borrowedId, borrower.id, '2026-09-01', '2026-10-01');

    const books = await catalogueFor(null);

    expect(books).toEqual([
      {
        id: expect.any(Number),
        title: 'Candide',
        author: 'Voltaire',
        status: 'available',
        priceCents: null,
        saleStatus: 'sold-out'
      },
      {
        id: borrowedId,
        title: 'Le Petit Prince',
        author: 'Antoine de Saint-Exupéry',
        status: 'borrowed',
        priceCents: null,
        saleStatus: 'sold-out'
      }
    ]);
    for (const book of books) {
      expect(Object.keys(book).sort()).toEqual([
        'author',
        'id',
        'priceCents',
        'saleStatus',
        'status',
        'title'
      ]);
    }

    const serialized = JSON.stringify(books);
    for (const secret of ['lecteur@example.fr', 'Lecteur Secret', '2026-10-01', '2026-09-01']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('n’expose ni emprunteur ni stock chiffré pour un livre emprunté et en vente', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur Secret');
    const bookId = createBook('Germinal', 'Émile Zola', { price: '12,50', saleStock: '137' });
    getDb()
      .prepare('INSERT INTO loans (book_id, user_id, borrowed_on, due_on) VALUES (?, ?, ?, ?)')
      .run(bookId, borrower.id, '2026-09-01', '2026-10-01');

    const books = await catalogueFor(null);

    expect(books).toEqual([
      {
        id: bookId,
        title: 'Germinal',
        author: 'Émile Zola',
        status: 'borrowed',
        priceCents: 1250,
        saleStatus: 'on-sale'
      }
    ]);
    const serialized = JSON.stringify(books);
    expect(serialized).not.toMatch(/stock/i);
    for (const secret of ['137', 'lecteur@example.fr', 'Lecteur Secret', '2026-10-01']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('ne révèle pas l’emprunteur à un autre emprunteur connecté', async () => {
    const owner = insertUser('a@example.fr', 'Emprunteur A');
    const other = insertUser('b@example.fr', 'Emprunteur B');
    const bookId = createBook('Germinal', 'Émile Zola');
    getDb()
      .prepare('INSERT INTO loans (book_id, user_id, borrowed_on, due_on) VALUES (?, ?, ?, ?)')
      .run(bookId, owner.id, '2026-09-01', '2026-10-01');

    const books = await catalogueFor(other);

    expect(books).toEqual([
      {
        id: bookId,
        title: 'Germinal',
        author: 'Émile Zola',
        status: 'borrowed',
        priceCents: null,
        saleStatus: 'sold-out'
      }
    ]);
    expect(JSON.stringify(books)).not.toMatch(/a@example\.fr|Emprunteur A|2026-10-01/);
  });

  it('montre de nouveau « disponible » un livre rendu', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    const bookId = createBook('Nana', 'Émile Zola');
    getDb()
      .prepare(
        'INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on) VALUES (?, ?, ?, ?, ?)'
      )
      .run(bookId, borrower.id, '2026-09-01', '2026-10-01', '2026-09-10');

    expect((await catalogueFor(null))[0].status).toBe('available');
  });

  it('stocke et renvoie littéralement une charge utile SQL, tables intactes', async () => {
    const before = tableNames();
    const bookId = createBook(SQL_PAYLOAD, SQL_PAYLOAD);

    expect(await catalogueFor(null)).toEqual([
      {
        id: bookId,
        title: SQL_PAYLOAD,
        author: SQL_PAYLOAD,
        status: 'available',
        priceCents: null,
        saleStatus: 'sold-out'
      }
    ]);
    expect(tableNames()).toEqual(before);
    expect(tableNames()).toContain('books');
  });
});

describe('CatalogueTable', () => {
  const books: CatalogueEntry[] = [
    {
      id: 1,
      title: HOSTILE_TITLE,
      author: '<img src=x onerror=alert(1)>',
      status: 'available',
      priceCents: 1250,
      saleStatus: 'on-sale'
    },
    {
      id: 2,
      title: 'Candide',
      author: 'Voltaire',
      status: 'borrowed',
      priceCents: null,
      saleStatus: 'sold-out'
    }
  ];

  it('rend une table avec thead et en-têtes de colonne à portée explicite', () => {
    const { body } = render(CatalogueTable, { props: { books } });

    expect(body).toContain('<thead');
    expect(body).toMatch(/<th[^>]*scope="col"[^>]*>Titre<\/th>/);
    expect(body).toMatch(/<th[^>]*scope="col"[^>]*>Auteur<\/th>/);
    expect(body).toContain('Disponible');
    expect(body).toContain('Emprunté');
    // Sans action fournie (visiteur, libraire), aucune colonne Action.
    expect(body).not.toContain('col-action');
  });

  it('rend un titre et un auteur hostiles comme du texte', () => {
    const { body } = render(CatalogueTable, { props: { books } });

    expect(body).not.toContain('<script');
    expect(body).not.toContain('<img');
    expect(body).toMatch(/&lt;script(>|&gt;)alert\(1\)&lt;\/script(>|&gt;)/);
    expect(body).toMatch(/&lt;img src=x onerror=alert\(1\)(>|&gt;)/);
  });
});

describe('parseRecordId', () => {
  it('n’accepte qu’un entier strictement positif écrit en chiffres', () => {
    expect(parseRecordId('1')).toBe(1);
    expect(parseRecordId('9007199254740991')).toBe(9007199254740991);
    for (const raw of ['', '0', '-1', '01', '1.5', '1e3', ' 1', '0x10', 'abc', '9007199254740993']) {
      expect(parseRecordId(raw)).toBeNull();
    }
    expect(parseRecordId(null)).toBeNull();
    expect(parseRecordId(new File(['1'], 'id.txt'))).toBeNull();
  });
});

describe('action ?/emprunter du catalogue', () => {
  it('crée un prêt du jour à Paris jusqu’à J+30 et rend le livre « Emprunté »', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    const bookId = createBook('Le Petit Prince', 'Antoine de Saint-Exupéry');
    // 22:30 UTC le 31 mars = 00:30 le 1er avril à Paris.
    setNow('2026-03-31T22:30:00Z');

    const outcome = await borrowAs(borrower, { bookId: String(bookId) });

    expect(outcome).toEqual({
      borrowed: { title: 'Le Petit Prince', dueOn: { iso: '2026-05-01', label: '1 mai 2026' } }
    });
    expect(loanRows()).toEqual([
      {
        id: expect.any(Number),
        book_id: bookId,
        user_id: borrower.id,
        borrowed_on: '2026-04-01',
        due_on: '2026-05-01',
        returned_on: null
      }
    ]);
    expect((await catalogueFor(null))[0].status).toBe('borrowed');
  });

  it('calcule J+30 en dates calendaires autour du changement d’heure d’octobre', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    const bookId = createBook('Candide', 'Voltaire');
    setNow('2026-10-24T22:30:00Z');

    await borrowAs(borrower, { bookId: String(bookId) });

    expect(loanRows()[0]).toMatchObject({ borrowed_on: '2026-10-25', due_on: '2026-11-24' });
  });

  it('répond 409 au second emprunt du même livre : exactement un prêt actif', async () => {
    const first = insertUser('a@example.fr', 'Emprunteur A');
    const second = insertUser('b@example.fr', 'Emprunteur B');
    const bookId = createBook('Germinal', 'Émile Zola');

    await borrowAs(first, { bookId: String(bookId) });
    const again = asFailure(await borrowAs(first, { bookId: String(bookId) }));
    const other = asFailure(await borrowAs(second, { bookId: String(bookId) }));

    expect(again.status).toBe(409);
    expect(other.status).toBe(409);
    expect(other.data).toEqual({ borrowError: BOOK_UNAVAILABLE_MESSAGE });
    expect(loanRows()).toHaveLength(1);
    expect(loanRows()[0].user_id).toBe(first.id);
  });

  it('répond 404 pour un livre inexistant sans créer de prêt', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    createBook('Candide', 'Voltaire');

    const failure = asFailure(await borrowAs(borrower, { bookId: '999999' }));

    expect(failure.status).toBe(404);
    expect(failure.data).toEqual({ borrowError: BOOK_NOT_FOUND_MESSAGE });
    expect(loanRows()).toEqual([]);
  });

  const malformedIds: [string, Record<string, string>][] = [
    ['absent', {}],
    ['vide', { bookId: '' }],
    ['non numérique', { bookId: 'abc' }],
    ['nul', { bookId: '0' }],
    ['négatif', { bookId: '-1' }],
    ['décimal', { bookId: '1.5' }],
    ['en notation exponentielle', { bookId: '1e0' }],
    ['avec une charge SQL', { bookId: '1; DROP TABLE loans;--' }],
    ['trop grand', { bookId: '99999999999999999999' }]
  ];

  for (const [label, fields] of malformedIds) {
    it(`répond 400 pour un identifiant ${label} sans créer de prêt`, async () => {
      const borrower = insertUser('lecteur@example.fr', 'Lecteur');
      createBook('Candide', 'Voltaire');

      const failure = asFailure(await borrowAs(borrower, fields));

      expect(failure.status).toBe(400);
      expect(loanRows()).toEqual([]);
    });
  }

  it('redirige un visiteur anonyme vers /connexion sans créer de prêt', async () => {
    const bookId = createBook('Candide', 'Voltaire');

    expectLoginRedirect(await borrowAs(null, { bookId: String(bookId) }));
    expect(loanRows()).toEqual([]);
  });

  it('refuse le libraire (403) sans créer de prêt', async () => {
    const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');
    const bookId = createBook('Candide', 'Voltaire');

    expectForbidden(await borrowAs(bookseller, { bookId: String(bookId) }), BORROWER_ONLY_MESSAGE);
    expect(loanRows()).toEqual([]);
  });

  it('revérifie le rôle en base : une session au rôle périmé n’emprunte pas', () => {
    const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');
    const bookId = createBook('Candide', 'Voltaire');

    const result = borrowBook(getDb(), { ...bookseller, role: 'borrower' }, bookId);

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
    expect(loanRows()).toEqual([]);
  });

  it('ignore un champ userId envoyé : le prêt est attribué à l’utilisateur de session', async () => {
    const owner = insertUser('a@example.fr', 'Emprunteur A');
    const victim = insertUser('b@example.fr', 'Emprunteur B');
    const bookId = createBook('Candide', 'Voltaire');

    await borrowAs(owner, { bookId: String(bookId), userId: String(victim.id) });

    expect(loanRows().map((row) => row.user_id)).toEqual([owner.id]);
  });
});

describe('/libraire/retours', () => {
  function setupActiveLoan() {
    const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');
    const borrower = insertUser('lecteur@example.fr', 'Lectrice Martin');
    const bookId = createBook('Nana', 'Émile Zola');
    const loanId = insertLoan(bookId, borrower.id, '2026-04-01', '2026-05-01');
    return { bookseller, borrower, bookId, loanId };
  }

  it('liste les prêts en cours par échéance avec le badge de retard dès le lendemain', async () => {
    const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');
    const borrower = insertUser('lecteur@example.fr', 'Lectrice Martin');
    const dueToday = insertLoan(createBook('A', 'Auteur'), borrower.id, '2026-04-10', '2026-05-10');
    const dueYesterday = insertLoan(createBook('B', 'Auteur'), borrower.id, '2026-04-09', '2026-05-09');
    insertLoan(createBook('C', 'Auteur'), borrower.id, '2026-04-01', '2026-05-01', '2026-04-20');
    // 22:30 UTC le 9 mai = 00:30 le 10 mai à Paris.
    setNow('2026-05-09T22:30:00Z');

    const data = (await returnsLoadAs(bookseller)) as { loans: ActiveLoan[] };

    expect(data.loans).toEqual([
      {
        id: dueYesterday,
        title: 'B',
        borrowerName: 'Lectrice Martin',
        dueOn: { iso: '2026-05-09', label: '9 mai 2026' },
        overdue: true
      },
      {
        id: dueToday,
        title: 'A',
        borrowerName: 'Lectrice Martin',
        dueOn: { iso: '2026-05-10', label: '10 mai 2026' },
        overdue: false
      }
    ]);
    expect(JSON.stringify(data)).not.toContain('lecteur@example.fr');
  });

  it('refuse le load à un emprunteur (403) et redirige un anonyme', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');

    expectForbidden(await returnsLoadAs(borrower), BOOKSELLER_ONLY_MESSAGE);
    expectLoginRedirect(await returnsLoadAs(null));
  });

  it('enregistre un retour du jour à Paris, garde le prêt et rend le livre disponible', async () => {
    const { bookseller, bookId, loanId } = setupActiveLoan();
    setNow('2026-05-02T22:30:00Z');

    const outcome = await returnAs(bookseller, { loanId: String(loanId) });

    expect(outcome).toEqual({ returned: { title: 'Nana', borrowerName: 'Lectrice Martin' } });
    expect(loanRows()).toEqual([
      expect.objectContaining({
        id: loanId,
        book_id: bookId,
        borrowed_on: '2026-04-01',
        due_on: '2026-05-01',
        returned_on: '2026-05-03'
      })
    ]);
    expect((await catalogueFor(null))[0].status).toBe('available');
    expect(((await returnsLoadAs(bookseller)) as { loans: ActiveLoan[] }).loans).toEqual([]);
  });

  it('refuse un double retour sans modifier la date enregistrée', async () => {
    const { bookseller, loanId } = setupActiveLoan();
    setNow('2026-05-02T10:00:00Z');
    await returnAs(bookseller, { loanId: String(loanId) });
    setNow('2026-05-20T10:00:00Z');

    const failure = asFailure(await returnAs(bookseller, { loanId: String(loanId) }));

    expect(failure.status).toBe(409);
    expect(failure.data).toEqual({ returnError: LOAN_NOT_RETURNABLE_MESSAGE });
    expect(loanRows()[0].returned_on).toBe('2026-05-02');
    expect(recordReturn(getDb(), loanId)).toEqual({ ok: false, reason: 'already-returned' });
  });

  it('répond 404 pour un prêt inconnu, sans modification', async () => {
    const { bookseller } = setupActiveLoan();
    const before = loanRows();

    const failure = asFailure(await returnAs(bookseller, { loanId: '424242' }));

    expect(failure.status).toBe(404);
    expect(loanRows()).toEqual(before);
  });

  for (const raw of ['', 'abc', '0', '-3', '1 OR 1=1']) {
    it(`répond 400 pour l’identifiant mal formé « ${raw} », sans modification`, async () => {
      const { bookseller } = setupActiveLoan();
      const before = loanRows();

      const failure = asFailure(await returnAs(bookseller, { loanId: raw }));

      expect(failure.status).toBe(400);
      expect(loanRows()).toEqual(before);
    });
  }

  it('refuse l’action à un emprunteur, même au propriétaire du prêt (403) : le prêt reste actif', async () => {
    const { borrower, loanId } = setupActiveLoan();

    expectForbidden(await returnAs(borrower, { loanId: String(loanId) }), BOOKSELLER_ONLY_MESSAGE);
    expect(loanRows()[0].returned_on).toBeNull();
  });

  it('redirige un anonyme vers /connexion : le prêt reste actif', async () => {
    const { loanId } = setupActiveLoan();

    expectLoginRedirect(await returnAs(null, { loanId: String(loanId) }));
    expect(loanRows()[0].returned_on).toBeNull();
  });
});

describe('load /mes-prets', () => {
  it('ne renvoie à B que ses propres prêts, même avec des paramètres d’URL ajoutés', async () => {
    const a = insertUser('a@example.fr', 'Emprunteur A');
    const b = insertUser('b@example.fr', 'Emprunteur B');
    insertLoan(createBook('Livre de A', 'Auteur'), a.id, '2026-04-01', '2026-05-01');
    const bActive = insertLoan(createBook('Livre de B', 'Auteur'), b.id, '2026-04-02', '2026-05-02');
    const bReturned = insertLoan(
      createBook('Ancien livre de B', 'Auteur'),
      b.id,
      '2026-03-01',
      '2026-03-31',
      '2026-03-15'
    );
    setNow('2026-05-02T12:00:00Z');

    const data = (await myLoansAs(b, `?userId=${a.id}&user=${a.id}`)) as BorrowerLoans;

    expect(data).toEqual({
      active: [
        {
          id: bActive,
          title: 'Livre de B',
          borrowedOn: { iso: '2026-04-02', label: '2 avril 2026' },
          dueOn: { iso: '2026-05-02', label: '2 mai 2026' },
          overdue: false
        }
      ],
      returned: [
        {
          id: bReturned,
          title: 'Ancien livre de B',
          borrowedOn: { iso: '2026-03-01', label: '1 mars 2026' },
          returnedOn: { iso: '2026-03-15', label: '15 mars 2026' }
        }
      ]
    });
    expect(JSON.stringify(data)).not.toMatch(/Livre de A|a@example\.fr|Emprunteur A/);
  });

  it('marque « en retard » un prêt dès le lendemain de l’échéance à Paris', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    insertLoan(createBook('Nana', 'Émile Zola'), borrower.id, '2026-04-01', '2026-05-01');

    setNow('2026-05-01T21:59:59Z');
    expect(((await myLoansAs(borrower)) as BorrowerLoans).active[0].overdue).toBe(false);

    setNow('2026-05-01T22:00:00Z');
    expect(((await myLoansAs(borrower)) as BorrowerLoans).active[0].overdue).toBe(true);
  });

  it('redirige un anonyme vers /connexion et refuse le libraire (403)', async () => {
    const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');

    expectLoginRedirect(await myLoansAs(null));
    expectForbidden(await myLoansAs(bookseller), BORROWER_ONLY_MESSAGE);
  });

  it('liste les prêts rendus du plus récent au plus ancien', () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    insertLoan(createBook('Ancien', 'Auteur'), borrower.id, '2026-01-01', '2026-01-31', '2026-01-10');
    insertLoan(createBook('Récent', 'Auteur'), borrower.id, '2026-02-01', '2026-03-03', '2026-02-10');

    const { returned } = listBorrowerLoans(getDb(), borrower.id, '2026-03-01');

    expect(returned.map((loan) => loan.title)).toEqual(['Récent', 'Ancien']);
  });

  it('affiche le badge « En retard » et un titre hostile comme du texte', () => {
    const data: BorrowerLoans = {
      active: [
        {
          id: 1,
          title: HOSTILE_TITLE,
          borrowedOn: { iso: '2026-04-01', label: '1 avril 2026' },
          dueOn: { iso: '2026-05-01', label: '1 mai 2026' },
          overdue: true
        }
      ],
      returned: []
    };

    const { body } = render(MyLoansPage, {
      props: { data: { ...data, user: { displayName: 'Lecteur', role: 'borrower' } } } as never
    });

    expect(body).toContain('class="badge-overdue"');
    expect(body).toContain('En retard');
    expect(body).toMatch(/<time datetime="2026-05-01">(<!---->)?1 mai 2026/);
    expect(body).not.toContain('<script');
    expect(body).toContain('Aucun prêt rendu');
  });
});
