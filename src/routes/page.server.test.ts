import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CatalogueTable from '$lib/components/CatalogueTable.svelte';
import type { AuthUser, Role } from '$lib/server/auth';
import {
  addBook,
  BOOK_TEXT_MAX_LENGTH,
  BOOKSELLER_ONLY_MESSAGE,
  CATALOGUE_FILTER_PARAMS,
  formatPrice,
  type CatalogueEntry,
  type CatalogueFilters
} from '$lib/server/catalogue';
import { addCalendarDays, formatDateFr, todayInParis } from '$lib/server/dates';
import { closeDb, getDb } from '$lib/server/db';
import { DEFAULT_PAGE_SIZE } from '$lib/server/pagination';
import {
  BOOK_NOT_FOUND_MESSAGE,
  BOOK_UNAVAILABLE_MESSAGE,
  BORROWER_ONLY_MESSAGE,
  LOAN_DURATION_DAYS,
  LOAN_NOT_RETURNABLE_MESSAGE,
  borrowBook,
  listBorrowerReturnedLoans,
  parseRecordId,
  recordReturn,
  returnedLoanRetentionStart,
  type ActiveLoan,
  type BorrowerActiveLoan,
  type BorrowerReturnedLoan
} from '$lib/server/loans';
import { actions as catalogueActions, load } from './+page.server';
import CataloguePage from './+page.svelte';
import { actions as returnActions, load as returnsLoad } from './libraire/retours/+page.server';
import { load as myLoansLoad } from './mes-prets/+page.server';
import MyLoansPage from './mes-prets/+page.svelte';

const SQL_PAYLOAD = "'; DROP TABLE books;--";
const HOSTILE_TITLE = '<script>alert(1)</script>';

type MyLoansData = { active: BorrowerActiveLoan[]; returned: BorrowerReturnedLoan[] };

type LoadEvent = Parameters<typeof load>[0];

