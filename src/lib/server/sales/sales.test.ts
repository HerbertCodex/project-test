import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth';
import {
  BOOKSELLER_ONLY_MESSAGE,
  PRICE_DECIMALS_MESSAGE,
  PRICE_INVALID_MESSAGE,
  PRICE_MAX_CENTS,
  PRICE_MISSING_MESSAGE,
  PRICE_NOT_POSITIVE_MESSAGE,
  PRICE_TOO_HIGH_MESSAGE,
  SALE_STOCK_MAX,
  SALE_STOCK_TOO_HIGH_MESSAGE,
  addBook,
  listCatalogue,
  type BookInput
} from '../catalogue';
import type { Clock } from '../dates';
import { IN_MEMORY_DATABASE_PATH, MIGRATIONS, migrate, openDatabase, type Db } from '../db';
import { BOOK_NOT_FOUND_MESSAGE, borrowBook, recordReturn } from '../loans';
import {
  QUANTITY_INVALID_MESSAGE,
  QUANTITY_TOO_HIGH_MESSAGE,
  QUANTITY_TOO_LOW_MESSAGE,
  SALE_NO_PRICE_MESSAGE,
  SALE_QUANTITY_MAX,
  listSaleCounter,
  recordSale,
  removeBookPrice,
  restockBook,
  saleInsufficientStockMessage,
  setBookPrice,
  validateQuantity
} from '.';

const SQL_PAYLOAD = "'; DROP TABLE books;--";
const EXPECTED_TABLES = [
  'books',
  'loans',
  'login_failures',
  'sales',
  'security_events',
  'sessions',
  'users'
];

// 22 h 30 UTC le 31 mars : déjà le 1er avril à Paris (heure d'été).
const clock: Clock = () => new Date('2026-03-31T22:30:00Z');
const PARIS_TODAY = '2026-04-01';

let db: Db;
let bookseller: AuthUser;
let borrower: AuthUser;

