import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_MEMORY_DATABASE_PATH, openDatabase, type Db } from '../db';
import {
  BOOK_TEXT_MAX_LENGTH,
  CATALOGUE_FILTER_PARAMS,
  PRICE_DECIMALS_MESSAGE,
  PRICE_INVALID_MESSAGE,
  PRICE_MAX_CENTS,
  PRICE_MISSING_MESSAGE,
  PRICE_NOT_POSITIVE_MESSAGE,
  PRICE_TOO_HIGH_MESSAGE,
  SALE_STOCK_INVALID_MESSAGE,
  SALE_STOCK_MAX,
  SALE_STOCK_NEGATIVE_MESSAGE,
  SALE_STOCK_TOO_HIGH_MESSAGE,
  addBook,
  catalogueFiltersFromSearchParams,
  formatPrice,
  formatPriceInput,
  listCatalogue,
  normalizeCatalogueFilters,
  validateBook,
  validateOptionalPrice,
  validatePrice,
  validateSaleStock,
  type BookInput,
  type CatalogueEntry
} from '.';

const SQL_PAYLOAD = "'; DROP TABLE books;--";
const DISTINCTIVE_STOCK = 137;
const EXPECTED_TABLES = [
  'books',
  'loans',
  'login_failures',
  'sales',
  'security_events',
  'sessions',
  'users'
];

let db: Db;