type CatalogueData = {
  books: CatalogueEntry[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  pageQuery: string;
  filters: CatalogueFilters;
  searchMaxLength: number;
};

/** Load de / pour une chaîne de requête donnée (« ?q=… »). */
async function catalogueAt(search: string, user: AuthUser | null = null): Promise<CatalogueData> {
  const url = new URL(`http://localhost/${search}`);
  const data = await load({ url, locals: { user } } as unknown as LoadEvent);
  return data as CatalogueData;
}

async function catalogueFor(user: AuthUser | null): Promise<CatalogueEntry[]> {
  return (await catalogueAt('', user)).books;
}

/**
 * Compte de test créé à l'instant de l'horloge du test : une date de création
 * absolue le rendrait inactif depuis des années et la purge déclenchée par les
 * actions l'anonymiserait au milieu du scénario.
 */
function insertUser(email: string, displayName: string, role: Role = 'borrower'): AuthUser {
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(email, displayName, 'hash-factice', role, Date.now());
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

/**
 * Date calendaire de Paris décalée de `days` par rapport à l'horloge du test.
 * Les prêts attendus sont datés ainsi : une date absolue finirait hors de la
 * borne de rétention et la purge déclenchée par les actions les effacerait.
 */
function parisDay(days: number): string {
  return addCalendarDays(todayInParis(), days);
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

/**
 * Prêt rendu la veille de la borne de rétention des prêts rendus : il est hors
 * borne, donc candidat à la purge, quelle que soit l'horloge du test.
 */
function insertStaleReturnedLoan(userId: number): number {
  const returnedOn = addCalendarDays(returnedLoanRetentionStart(), -1);
  const borrowedOn = addCalendarDays(returnedOn, -30);
  const bookId = createBook('Prêt hors borne', 'Auteur');
  return insertLoan(bookId, userId, borrowedOn, returnedOn, returnedOn);
}

/** Prêt en cours de « Nana », emprunté 32 jours plus tôt et échu depuis 2 jours. */
function setupActiveLoan() {
  const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');
  const borrower = insertUser('lecteur@example.fr', 'Lectrice Martin');
  const bookId = createBook('Nana', 'Émile Zola');
  const loanId = insertLoan(bookId, borrower.id, parisDay(-32), parisDay(-2));
  return { bookseller, borrower, bookId, loanId };
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
    insertLoan(bookId, borrower.id, parisDay(-30), parisDay(0), parisDay(-9));

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

describe('load / avec filtres d’URL', () => {
  const STOCK = '137';

  function query(params: Record<string, string>): string {
    return `?${new URLSearchParams(params)}`;
  }

  function titles(data: CatalogueData): string[] {
    return data.books.map((book) => book.title);
  }

  /** Candide épuisé, Germinal emprunté et en vente, L'Œuvre sans prix, Nana libre et en vente. */
  function seedCatalogue() {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur Secret');
    const germinal = createBook('Germinal', 'Émile Zola', { price: '12,50', saleStock: STOCK });
    createBook('Candide', 'Voltaire', { price: '8', saleStock: '0' });
    createBook("L'Œuvre", 'Émile Zola');
    createBook('Nana', 'Émile Zola', { price: '9,20', saleStock: '2' });
    insertLoan(germinal, borrower.id, '2026-09-01', '2026-10-01');
  }

  it('sans paramètre : liste complète triée, aucun filtre retenu, borne du champ texte fournie', async () => {
    seedCatalogue();

    const data = await catalogueAt('');

    expect(titles(data)).toEqual(['Candide', 'Germinal', "L'Œuvre", 'Nana']);
    expect(data.filters).toEqual({});
    expect(data.searchMaxLength).toBe(BOOK_TEXT_MAX_LENGTH);
  });

  it('appelé sans URL (événement partiel) : liste complète, aucun filtre retenu', async () => {
    seedCatalogue();

    const data = (await load({ locals: { user: null } } as unknown as LoadEvent)) as CatalogueData;

    expect(titles(data)).toEqual(['Candide', 'Germinal', "L'Œuvre", 'Nana']);
    expect(data.filters).toEqual({});
    expect(JSON.stringify(data)).not.toContain(STOCK);
  });

  it('utilise les noms de paramètres du formulaire (q, pret, vente)', () => {
    expect(CATALOGUE_FILTER_PARAMS).toEqual({
      text: 'q',
      availableForLoan: 'pret',
      availableForSale: 'vente'
    });
  });

  it('recherche titre et auteur sans tenir compte de la casse ni des accents', async () => {
    seedCatalogue();

    expect(titles(await catalogueAt(query({ q: 'ZOLA' })))).toEqual(['Germinal', "L'Œuvre", 'Nana']);
    expect(titles(await catalogueAt(query({ q: 'emile' })))).toEqual(['Germinal', "L'Œuvre", 'Nana']);
    expect(titles(await catalogueAt(query({ q: 'oeuvre' })))).toEqual(["L'Œuvre"]);
    expect(titles(await catalogueAt(query({ q: '  candide ' })))).toEqual(['Candide']);
    expect((await catalogueAt(query({ q: '  candide ' }))).filters).toEqual({ text: 'candide' });
  });

  it('filtre « disponible au prêt » : exclut le livre emprunté', async () => {
    seedCatalogue();

    const data = await catalogueAt(query({ pret: '1' }));

    expect(titles(data)).toEqual(['Candide', "L'Œuvre", 'Nana']);
    expect(data.filters).toEqual({ availableForLoan: true });
  });

  it('filtre « en vente » : seuls les livres avec prix et stock, toujours sans stock chiffré', async () => {
    seedCatalogue();

    const data = await catalogueAt(query({ vente: '1' }));

    expect(data.books).toEqual([
      {
        id: expect.any(Number),
        title: 'Germinal',
        author: 'Émile Zola',
        status: 'borrowed',
        priceCents: 1250,
        saleStatus: 'on-sale'
      },
      {
        id: expect.any(Number),
        title: 'Nana',
        author: 'Émile Zola',
        status: 'available',
        priceCents: 920,
        saleStatus: 'on-sale'
      }
    ]);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(/stock/i);
    for (const secret of [STOCK, 'lecteur@example.fr', 'Lecteur Secret', '2026-10-01']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('combine les filtres par ET', async () => {
    seedCatalogue();

    const data = await catalogueAt(query({ q: 'zola', pret: '1', vente: '1' }));

    expect(titles(data)).toEqual(['Nana']);
    expect(data.filters).toEqual({ text: 'zola', availableForLoan: true, availableForSale: true });
    expect(titles(await catalogueAt(query({ q: 'zola', vente: '1' })))).toEqual(['Germinal', 'Nana']);
  });

  it('ignore les paramètres vides ou de valeur inconnue et renvoie la liste complète', async () => {
    seedCatalogue();

    for (const search of [
      query({ q: '', pret: 'oui', vente: 'yes' }),
      query({ q: '   ', pret: '0', vente: 'true' }),
      query({ pret: '1 OR 1=1', vente: "1'--", inconnu: '1' })
    ]) {
      const data = await catalogueAt(search);
      expect(titles(data)).toEqual(['Candide', 'Germinal', "L'Œuvre", 'Nana']);
      expect(data.filters).toEqual({});
    }
  });

  it('traite les jokers % et _ littéralement', async () => {
    seedCatalogue();

    expect((await catalogueAt(query({ q: '%' }))).books).toEqual([]);
    expect((await catalogueAt(query({ q: '_' }))).books).toEqual([]);
    const percentId = createBook('100 % Zola', 'Anonyme');
    expect((await catalogueAt(query({ q: '%' }))).books.map((book) => book.id)).toEqual([percentId]);
  });

  it('borne le terme à BOOK_TEXT_MAX_LENGTH et retire les caractères de contrôle', async () => {
    seedCatalogue();

    const long = await catalogueAt(query({ q: 'x'.repeat(BOOK_TEXT_MAX_LENGTH + 50) }));
    expect(long.filters.text).toHaveLength(BOOK_TEXT_MAX_LENGTH);
    expect(long.books).toEqual([]);

    const controlled = await catalogueAt(query({ q: 'Nana ' }));
    expect(controlled.filters.text).toBe('Nana');
    expect(controlled.filters.text).not.toMatch(/\p{Cc}/u);
    expect(titles(controlled)).toEqual(['Nana']);
  });

  it('compare une charge utile SQL littéralement, tables intactes', async () => {
    seedCatalogue();
    const before = tableNames();

    expect((await catalogueAt(query({ q: SQL_PAYLOAD }))).books).toEqual([]);
    const payloadId = createBook(SQL_PAYLOAD, 'Auteur');
    const found = await catalogueAt(query({ q: SQL_PAYLOAD }));

    expect(found.books.map((book) => book.id)).toEqual([payloadId]);
    expect(found.filters).toEqual({ text: SQL_PAYLOAD });
    expect(tableNames()).toEqual(before);
    expect(tableNames()).toContain('books');
  });
});

describe('load / pagination du catalogue', () => {
  function query(params: Record<string, string>): string {
    return `?${new URLSearchParams(params)}`;
  }

  function seedBooks(count: number): void {
    for (let i = 0; i < count; i += 1) {
      createBook(`Livre ${String(i).padStart(4, '0')}`, 'Auteur');
    }
  }

  it('page 1 par défaut, avec le total, la taille de page et le nombre de pages', async () => {
    seedBooks(60);

    const data = await catalogueAt('');

    expect(data.books).toHaveLength(25);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(25);
    expect(data.totalItems).toBe(60);
    expect(data.totalPages).toBe(3);
  });

  it('la première page d’une base d’au moins 200 livres ne renvoie jamais plus de 25 lignes', async () => {
    seedBooks(200);

    const data = await catalogueAt('');

    // Un catalogue complet de 200 livres pèserait plusieurs Mo une fois rendu :
    // seule la page demandée (25 lignes) est lue et renvoyée par le load.
    expect(data.books).toHaveLength(25);
    expect(data.totalItems).toBe(200);
    expect(data.totalPages).toBe(8);
  });

  it('change de page avec ?page=2, filtres conservés dans pageQuery', async () => {
    seedBooks(30);

    const data = await catalogueAt(query({ page: '2', pret: '1' }));

    expect(data.page).toBe(2);
    expect(data.books).toHaveLength(5);
    expect(data.pageQuery).toBe('pret=1');
  });

  for (const raw of ['0', '999', 'abc', '1.5', '-3']) {
    it(`borne silencieusement ?page=${raw} sans erreur serveur`, async () => {
      seedBooks(30);

      const data = await catalogueAt(query({ page: raw }));

      expect(data.page).toBeGreaterThanOrEqual(1);
      expect(data.page).toBeLessThanOrEqual(data.totalPages);
      expect(data.books.length).toBeGreaterThan(0);
    });
  }

  it('changer de filtre revient à la page 1 même avec un ancien numéro de page hors bornes', async () => {
    seedBooks(30);
    createBook('Zola en vente', 'Émile Zola', { price: '5', saleStock: '1' });

    // Page 2 valide pour la liste complète, mais hors bornes une fois le filtre appliqué.
    const data = await catalogueAt(query({ page: '2', vente: '1' }));

    expect(data.page).toBe(1);
    expect(data.totalItems).toBe(1);
    expect(data.books).toHaveLength(1);
  });

  it('un paramètre de page manipulé dans l’URL ne contourne pas le contrôle d’accès de l’emprunt', async () => {
    const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');
    const bookId = createBook('Candide', 'Voltaire');

    const asBookseller = {
      ...postForm('/?/emprunter&page=999', { bookId: String(bookId) }),
      locals: { user: bookseller }
    };
    expectForbidden(
      await outcomeOf(() =>
        catalogueActions.emprunter(
          asBookseller as unknown as Parameters<typeof catalogueActions.emprunter>[0]
        )
      ),
      BORROWER_ONLY_MESSAGE
    );

    const asAnonymous = {
      ...postForm('/?/emprunter&page=abc', { bookId: String(bookId) }),
      locals: { user: null }
    };
    expectLoginRedirect(
      await outcomeOf(() =>
        catalogueActions.emprunter(
          asAnonymous as unknown as Parameters<typeof catalogueActions.emprunter>[0]
        )
      )
    );
    expect(loanRows()).toEqual([]);
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

  it('rend les colonnes Prix et Vente dans l’ordre prévu', () => {
    const { body } = render(CatalogueTable, { props: { books } });

    const headers = [...body.matchAll(/<th[^>]*scope="col"[^>]*>([^<]*)<\/th>/g)].map(
      (match) => match[1]
    );
    expect(headers).toEqual(['Titre', 'Auteur', 'Prix', 'Prêt', 'Vente']);
    expect(body).toMatch(/<th class="col-price[^"]*"[^>]*>Prix<\/th>/);
    expect(body).toMatch(/<th class="col-sale[^"]*"[^>]*>Vente<\/th>/);
  });

  it('affiche le prix au format français et une cellule vide pour un livre sans prix', () => {
    const { body } = render(CatalogueTable, { props: { books } });

    const priceCells = [...body.matchAll(/<td class="col-price[^"]*"[^>]*>([^<]*)<\/td>/g)].map(
      (match) => match[1]
    );
    expect(priceCells).toEqual([formatPrice(1250), '']);
    expect(formatPrice(1250)).toMatch(/^12,50\s€$/u);
  });

  it('n’affiche que « En vente » ou « Épuisé » dans la colonne Vente, jamais un stock', async () => {
    const bookId = createBook('Germinal', 'Émile Zola', { price: '12,50', saleStock: '137' });
    createBook('Candide', 'Voltaire', { price: '8', saleStock: '0' });
    createBook('Nana', 'Émile Zola');
    const { books: loaded } = await catalogueAt('');

    const { body } = render(CatalogueTable, { props: { books: loaded } });

    const saleCells = [...body.matchAll(/<td class="col-sale[^"]*"[^>]*>(.*?)<\/td>/g)].map((match) =>
      match[1].replace(/<[^>]*>/g, '').trim()
    );
    expect(saleCells).toEqual(['Épuisé', 'En vente', 'Épuisé']);
    expect(body).toContain('sale-status--on');
    expect(body).toContain('sale-status--off');
    // Les classes de portée Svelte (svelte-xxxx) sont retirées avant la recherche du nombre.
    expect(body.replace(/svelte-[a-z0-9]+/g, '')).not.toMatch(/\b137\b/);
    expect(loaded.find((book) => book.id === bookId)?.saleStatus).toBe('on-sale');
  });

  it('rend l’état vide fourni à la place de la table quand la liste est vide', () => {
    const { body } = render(CatalogueTable, {
      props: {
        books: [],
        empty: createRawSnippet(() => ({ render: () => '<p>Aucun résultat</p>' }))
      }
    });

    expect(body).toContain('Aucun résultat');
    expect(body).not.toContain('<table');
  });
});

describe('page / (catalogue public)', () => {
  type PageData = CatalogueData & { user: { displayName: string; role: Role } | null };

  const onSale: CatalogueEntry = {
    id: 1,
    title: 'Germinal',
    author: 'Émile Zola',
    status: 'borrowed',
    priceCents: 1250,
    saleStatus: 'on-sale'
  };

  function renderPage(data: Partial<PageData>): string {
    const books = data.books ?? [];
    const props = {
      data: {
        user: null,
        books,
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        totalItems: books.length,
        totalPages: 1,
        pageQuery: '',
        filters: {},
        searchMaxLength: BOOK_TEXT_MAX_LENGTH,
        ...data
      },
      form: null
    };
    return render(CataloguePage, { props: props as never }).body;
  }

  it('rend un formulaire GET étiqueté, sans lien de réinitialisation par défaut', () => {
    const body = renderPage({ books: [onSale] });

    expect(body).toMatch(/<form class="filters" method="GET" role="search"[^>]*>/);
    expect(body).not.toMatch(/<form class="filters"[^>]*action=/);
    expect(body).toContain('<label for="catalogue-q">Titre ou auteur</label>');
    expect(body).toMatch(/<input id="catalogue-q" name="q" type="search"[^>]*maxlength="200"/);
    expect(body).toMatch(/<legend>Disponibilité<\/legend>/);
    expect(body).toMatch(
      /<label class="check">\s*<input type="checkbox" name="pret" value="1"[^>]*>\s*Disponible au prêt\s*<\/label>/
    );
    expect(body).toMatch(
      /<label class="check">\s*<input type="checkbox" name="vente" value="1"[^>]*>\s*En vente\s*<\/label>/
    );
    expect(body).not.toMatch(/name="(pret|vente)"[^>]*checked/);
    expect(body).toMatch(/<button class="btn btn--primary" type="submit">Filtrer<\/button>/);
    expect(body).not.toContain('Réinitialiser');
    expect(body).not.toContain('filters__result');
    expect(body).not.toMatch(/\son[a-z]+=/);
    expect(body).toContain('<table');
  });

  it('réaffiche les filtres actifs, le nombre de résultats et le lien de réinitialisation', () => {
    const body = renderPage({
      books: [onSale, { ...onSale, id: 2, title: 'Nana' }],
      filters: { text: 'zola', availableForSale: true }
    });

    expect(body).toMatch(/name="q"[^>]*value="zola"/);
    expect(body).toMatch(/name="vente" value="1"[^>]*checked/);
    expect(body).not.toMatch(/name="pret" value="1"[^>]*checked/);
    expect(body).toMatch(/<a href="\/">Réinitialiser<\/a>/);
    expect(body).toContain('2 livres correspondent.');
    expect(renderPage({ books: [onSale], filters: { availableForLoan: true } })).toContain(
      '1 livre correspond.'
    );
  });

  it('affiche un état vide propre aux filtres, avec la bande de filtres et un lien vers tout le catalogue', () => {
    const body = renderPage({ books: [], filters: { availableForLoan: true } });

    expect(body).toContain('class="empty"');
    expect(body).toContain('Aucun livre ne correspond à ces filtres.');
    expect(body).toMatch(/<a href="\/">Afficher tout le catalogue<\/a>/);
    expect(body).toContain('<form class="filters"');
    expect(body).not.toContain('Le catalogue ne contient encore aucun livre.');
    expect(body).not.toContain('<table');
    expect(body).not.toContain('correspondent.');
  });

  it('garde l’état vide du catalogue réellement vide, sans bande de filtres', () => {
    const body = renderPage({ books: [], filters: {} });

    expect(body).toContain('Le catalogue ne contient encore aucun livre.');
    expect(body).not.toContain('Aucun livre ne correspond');
    expect(body).not.toContain('<form class="filters"');
  });

  it('rend un terme de recherche et un titre hostiles comme du texte', () => {
    const hostileQuery = `"><script>alert(1)</script>%_`;
    const body = renderPage({
      books: [{ ...onSale, title: HOSTILE_TITLE }],
      filters: { text: hostileQuery }
    });

    expect(body).not.toContain('<script');
    expect(body).toMatch(/name="q"[^>]*value="&quot;(>|&gt;)&lt;script(>|&gt;)alert\(1\)&lt;\/script(>|&gt;)%_"/);
    expect(body).toMatch(/&lt;script(>|&gt;)alert\(1\)&lt;\/script(>|&gt;)/);
  });

  it('rend prix et « En vente » depuis les données du load, sans stock chiffré', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur Secret');
    createBook('Germinal', 'Émile Zola', { price: '12,50', saleStock: '137' });
    const data = await catalogueAt('?vente=1');

    const body = renderPage({
      ...data,
      user: { displayName: borrower.displayName, role: 'borrower' }
    });

    expect(body).toContain(formatPrice(1250));
    expect(body).toContain('En vente');
    expect(body).not.toContain('Épuisé');
    expect(body.replace(/svelte-[a-z0-9]+/g, '')).not.toMatch(/\b137\b/);
    // Livre disponible et emprunteur connecté : la colonne Action reste en place.
    expect(body).toContain('col-action');
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
  it('liste les prêts en cours par échéance avec le badge de retard dès le lendemain', async () => {
    // 22:30 UTC le 9 mai = 00:30 le 10 mai à Paris.
    setNow('2026-05-09T22:30:00Z');
    const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');
    const borrower = insertUser('lecteur@example.fr', 'Lectrice Martin');
    const dueToday = insertLoan(createBook('A', 'Auteur'), borrower.id, '2026-04-10', '2026-05-10');
    const dueYesterday = insertLoan(createBook('B', 'Auteur'), borrower.id, '2026-04-09', '2026-05-09');
    insertLoan(createBook('C', 'Auteur'), borrower.id, '2026-04-01', '2026-05-01', '2026-04-20');

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
    // 22:30 UTC le 2 mai = 00:30 le 3 mai à Paris : le retour porte le 3 mai.
    setNow('2026-05-02T22:30:00Z');
    const { bookseller, bookId, loanId } = setupActiveLoan();

    const outcome = await returnAs(bookseller, { loanId: String(loanId) });

    expect(outcome).toEqual({ returned: { title: 'Nana', borrowerName: 'Lectrice Martin' } });
    expect(loanRows()).toEqual([
      expect.objectContaining({
        id: loanId,
        book_id: bookId,
        borrowed_on: parisDay(-32),
        due_on: parisDay(-2),
        returned_on: '2026-05-03'
      })
    ]);
    expect((await catalogueFor(null))[0].status).toBe('available');
    expect(((await returnsLoadAs(bookseller)) as { loans: ActiveLoan[] }).loans).toEqual([]);
  });

  it('refuse un double retour sans modifier la date enregistrée', async () => {
    setNow('2026-05-02T10:00:00Z');
    const { bookseller, loanId } = setupActiveLoan();
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

describe('purges de rétention déclenchées par les actions', () => {
  function loanIds(): number[] {
    return loanRows().map((row) => row.id);
  }

  it('efface un prêt rendu hors borne après un emprunt réussi, sans toucher au prêt créé', async () => {
    setNow('2026-06-15T09:00:00Z');
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    const bookId = createBook('Candide', 'Voltaire');
    const stale = insertStaleReturnedLoan(borrower.id);
    expect(loanIds()).toContain(stale);

    const outcome = await borrowAs(borrower, { bookId: String(bookId) });

    const dueOn = parisDay(LOAN_DURATION_DAYS);
    expect(outcome).toEqual({
      borrowed: { title: 'Candide', dueOn: { iso: dueOn, label: formatDateFr(dueOn) } }
    });
    expect(loanIds()).not.toContain(stale);
    expect(loanRows()).toEqual([
      expect.objectContaining({
        book_id: bookId,
        user_id: borrower.id,
        borrowed_on: parisDay(0),
        due_on: dueOn,
        returned_on: null
      })
    ]);
  });

  it('efface un prêt rendu hors borne après un retour réussi, sans toucher au prêt rendu', async () => {
    setNow('2026-06-15T09:00:00Z');
    const { bookseller, borrower, loanId } = setupActiveLoan();
    const stale = insertStaleReturnedLoan(borrower.id);

    const outcome = await returnAs(bookseller, { loanId: String(loanId) });

    expect(outcome).toEqual({ returned: { title: 'Nana', borrowerName: 'Lectrice Martin' } });
    expect(loanIds()).toEqual([loanId]);
    expect(loanIds()).not.toContain(stale);
    expect(loanRows()[0].returned_on).toBe(parisDay(0));
  });

  it('garde un prêt rendu hors borne après un emprunt refusé (400, 403, 404, 409)', async () => {
    setNow('2026-06-15T09:00:00Z');
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    const bookseller = insertUser('libraire@example.fr', 'Libraire', 'bookseller');
    const bookId = createBook('Candide', 'Voltaire');
    const stale = insertStaleReturnedLoan(borrower.id);

    expect(asFailure(await borrowAs(borrower, { bookId: 'abc' })).status).toBe(400);
    expect(asFailure(await borrowAs(borrower, { bookId: '999999' })).status).toBe(404);
    expectForbidden(await borrowAs(bookseller, { bookId: String(bookId) }), BORROWER_ONLY_MESSAGE);
    expectLoginRedirect(await borrowAs(null, { bookId: String(bookId) }));
    // Prêt actif posé sans passer par l'action : le conflit ne suit donc aucun succès.
    const active = insertLoan(bookId, borrower.id, parisDay(-1), parisDay(29));
    expect(asFailure(await borrowAs(borrower, { bookId: String(bookId) })).status).toBe(409);

    expect(loanIds()).toEqual([stale, active]);
  });

  it('garde un prêt rendu hors borne après un retour refusé (400, 403, 404, 409)', async () => {
    setNow('2026-06-15T09:00:00Z');
    const { bookseller, borrower, loanId } = setupActiveLoan();
    const stale = insertStaleReturnedLoan(borrower.id);
    const alreadyReturned = insertLoan(
      createBook('Rendu récemment', 'Auteur'),
      borrower.id,
      parisDay(-10),
      parisDay(20),
      parisDay(0)
    );

    expect(asFailure(await returnAs(bookseller, { loanId: 'abc' })).status).toBe(400);
    expect(asFailure(await returnAs(bookseller, { loanId: '424242' })).status).toBe(404);
    expect(asFailure(await returnAs(bookseller, { loanId: String(alreadyReturned) })).status).toBe(
      409
    );
    expectForbidden(await returnAs(borrower, { loanId: String(loanId) }), BOOKSELLER_ONLY_MESSAGE);
    expectLoginRedirect(await returnAs(null, { loanId: String(loanId) }));

    expect(loanIds()).toEqual([loanId, stale, alreadyReturned]);
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

    const data = (await myLoansAs(b, `?userId=${a.id}&user=${a.id}`)) as MyLoansData;

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
    expect(((await myLoansAs(borrower)) as MyLoansData).active[0].overdue).toBe(false);

    setNow('2026-05-01T22:00:00Z');
    expect(((await myLoansAs(borrower)) as MyLoansData).active[0].overdue).toBe(true);
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

    const { items: returned } = listBorrowerReturnedLoans(getDb(), borrower.id, 1);

    expect(returned.map((loan) => loan.title)).toEqual(['Récent', 'Ancien']);
  });

  it('affiche le badge « En retard » et un titre hostile comme du texte', () => {
    const data: MyLoansData = {
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