function createUser(email: string, role: AuthUser['role']): AuthUser {
  const result = db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, 'hash-factice', ?, 0)`
    )
    .run(email, `Compte ${role}`, role);
  return { id: Number(result.lastInsertRowid), email, displayName: `Compte ${role}`, role };
}

function createBook(sale: Partial<BookInput> = {}, title = 'Le Petit Prince'): number {
  const created = addBook(db, { title, author: 'Antoine de Saint-Exupéry', ...sale });
  if (!created.ok) throw new Error('Livre de test non créé.');
  return created.book.id;
}

type BookState = { price_cents: number | null; sale_stock: number };

function bookState(bookId: number): BookState {
  return db
    .prepare('SELECT price_cents, sale_stock FROM books WHERE id = ?')
    .get(bookId) as BookState;
}

type SaleRow = {
  book_id: number;
  bookseller_id: number;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  sold_on: string;
};

function salesRows(): SaleRow[] {
  return db
    .prepare(
      'SELECT book_id, bookseller_id, quantity, unit_price_cents, total_cents, sold_on FROM sales ORDER BY id'
    )
    .all() as SaleRow[];
}

function tableNames(): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

function loanStatus(bookId: number) {
  return listCatalogue(db).find((entry) => entry.id === bookId)?.status;
}

function saleStatus(bookId: number) {
  return listCatalogue(db).find((entry) => entry.id === bookId)?.saleStatus;
}

function sell(bookId: number | string, quantity: string, extra: Record<string, unknown> = {}) {
  return recordSale(db, bookseller, { ...extra, bookId: String(bookId), quantity }, clock);
}

beforeEach(() => {
  db = openDatabase(IN_MEMORY_DATABASE_PATH);
  bookseller = createUser('libraire@example.fr', 'bookseller');
  borrower = createUser('lecteur@example.fr', 'borrower');
});

afterEach(() => {
  db.close();
});

describe('validateQuantity', () => {
  it('accepte un entier de 1 à 1 000, espaces autour tolérées', () => {
    expect(validateQuantity('1')).toEqual({ ok: true, value: 1 });
    expect(validateQuantity(' 12 ')).toEqual({ ok: true, value: 12 });
    expect(validateQuantity(String(SALE_QUANTITY_MAX))).toEqual({ ok: true, value: 1000 });
  });

  it.each([
    ['0', QUANTITY_TOO_LOW_MESSAGE],
    ['-1', QUANTITY_TOO_LOW_MESSAGE],
    ['- 3', QUANTITY_TOO_LOW_MESSAGE],
    ['1001', QUANTITY_TOO_HIGH_MESSAGE],
    ['9'.repeat(400), QUANTITY_TOO_HIGH_MESSAGE],
    ['1,5', QUANTITY_INVALID_MESSAGE],
    ['1.5', QUANTITY_INVALID_MESSAGE],
    ['deux', QUANTITY_INVALID_MESSAGE],
    ['1e3', QUANTITY_INVALID_MESSAGE],
    ['٣', QUANTITY_INVALID_MESSAGE],
    ['', QUANTITY_INVALID_MESSAGE],
    [SQL_PAYLOAD, QUANTITY_INVALID_MESSAGE]
  ])('refuse %j', (raw, message) => {
    expect(validateQuantity(raw)).toEqual({ ok: false, error: message });
  });

  it('refuse une valeur non textuelle', () => {
    for (const raw of [null, undefined, 3, ['3'], { quantity: '3' }]) {
      expect(validateQuantity(raw)).toEqual({ ok: false, error: QUANTITY_INVALID_MESSAGE });
    }
  });

  it('affiche la borne haute au format français', () => {
    expect(QUANTITY_TOO_HIGH_MESSAGE.replace(/\s/g, ' ')).toBe(
      'La quantité ne doit pas dépasser 1 000 exemplaires.'
    );
  });
});

describe('listSaleCounter', () => {
  it('liste tous les livres, avec ou sans prix, avec leur stock chiffré', () => {
    const priced = createBook({ price: '12,50', saleStock: '3' }, 'Zadig');
    const unpriced = createBook({ saleStock: '4' }, 'Alcools');
    const soldOut = createBook({ price: '8' }, 'Émaux et camées');

    expect(listSaleCounter(db)).toEqual([
      {
        id: unpriced,
        title: 'Alcools',
        author: 'Antoine de Saint-Exupéry',
        priceCents: null,
        saleStock: 4,
        saleStatus: 'sold-out'
      },
      {
        id: soldOut,
        title: 'Émaux et camées',
        author: 'Antoine de Saint-Exupéry',
        priceCents: 800,
        saleStock: 0,
        saleStatus: 'sold-out'
      },
      {
        id: priced,
        title: 'Zadig',
        author: 'Antoine de Saint-Exupéry',
        priceCents: 1250,
        saleStock: 3,
        saleStatus: 'on-sale'
      }
    ]);
  });

  it('renvoie une liste vide sans livre', () => {
    expect(listSaleCounter(db)).toEqual([]);
  });
});

describe('recordSale', () => {
  it('décrémente le stock et écrit la vente avec prix, total et date de Paris', () => {
    const bookId = createBook({ price: '12,50', saleStock: '5' });

    const result = sell(bookId, '2');

    expect(result).toEqual({
      ok: true,
      sale: {
        id: expect.any(Number),
        bookId,
        title: 'Le Petit Prince',
        quantity: 2,
        unitPriceCents: 1250,
        totalCents: 2500,
        soldOn: PARIS_TODAY,
        remainingStock: 3
      }
    });
    expect(bookState(bookId)).toEqual({ price_cents: 1250, sale_stock: 3 });
    expect(salesRows()).toEqual([
      {
        book_id: bookId,
        bookseller_id: bookseller.id,
        quantity: 2,
        unit_price_cents: 1250,
        total_cents: 2500,
        sold_on: PARIS_TODAY
      }
    ]);
  });

  it('vend tout le stock restant et le livre devient « Épuisé »', () => {
    const bookId = createBook({ price: '10', saleStock: '2' });

    expect(sell(bookId, '2').ok).toBe(true);
    expect(bookState(bookId).sale_stock).toBe(0);
    expect(saleStatus(bookId)).toBe('sold-out');
  });

  it('ignore le prix, le total, le rôle et l’auteur envoyés par le formulaire de vente', () => {
    const bookId = createBook({ price: '20', saleStock: '3' });

    const result = sell(bookId, '1', {
      price: '0,01',
      priceCents: '1',
      unitPriceCents: '1',
      total: '0,01',
      totalCents: '1',
      role: 'borrower',
      userId: String(borrower.id),
      booksellerId: String(borrower.id)
    });

    expect(result.ok && result.sale.unitPriceCents).toBe(2000);
    expect(result.ok && result.sale.totalCents).toBe(2000);
    expect(salesRows()).toEqual([
      expect.objectContaining({
        bookseller_id: bookseller.id,
        unit_price_cents: 2000,
        total_cents: 2000
      })
    ]);
    expect(bookState(bookId).price_cents).toBe(2000);
    const roles = db.prepare('SELECT id, role FROM users ORDER BY id').all();
    expect(roles).toEqual([
      { id: bookseller.id, role: 'bookseller' },
      { id: borrower.id, role: 'borrower' }
    ]);
  });

  it('refuse deux ventes successives sur le dernier exemplaire : stock 0, une seule vente', () => {
    const bookId = createBook({ price: '9,90', saleStock: '1' });

    const first = sell(bookId, '1');
    const second = sell(bookId, '1');

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      reason: 'insufficient-stock',
      field: 'quantity',
      message: 'Stock insuffisant : 0 exemplaire disponible.'
    });
    expect(saleInsufficientStockMessage(0)).toBe('Stock insuffisant : 0 exemplaire disponible.');
    expect(bookState(bookId).sale_stock).toBe(0);
    expect(salesRows()).toHaveLength(1);
  });

  it('refuse une quantité supérieure au stock sans rien écrire', () => {
    const bookId = createBook({ price: '9,90', saleStock: '2' });

    expect(sell(bookId, '3')).toEqual({
      ok: false,
      reason: 'insufficient-stock',
      field: 'quantity',
      message: 'Stock insuffisant : 2 exemplaires disponibles.'
    });
    expect(bookState(bookId).sale_stock).toBe(2);
    expect(salesRows()).toEqual([]);
  });

  it('refuse un livre sans prix, même avec du stock', () => {
    const bookId = createBook({ saleStock: '5' });

    expect(sell(bookId, '1')).toEqual({
      ok: false,
      reason: 'no-price',
      message: SALE_NO_PRICE_MESSAGE
    });
    expect(bookState(bookId).sale_stock).toBe(5);
    expect(salesRows()).toEqual([]);
  });

  it('refuse un livre inconnu', () => {
    expect(sell(999, '1')).toEqual({
      ok: false,
      reason: 'not-found',
      message: BOOK_NOT_FOUND_MESSAGE
    });
    expect(salesRows()).toEqual([]);
  });

  it.each(['0', '-1', '1,5', 'abc', '', '1001', SQL_PAYLOAD])(
    'refuse la quantité %j sans toucher au stock',
    (quantity) => {
      const bookId = createBook({ price: '5', saleStock: '10' });

      const result = sell(bookId, quantity);

      expect(result).toMatchObject({ ok: false, reason: 'invalid', field: 'quantity' });
      expect(bookState(bookId).sale_stock).toBe(10);
      expect(salesRows()).toEqual([]);
      expect(tableNames()).toContain('books');
    }
  );

  it.each(['abc', '0', '-1', ' 1', '1.0', '99999999999999999', SQL_PAYLOAD])(
    'refuse l’identifiant de livre %j',
    (bookId) => {
      createBook({ price: '5', saleStock: '10' });

      expect(sell(bookId, '1')).toEqual({
        ok: false,
        reason: 'invalid',
        field: 'bookId',
        message: BOOK_NOT_FOUND_MESSAGE
      });
      expect(salesRows()).toEqual([]);
    }
  );

  it('refuse un enregistreur qui n’est pas libraire en base, sans rien écrire', () => {
    const bookId = createBook({ price: '5', saleStock: '10' });

    const result = recordSale(
      db,
      { ...borrower, role: 'bookseller' },
      { bookId: String(bookId), quantity: '1' },
      clock
    );

    expect(result).toEqual({ ok: false, reason: 'forbidden', message: BOOKSELLER_ONLY_MESSAGE });
    expect(bookState(bookId).sale_stock).toBe(10);
    expect(salesRows()).toEqual([]);
  });

  it('refuse un enregistreur non libraire avant de vérifier prix et stock', () => {
    const bookId = createBook({ saleStock: '0' });

    const result = recordSale(
      db,
      { ...borrower, role: 'bookseller' },
      { bookId: String(bookId), quantity: '1' },
      clock
    );

    expect(result).toEqual({ ok: false, reason: 'forbidden', message: BOOKSELLER_ONLY_MESSAGE });
    expect(salesRows()).toEqual([]);
  });

  it('calcule le total à la borne haute sans perte de précision', () => {
    const bookId = createBook({ price: '10000', saleStock: String(SALE_STOCK_MAX) });

    const result = sell(bookId, String(SALE_QUANTITY_MAX));

    expect(result.ok && result.sale.totalCents).toBe(PRICE_MAX_CENTS * SALE_QUANTITY_MAX);
  });
});

describe('restockBook', () => {
  it('ajoute la quantité au stock et remet en vente un livre avec prix', () => {
    const bookId = createBook({ price: '7,50' });
    expect(saleStatus(bookId)).toBe('sold-out');

    const result = restockBook(db, { bookId: String(bookId), quantity: '4' });

    expect(result).toEqual({
      ok: true,
      book: { bookId, title: 'Le Petit Prince', saleStock: 4 }
    });
    expect(bookState(bookId)).toEqual({ price_cents: 750, sale_stock: 4 });
    expect(saleStatus(bookId)).toBe('on-sale');
  });

  it('réassortit un livre sans prix, qui reste « Épuisé »', () => {
    const bookId = createBook();

    expect(restockBook(db, { bookId: String(bookId), quantity: '2' }).ok).toBe(true);
    expect(bookState(bookId).sale_stock).toBe(2);
    expect(saleStatus(bookId)).toBe('sold-out');
  });

  it.each(['0', '-2', '2,5', 'beaucoup', '', '1001', SQL_PAYLOAD])(
    'refuse la quantité %j sans toucher au stock',
    (quantity) => {
      const bookId = createBook({ price: '5', saleStock: '3' });

      expect(restockBook(db, { bookId: String(bookId), quantity })).toMatchObject({
        ok: false,
        reason: 'invalid',
        field: 'quantity'
      });
      expect(bookState(bookId).sale_stock).toBe(3);
    }
  );

  it('refuse un réassort qui dépasserait le stock maximal', () => {
    const bookId = createBook({ price: '5', saleStock: String(SALE_STOCK_MAX - 10) });

    expect(restockBook(db, { bookId: String(bookId), quantity: '11' })).toEqual({
      ok: false,
      reason: 'stock-limit',
      field: 'quantity',
      message: SALE_STOCK_TOO_HIGH_MESSAGE
    });
    expect(bookState(bookId).sale_stock).toBe(SALE_STOCK_MAX - 10);

    expect(restockBook(db, { bookId: String(bookId), quantity: '10' }).ok).toBe(true);
    expect(bookState(bookId).sale_stock).toBe(SALE_STOCK_MAX);
  });

  it('refuse un livre inexistant ou un identifiant invalide', () => {
    expect(restockBook(db, { bookId: '999', quantity: '1' })).toEqual({
      ok: false,
      reason: 'not-found',
      message: BOOK_NOT_FOUND_MESSAGE
    });
    expect(restockBook(db, { bookId: 'x', quantity: '1' })).toMatchObject({
      ok: false,
      reason: 'invalid',
      field: 'bookId'
    });
  });
});

describe('prix : fixer, modifier, retirer', () => {
  it('fixe le prix d’un livre migré depuis la v1 sans prix, qui devient vendable', () => {
    db.close();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(MIGRATIONS[0]);
    db.pragma('user_version = 1');
    const legacy = db
      .prepare("INSERT INTO books (title, author) VALUES ('Candide', 'Voltaire')")
      .run();
    const bookId = Number(legacy.lastInsertRowid);
    migrate(db);
    bookseller = createUser('libraire@example.fr', 'bookseller');

    expect(bookState(bookId)).toEqual({ price_cents: null, sale_stock: 0 });
    expect(listSaleCounter(db).map((entry) => entry.id)).toEqual([bookId]);

    expect(setBookPrice(db, { bookId: String(bookId), price: '6,90' })).toEqual({
      ok: true,
      book: { bookId, title: 'Candide', priceCents: 690 }
    });
    expect(restockBook(db, { bookId: String(bookId), quantity: '2' }).ok).toBe(true);

    const sale = sell(bookId, '1');
    expect(sale.ok && sale.sale.totalCents).toBe(690);
    expect(bookState(bookId)).toEqual({ price_cents: 690, sale_stock: 1 });
  });

  it('modifie le prix sans réécrire les ventes passées ni toucher au stock', () => {
    const bookId = createBook({ price: '10', saleStock: '5' });
    expect(sell(bookId, '2').ok).toBe(true);
    const before = salesRows();

    expect(setBookPrice(db, { bookId: String(bookId), price: '12.00 €' })).toMatchObject({
      ok: true,
      book: { priceCents: 1200 }
    });

    expect(bookState(bookId)).toEqual({ price_cents: 1200, sale_stock: 3 });
    expect(salesRows()).toEqual(before);
    expect(before[0].unit_price_cents).toBe(1000);

    const next = sell(bookId, '1');
    expect(next.ok && next.sale.unitPriceCents).toBe(1200);
  });

  it('retire le prix : prix nul, « Épuisé », stock et ventes inchangés, vente refusée', () => {
    const bookId = createBook({ price: '15', saleStock: '4' });
    expect(sell(bookId, '1').ok).toBe(true);
    const before = salesRows();

    expect(removeBookPrice(db, { bookId: String(bookId) })).toEqual({
      ok: true,
      book: { bookId, title: 'Le Petit Prince', priceCents: null }
    });

    expect(bookState(bookId)).toEqual({ price_cents: null, sale_stock: 3 });
    expect(salesRows()).toEqual(before);
    expect(saleStatus(bookId)).toBe('sold-out');
    expect(listSaleCounter(db)).toEqual([
      expect.objectContaining({ id: bookId, priceCents: null, saleStock: 3 })
    ]);
    expect(sell(bookId, '1')).toMatchObject({ ok: false, reason: 'no-price' });
  });

  it.each([
    ['-5', PRICE_NOT_POSITIVE_MESSAGE],
    ['0', PRICE_NOT_POSITIVE_MESSAGE],
    ['12,505', PRICE_DECIMALS_MESSAGE],
    ['douze', PRICE_INVALID_MESSAGE],
    ['10000,01', PRICE_TOO_HIGH_MESSAGE],
    ['', PRICE_MISSING_MESSAGE],
    [SQL_PAYLOAD, PRICE_INVALID_MESSAGE]
  ])('refuse le prix %j sans rien modifier', (price, message) => {
    const bookId = createBook({ price: '10', saleStock: '2' });

    expect(setBookPrice(db, { bookId: String(bookId), price })).toEqual({
      ok: false,
      reason: 'invalid',
      field: 'price',
      message
    });
    expect(bookState(bookId)).toEqual({ price_cents: 1000, sale_stock: 2 });
    expect(tableNames()).toEqual(EXPECTED_TABLES);
  });

  it('refuse un livre inexistant ou un identifiant invalide', () => {
    expect(setBookPrice(db, { bookId: '999', price: '5' })).toEqual({
      ok: false,
      reason: 'not-found',
      message: BOOK_NOT_FOUND_MESSAGE
    });
    expect(removeBookPrice(db, { bookId: '999' })).toMatchObject({
      ok: false,
      reason: 'not-found'
    });
    expect(setBookPrice(db, { bookId: SQL_PAYLOAD, price: '5' })).toMatchObject({
      ok: false,
      reason: 'invalid',
      field: 'bookId'
    });
    expect(removeBookPrice(db, { bookId: '0' })).toMatchObject({
      ok: false,
      reason: 'invalid',
      field: 'bookId'
    });
  });
});

describe('indépendance vente / prêt', () => {
  it('un livre emprunté reste vendable, et la vente ne touche pas au prêt', () => {
    const bookId = createBook({ price: '10', saleStock: '2' });
    expect(borrowBook(db, borrower, bookId, clock).ok).toBe(true);

    expect(sell(bookId, '1').ok).toBe(true);
    expect(setBookPrice(db, { bookId: String(bookId), price: '11' }).ok).toBe(true);

    expect(loanStatus(bookId)).toBe('borrowed');
    expect(bookState(bookId).sale_stock).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM loans WHERE returned_on IS NULL').get()).toEqual({
      n: 1
    });
  });

  it('vendre tout le stock laisse le livre disponible au prêt', () => {
    const bookId = createBook({ price: '10', saleStock: '1' });

    expect(sell(bookId, '1').ok).toBe(true);
    expect(removeBookPrice(db, { bookId: String(bookId) }).ok).toBe(true);

    expect(loanStatus(bookId)).toBe('available');
    expect(borrowBook(db, borrower, bookId, clock).ok).toBe(true);
    expect(bookState(bookId).sale_stock).toBe(0);
  });

  it('emprunter puis rendre ne modifie pas le stock de vente', () => {
    const bookId = createBook({ price: '10', saleStock: '3' });

    const loan = borrowBook(db, borrower, bookId, clock);
    expect(bookState(bookId).sale_stock).toBe(3);
    if (!loan.ok) throw new Error('Emprunt de test refusé.');

    expect(sell(bookId, '1').ok).toBe(true);
    expect(recordReturn(db, loan.loan.id, clock).ok).toBe(true);

    expect(bookState(bookId).sale_stock).toBe(2);
    expect(loanStatus(bookId)).toBe('available');
    expect(salesRows()).toHaveLength(1);
  });
});

describe('injection SQL', () => {
  it('une charge utile dans le titre est listée littéralement et le livre vendu normalement', () => {
    const bookId = createBook({ price: '3', saleStock: '1' }, SQL_PAYLOAD);

    expect(listSaleCounter(db)).toEqual([
      expect.objectContaining({ id: bookId, title: SQL_PAYLOAD })
    ]);
    const sale = sell(bookId, '1');
    expect(sale.ok && sale.sale.title).toBe(SQL_PAYLOAD);
    expect(tableNames()).toEqual(EXPECTED_TABLES);
  });
});