beforeEach(() => {
  db = openDatabase(IN_MEMORY_DATABASE_PATH);
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

function createBook(title: string, author: string, sale: Partial<BookInput> = {}): number {
  const created = addBook(db, { title, author, ...sale });
  if (!created.ok) throw new Error('Livre de test non créé.');
  return created.book.id;
}

function borrow(bookId: number, returnedOn: string | null = null): void {
  const user = db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, 'Lecteur Secret', 'hash-factice', 'borrower', 0)`
    )
    .run(`lecteur${bookId}@example.fr`);
  db.prepare(
    'INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on) VALUES (?, ?, ?, ?, ?)'
  ).run(bookId, user.lastInsertRowid, '2026-09-01', '2026-10-01', returnedOn);
}

function titles(entries: CatalogueEntry[]): string[] {
  return entries.map((entry) => entry.title);
}

/** Livres de la page (page 1 par défaut), filtres compris. */
function books(filters: Parameters<typeof listCatalogue>[1] = {}, page = 1): CatalogueEntry[] {
  return listCatalogue(db, filters, page).items;
}

function tableNames(): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

/** Espaces insécables d'Intl ramenées à des espaces simples. */
function plainSpaces(value: string): string {
  return value.replace(/\s/g, ' ');
}

describe('listCatalogue : forme des lignes', () => {
  it('expose id, titre, auteur, prêt, prix et vente, jamais le stock chiffré', () => {
    const onSale = createBook('Germinal', 'Émile Zola', {
      price: '12,50',
      saleStock: String(DISTINCTIVE_STOCK)
    });
    borrow(onSale);

    for (const filters of [{}, { availableForSale: true }, { text: 'zola' }]) {
      const found = books(filters);

      expect(found).toEqual([
        {
          id: onSale,
          title: 'Germinal',
          author: 'Émile Zola',
          status: 'borrowed',
          priceCents: 1250,
          saleStatus: 'on-sale'
        }
      ]);
      expect(Object.keys(found[0]).sort()).toEqual([
        'author',
        'id',
        'priceCents',
        'saleStatus',
        'status',
        'title'
      ]);
      const serialized = JSON.stringify(found);
      expect(serialized).not.toContain(String(DISTINCTIVE_STOCK));
      expect(serialized).not.toMatch(/stock|lecteur|Lecteur Secret|2026-10-01|2026-09-01/i);
    }
  });

  it('ne sélectionne pas sale_stock parmi les colonnes renvoyées par la requête de lecture', () => {
    createBook('Germinal', 'Émile Zola', { price: '12', saleStock: String(DISTINCTIVE_STOCK) });
    const prepare = vi.spyOn(db, 'prepare');

    listCatalogue(db, { text: 'germinal', availableForLoan: true, availableForSale: true });

    const statements = prepare.mock.results.map(
      (result) => result.value as unknown as Database.Statement
    );
    // La requête COUNT(*) n'a qu'une colonne ; seule la requête de lecture importe ici.
    const readStatements = statements.filter((statement) => statement.columns().length > 1);
    expect(readStatements).not.toHaveLength(0);
    for (const statement of readStatements) {
      const columns = statement.columns().map((column) => column.name);
      expect(columns).toEqual(['id', 'title', 'author', 'price_cents', 'borrowed', 'on_sale']);
      expect(columns.join(' ')).not.toMatch(/stock/);
    }
  });

  it('« En vente » exige un prix et du stock ; sinon « Épuisé », prix nul si absent', () => {
    createBook('A prix et stock', 'Auteur', { price: '9,90', saleStock: '1' });
    createBook('B prix sans stock', 'Auteur', { price: '9,90' });
    createBook('C stock sans prix', 'Auteur', { saleStock: '5' });
    createBook('D ni prix ni stock', 'Auteur');

    expect(
      books().map(({ title, priceCents, saleStatus }) => ({ title, priceCents, saleStatus }))
    ).toEqual([
      { title: 'A prix et stock', priceCents: 990, saleStatus: 'on-sale' },
      { title: 'B prix sans stock', priceCents: 990, saleStatus: 'sold-out' },
      { title: 'C stock sans prix', priceCents: null, saleStatus: 'sold-out' },
      { title: 'D ni prix ni stock', priceCents: null, saleStatus: 'sold-out' }
    ]);
  });

  it('le stock de vente reste indépendant du prêt', () => {
    const id = createBook('Nana', 'Émile Zola', { price: '8', saleStock: '2' });
    borrow(id);

    expect(books()[0]).toMatchObject({ status: 'borrowed', saleStatus: 'on-sale' });
  });
});

describe('listCatalogue : filtres', () => {
  let borrowedForSale: number;

  beforeEach(() => {
    borrowedForSale = createBook('Germinal', 'Émile Zola', { price: '12,50', saleStock: '3' });
    borrow(borrowedForSale);
    createBook('Candide', 'Voltaire', { price: '5', saleStock: '1' });
    createBook('L’Étranger', 'Albert Camus');
    const returned = createBook('Nana', 'Émile Zola', { price: '7' });
    borrow(returned, '2026-09-10');
  });

  it('sans filtre, renvoie tout le catalogue trié par titre puis auteur', () => {
    expect(titles(books())).toEqual(['Candide', 'Germinal', 'L’Étranger', 'Nana']);
  });

  it('cherche dans le titre et l’auteur, sans tenir compte de la casse ni des accents', () => {
    expect(titles(books({ text: 'emile' }))).toEqual(['Germinal', 'Nana']);
    expect(titles(books({ text: 'ZOLA' }))).toEqual(['Germinal', 'Nana']);
    expect(titles(books({ text: 'étranger' }))).toEqual(['L’Étranger']);
    expect(titles(books({ text: 'ETRANGER' }))).toEqual(['L’Étranger']);
    expect(titles(books({ text: 'cand' }))).toEqual(['Candide']);
    expect(titles(books({ text: '  camus  ' }))).toEqual(['L’Étranger']);
  });

  it('développe les ligatures comme la collation française', () => {
    createBook('Œuvres complètes', 'Anonyme');

    expect(titles(books({ text: 'oeuvres' }))).toEqual(['Œuvres complètes']);
    expect(titles(books({ text: 'ŒUVRES' }))).toEqual(['Œuvres complètes']);
  });

  it('filtre les livres disponibles au prêt (un prêt rendu ne compte plus)', () => {
    expect(titles(books({ availableForLoan: true }))).toEqual([
      'Candide',
      'L’Étranger',
      'Nana'
    ]);
  });

  it('filtre les livres disponibles à la vente', () => {
    expect(titles(books({ availableForSale: true }))).toEqual(['Candide', 'Germinal']);
  });

  it('combine les filtres par ET', () => {
    expect(
      titles(books({ text: 'zola', availableForLoan: true, availableForSale: true }))
    ).toEqual([]);
    expect(titles(books({ text: 'zola', availableForSale: true }))).toEqual(['Germinal']);
    expect(titles(books({ text: 'zola', availableForLoan: true }))).toEqual(['Nana']);
    expect(titles(books({ availableForLoan: true, availableForSale: true }))).toEqual([
      'Candide'
    ]);
  });

  it('renvoie une liste vide quand rien ne correspond', () => {
    expect(books({ text: 'introuvable' })).toEqual([]);
  });

  const ignoredValues: [string, unknown][] = [
    ['absente', undefined],
    ['nulle', null],
    ['vide', ''],
    ['« false »', 'false'],
    ['« 0 »', '0'],
    ['« oui »', 'oui'],
    ['« ON »', 'ON'],
    ['booléen faux', false],
    ['nombre', 1],
    ['tableau', ['on']],
    ['charge SQL', "1' OR '1'='1"]
  ];

  for (const [label, value] of ignoredValues) {
    it(`ignore une valeur de disponibilité ${label} et renvoie tout le catalogue`, () => {
      expect(
        titles(books({ availableForLoan: value, availableForSale: value }))
      ).toEqual(['Candide', 'Germinal', 'L’Étranger', 'Nana']);
    });
  }

  for (const [label, text] of [
    ['vide', ''],
    ['fait d’espaces', '   '],
    ['fait de caractères de contrôle', ' \n'],
    ['non textuel', 42],
    ['tableau', ['zola']],
    ['nul', null]
  ] as [string, unknown][]) {
    it(`ignore un texte de recherche ${label}`, () => {
      expect(books({ text })).toHaveLength(4);
    });
  }

  it('accepte les valeurs d’activation « on », « 1 » et true', () => {
    for (const value of ['on', '1', true]) {
      expect(titles(books({ availableForSale: value }))).toEqual(['Candide', 'Germinal']);
    }
  });
});

describe('listCatalogue : valeurs hostiles', () => {
  beforeEach(() => {
    createBook('100% Nature', 'Auteur');
    createBook('A_B', 'Auteur');
    createBook('Chemin\\Fichier', 'Auteur');
    createBook('Candide', 'Voltaire');
    createBook(SQL_PAYLOAD, SQL_PAYLOAD);
  });

  it('traite les jokers % et _ littéralement', () => {
    expect(titles(books({ text: '%' }))).toEqual(['100% Nature']);
    expect(titles(books({ text: '_' }))).toEqual(['A_B']);
    expect(titles(books({ text: '0%N' }))).toEqual([]);
    expect(titles(books({ text: 'A%B' }))).toEqual([]);
    expect(titles(books({ text: 'C_ndide' }))).toEqual([]);
  });

  it('traite la barre oblique inverse littéralement', () => {
    expect(titles(books({ text: '\\' }))).toEqual(['Chemin\\Fichier']);
    expect(titles(books({ text: '\\%' }))).toEqual([]);
  });

  it('recherche une charge utile SQL littéralement, tables intactes', () => {
    const before = tableNames();

    expect(titles(books({ text: SQL_PAYLOAD }))).toEqual([SQL_PAYLOAD]);
    expect(titles(books({ text: "' OR 1=1 --" }))).toEqual([]);
    expect(tableNames()).toEqual(before);
    expect(tableNames()).toEqual(EXPECTED_TABLES);
  });

  it('borne le texte à BOOK_TEXT_MAX_LENGTH caractères', () => {
    const longest = 'x'.repeat(BOOK_TEXT_MAX_LENGTH);
    createBook(longest, 'Auteur');

    expect(titles(books({ text: `${longest}yyyy` }))).toEqual([longest]);
    expect(normalizeCatalogueFilters({ text: 'z'.repeat(100_000) }).text).toHaveLength(
      BOOK_TEXT_MAX_LENGTH
    );
    expect(books({ text: 'z'.repeat(100_000) })).toEqual([]);
  });

  it('remplace les caractères de contrôle par des espaces', () => {
    expect(normalizeCatalogueFilters({ text: ' Candide' })).toEqual({ text: 'Candide' });
    expect(normalizeCatalogueFilters({ text: 'Can dide' })).toEqual({ text: 'Can dide' });
    expect(titles(books({ text: 'Cand ide' }))).toEqual([]);
  });
});

describe('listCatalogue : pagination', () => {
  function seedBooks(count: number): void {
    for (let i = 0; i < count; i += 1) {
      createBook(`Livre ${String(i).padStart(4, '0')}`, 'Auteur');
    }
  }

  it('trie en SQL par titre puis auteur (catalogue_fold)', () => {
    createBook('candide', 'Zorro');
    createBook('Candide', 'Adèle');
    createBook('Abîme', 'Auteur');

    const page = listCatalogue(db);

    // « candide » et « Candide » plient au même titre ; l'auteur les départage.
    expect(page.items.map((book) => book.title)).toEqual(['Abîme', 'Candide', 'candide']);
    expect(page.items.map((book) => book.author)).toEqual(['Auteur', 'Adèle', 'Zorro']);
  });

  it('départage par id un même titre et un même auteur (pliage identique)', () => {
    const first = createBook('candide', 'adèle');
    const second = createBook('Candide', 'Adèle');

    const page = listCatalogue(db);

    expect(page.items.map((book) => book.id)).toEqual([first, second]);
  });

  it('ne renvoie jamais plus de 25 lignes et expose le total séparément', () => {
    seedBooks(60);

    const page = listCatalogue(db, {}, 1);

    expect(page.items).toHaveLength(25);
    expect(page.totalItems).toBe(60);
    expect(page.totalPages).toBe(3);
    expect(page.pageSize).toBe(25);
    expect(page.page).toBe(1);
  });

  it('le total et la pagination tiennent compte des filtres', () => {
    seedBooks(30);
    createBook('Zola en vente', 'Émile Zola', { price: '5', saleStock: '1' });

    const page = listCatalogue(db, { availableForSale: true }, 1);

    expect(page.totalItems).toBe(1);
    expect(page.totalPages).toBe(1);
    expect(page.items).toHaveLength(1);
  });

  it('deux pages consécutives ne partagent aucun identifiant et couvrent tout', () => {
    seedBooks(40);

    const first = listCatalogue(db, {}, 1);
    const second = listCatalogue(db, {}, 2);

    const firstIds = first.items.map((book) => book.id);
    const secondIds = second.items.map((book) => book.id);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    expect(firstIds).toHaveLength(25);
    expect(secondIds).toHaveLength(15);
  });

  it('borne silencieusement une page invalide ou hors bornes, sans erreur', () => {
    seedBooks(30);

    expect(listCatalogue(db, {}, 0).page).toBe(1);
    expect(listCatalogue(db, {}, -1).page).toBe(1);
    expect(listCatalogue(db, {}, 1.5).page).toBe(1);
    expect(listCatalogue(db, {}, Number.NaN).page).toBe(1);
    expect(listCatalogue(db, {}, 999).page).toBe(2);
    expect(listCatalogue(db, {}, 999).items.length).toBeGreaterThan(0);
  });

  it('une base vide renvoie une page vide sur la page 1, sans erreur', () => {
    const page = listCatalogue(db, {}, 5);

    expect(page).toEqual({ items: [], page: 1, pageSize: 25, totalItems: 0, totalPages: 1 });
  });
});

describe('catalogueFiltersFromSearchParams', () => {
  it('lit q, pret et vente dans l’URL', () => {
    expect(CATALOGUE_FILTER_PARAMS).toEqual({ text: 'q', availableForLoan: 'pret', availableForSale: 'vente' });
    expect(catalogueFiltersFromSearchParams(new URLSearchParams('q=+Zola+&pret=on&vente=1'))).toEqual({
      text: 'Zola',
      availableForLoan: true,
      availableForSale: true
    });
  });

  it('ignore les paramètres absents, vides, inconnus ou de valeur inconnue', () => {
    expect(catalogueFiltersFromSearchParams(new URLSearchParams(''))).toEqual({});
    expect(
      catalogueFiltersFromSearchParams(new URLSearchParams('q=&pret=&vente=peut-etre&tri=prix'))
    ).toEqual({});
  });
});

describe('prix', () => {
  const accepted: [string, number][] = [
    ['12', 1200],
    ['12,50', 1250],
    ['12.50', 1250],
    [' 12,5 ', 1250],
    ['0,01', 1],
    ['0.99', 99],
    ['007', 700],
    ['12,50 €', 1250],
    ['12€', 1200],
    ['10000', PRICE_MAX_CENTS],
    ['10000,00', PRICE_MAX_CENTS]
  ];

  for (const [raw, cents] of accepted) {
    it(`accepte « ${raw} » (${cents} centimes)`, () => {
      expect(validatePrice(raw)).toEqual({ ok: true, value: cents });
    });
  }

  const refused: [string, unknown, string][] = [
    ['vide', '', PRICE_MISSING_MESSAGE],
    ['fait d’espaces', '   ', PRICE_MISSING_MESSAGE],
    ['absent', undefined, PRICE_MISSING_MESSAGE],
    ['nul (null)', null, PRICE_MISSING_MESSAGE],
    ['négatif', '-12', PRICE_NOT_POSITIVE_MESSAGE],
    ['négatif décimal', '-0,50', PRICE_NOT_POSITIVE_MESSAGE],
    ['zéro', '0', PRICE_NOT_POSITIVE_MESSAGE],
    ['zéro décimal', '0,00', PRICE_NOT_POSITIVE_MESSAGE],
    ['à trois décimales', '12,505', PRICE_DECIMALS_MESSAGE],
    ['à trois décimales avec point', '12.345', PRICE_DECIMALS_MESSAGE],
    ['au-delà de la borne', '10000,01', PRICE_TOO_HIGH_MESSAGE],
    ['démesuré', '9'.repeat(400), PRICE_TOO_HIGH_MESSAGE],
    ['alphabétique', 'douze', PRICE_INVALID_MESSAGE],
    ['en notation exponentielle', '1e3', PRICE_INVALID_MESSAGE],
    ['infini', 'Infinity', PRICE_INVALID_MESSAGE],
    ['NaN', 'NaN', PRICE_INVALID_MESSAGE],
    ['hexadécimal', '0x10', PRICE_INVALID_MESSAGE],
    ['avec signe plus', '+12', PRICE_INVALID_MESSAGE],
    ['à deux séparateurs', '12,50,00', PRICE_INVALID_MESSAGE],
    ['sans partie entière', ',50', PRICE_INVALID_MESSAGE],
    ['avec séparateur final', '12,', PRICE_INVALID_MESSAGE],
    ['avec espace interne', '12 50', PRICE_INVALID_MESSAGE],
    ['en chiffres non ASCII', '١٢', PRICE_INVALID_MESSAGE],
    ['avec caractère de contrôle', '12 ', PRICE_INVALID_MESSAGE],
    ['avec charge SQL', SQL_PAYLOAD, PRICE_INVALID_MESSAGE],
    ['avec charge SQL après un nombre', '12; DROP TABLE books;--', PRICE_INVALID_MESSAGE],
    ['de type nombre', 12, PRICE_INVALID_MESSAGE],
    ['de type fichier', new File(['12'], 'prix.txt'), PRICE_INVALID_MESSAGE]
  ];

  for (const [label, raw, message] of refused) {
    it(`refuse un prix ${label} avec un message en français`, () => {
      expect(validatePrice(raw)).toEqual({ ok: false, error: message });
    });
  }

  it('rend le prix facultatif quand il est absent ou vide', () => {
    expect(validateOptionalPrice(undefined)).toEqual({ ok: true, value: null });
    expect(validateOptionalPrice(null)).toEqual({ ok: true, value: null });
    expect(validateOptionalPrice('  ')).toEqual({ ok: true, value: null });
    expect(validateOptionalPrice('12,50')).toEqual({ ok: true, value: 1250 });
    expect(validateOptionalPrice('0')).toEqual({ ok: false, error: PRICE_NOT_POSITIVE_MESSAGE });
  });

  it('formate en euros au format français', () => {
    expect(plainSpaces(formatPrice(1250))).toBe('12,50 €');
    expect(plainSpaces(formatPrice(1200))).toBe('12,00 €');
    expect(plainSpaces(formatPrice(1))).toBe('0,01 €');
    expect(plainSpaces(formatPrice(PRICE_MAX_CENTS))).toBe('10 000,00 €');
    expect(plainSpaces(PRICE_TOO_HIGH_MESSAGE)).toBe('Le prix ne doit pas dépasser 10 000,00 €.');
  });

  it('formate le prix pour la saisie et relit la valeur à l’identique', () => {
    for (const cents of [1, 99, 100, 1250, 1999, PRICE_MAX_CENTS]) {
      expect(validatePrice(formatPriceInput(cents))).toEqual({ ok: true, value: cents });
      expect(validatePrice(formatPrice(cents).replace(/\s/g, ''))).toEqual({ ok: true, value: cents });
    }
    expect(formatPriceInput(1250)).toBe('12,50');
  });
});

describe('stock de vente', () => {
  const accepted: [unknown, number][] = [
    [undefined, 0],
    [null, 0],
    ['', 0],
    ['0', 0],
    [' 3 ', 3],
    ['007', 7],
    [String(SALE_STOCK_MAX), SALE_STOCK_MAX]
  ];

  for (const [raw, stock] of accepted) {
    it(`accepte ${JSON.stringify(raw) ?? 'undefined'} (${stock})`, () => {
      expect(validateSaleStock(raw)).toEqual({ ok: true, value: stock });
    });
  }

  const refused: [string, unknown, string][] = [
    ['négatif', '-1', SALE_STOCK_NEGATIVE_MESSAGE],
    ['au-delà de la borne', String(SALE_STOCK_MAX + 1), SALE_STOCK_TOO_HIGH_MESSAGE],
    ['démesuré', '9'.repeat(400), SALE_STOCK_TOO_HIGH_MESSAGE],
    ['décimal', '1.5', SALE_STOCK_INVALID_MESSAGE],
    ['décimal à virgule', '1,5', SALE_STOCK_INVALID_MESSAGE],
    ['en notation exponentielle', '1e3', SALE_STOCK_INVALID_MESSAGE],
    ['alphabétique', 'trois', SALE_STOCK_INVALID_MESSAGE],
    ['avec charge SQL', '3 OR 1=1', SALE_STOCK_INVALID_MESSAGE],
    ['de type nombre', 3, SALE_STOCK_INVALID_MESSAGE]
  ];

  for (const [label, raw, message] of refused) {
    it(`refuse un stock ${label}`, () => {
      expect(validateSaleStock(raw)).toEqual({ ok: false, error: message });
    });
  }

  it('annonce la borne en français', () => {
    expect(plainSpaces(SALE_STOCK_TOO_HIGH_MESSAGE)).toBe(
      'Le stock de vente ne doit pas dépasser 10 000 exemplaires.'
    );
  });
});

describe('validateBook et addBook : prix et stock initial', () => {
  function storedBooks() {
    return db
      .prepare(
        `SELECT title, author, price_cents, typeof(price_cents) AS price_type, sale_stock
         FROM books ORDER BY id`
      )
      .all();
  }

  it('garde le prix et le stock facultatifs', () => {
    const created = addBook(db, { title: 'Candide', author: 'Voltaire' });

    expect(created).toEqual({
      ok: true,
      book: { id: expect.any(Number), title: 'Candide', author: 'Voltaire', priceCents: null, saleStock: 0 }
    });
    expect(storedBooks()).toEqual([
      { title: 'Candide', author: 'Voltaire', price_cents: null, price_type: 'null', sale_stock: 0 }
    ]);
  });

  it('enregistre le prix en centimes entiers et le stock initial', () => {
    const created = addBook(db, {
      title: ' Germinal ',
      author: 'Émile Zola',
      price: '12.50',
      saleStock: '4'
    });

    expect(created).toEqual({
      ok: true,
      book: { id: expect.any(Number), title: 'Germinal', author: 'Émile Zola', priceCents: 1250, saleStock: 4 }
    });
    expect(storedBooks()).toEqual([
      {
        title: 'Germinal',
        author: 'Émile Zola',
        price_cents: 1250,
        price_type: 'integer',
        sale_stock: 4
      }
    ]);
  });

  it('refuse un prix ou un stock invalide sans rien écrire, avec toutes les erreurs', () => {
    const created = addBook(db, { title: '', author: 'Voltaire', price: '-3', saleStock: '1.5' });

    expect(created).toEqual({
      ok: false,
      errors: {
        title: 'Saisissez un titre.',
        price: PRICE_NOT_POSITIVE_MESSAGE,
        saleStock: SALE_STOCK_INVALID_MESSAGE
      }
    });
    expect(storedBooks()).toEqual([]);
  });

  for (const [label, sale, field] of [
    ['un prix à trois décimales', { price: '1,999' }, 'price'],
    ['un prix au-delà de la borne', { price: '10000,01' }, 'price'],
    ['un prix contenant une charge SQL', { price: SQL_PAYLOAD }, 'price'],
    ['un stock au-delà de la borne', { saleStock: '10001' }, 'saleStock'],
    ['un stock négatif', { saleStock: '-2' }, 'saleStock']
  ] as [string, Partial<BookInput>, 'price' | 'saleStock'][]) {
    it(`refuse ${label} sans créer de livre`, () => {
      const validation = validateBook({ title: 'Candide', author: 'Voltaire', ...sale });
      const created = addBook(db, { title: 'Candide', author: 'Voltaire', ...sale });

      expect(validation.ok).toBe(false);
      expect(created).toEqual(validation);
      if (!created.ok) expect(Object.keys(created.errors)).toEqual([field]);
      expect(storedBooks()).toEqual([]);
      expect(tableNames()).toEqual(EXPECTED_TABLES);
    });
  }
});
