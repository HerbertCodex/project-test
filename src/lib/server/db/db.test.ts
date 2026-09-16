import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_PATH,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  getSchemaVersion,
  migrate,
  openDatabase,
  resolveDatabasePath,
  type Db
} from './index';

const SQL_PAYLOAD = "'; DROP TABLE books;--";
const EXPECTED_TABLES = ['books', 'loans', 'login_failures', 'sales', 'sessions', 'users'];

function tableNames(db: Db): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function insertUser(db: Db, email: string, role = 'borrower'): number {
  const result = db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(email, 'Lecteur', 'hash-factice', role, 0);
  return Number(result.lastInsertRowid);
}

function insertBook(db: Db, title = 'Le Petit Prince', author = 'Saint-Exupéry'): number {
  const result = db.prepare('INSERT INTO books (title, author) VALUES (?, ?)').run(title, author);
  return Number(result.lastInsertRowid);
}

function setBookForSale(db: Db, bookId: number, priceCents: number | null, saleStock: number) {
  return db
    .prepare('UPDATE books SET price_cents = ?, sale_stock = ? WHERE id = ?')
    .run(priceCents, saleStock, bookId);
}

function insertSale(
  db: Db,
  sale: {
    bookId: number;
    booksellerId: number;
    quantity?: number;
    unitPriceCents?: number;
    totalCents?: number;
    soldOn?: string;
  }
) {
  const quantity = sale.quantity ?? 1;
  const unitPriceCents = sale.unitPriceCents ?? 1250;
  return db
    .prepare(
      `INSERT INTO sales (book_id, bookseller_id, quantity, unit_price_cents, total_cents, sold_on)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      sale.bookId,
      sale.booksellerId,
      quantity,
      unitPriceCents,
      sale.totalCents ?? quantity * unitPriceCents,
      sale.soldOn ?? '2026-03-10'
    );
}

function insertLoan(
  db: Db,
  loan: { bookId: number; userId: number; borrowedOn?: string; dueOn?: string; returnedOn?: string | null }
) {
  return db
    .prepare(
      'INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      loan.bookId,
      loan.userId,
      loan.borrowedOn ?? '2026-03-10',
      loan.dueOn ?? '2026-04-09',
      loan.returnedOn ?? null
    );
}

describe('openDatabase et migrate', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('active les clés étrangères', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('crée les tables et fixe user_version à la dernière version', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(LATEST_SCHEMA_VERSION).toBe(2);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
  });

  it('peut être rejouée sans erreur ni changement de version', () => {
    expect(() => migrate(db)).not.toThrow();
    expect(() => migrate(db)).not.toThrow();
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('refuse une base dont le schéma est plus récent que l’application', () => {
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow();
  });

  it('refuse un second prêt actif pour le même livre', () => {
    const bookId = insertBook(db);
    const first = insertUser(db, 'a@example.fr');
    const second = insertUser(db, 'b@example.fr');

    insertLoan(db, { bookId, userId: first });

    expect(() => insertLoan(db, { bookId, userId: second })).toThrow(/UNIQUE/);
  });

  it('autorise un nouveau prêt une fois le précédent rendu', () => {
    const bookId = insertBook(db);
    const userId = insertUser(db, 'a@example.fr');

    insertLoan(db, { bookId, userId, returnedOn: '2026-03-20' });

    expect(() => insertLoan(db, { bookId, userId, borrowedOn: '2026-03-21', dueOn: '2026-04-20' })).not.toThrow();
  });

  it('refuse un prêt vers un livre ou un utilisateur inexistant', () => {
    const bookId = insertBook(db);
    const userId = insertUser(db, 'a@example.fr');

    expect(() => insertLoan(db, { bookId, userId: userId + 100 })).toThrow(/FOREIGN KEY/);
    expect(() => insertLoan(db, { bookId: bookId + 100, userId })).toThrow(/FOREIGN KEY/);
  });

  it('ne supprime pas en cascade les prêts d’un utilisateur', () => {
    const cascades = (
      db.prepare("SELECT * FROM pragma_foreign_key_list('loans')").all() as {
        table: string;
        on_delete: string;
      }[]
    ).filter((fk) => fk.on_delete.toUpperCase() === 'CASCADE');
    expect(cascades).toEqual([]);

    const userId = insertUser(db, 'a@example.fr');
    insertLoan(db, { bookId: insertBook(db), userId });

    expect(() => db.prepare('DELETE FROM users WHERE id = ?').run(userId)).toThrow(/FOREIGN KEY/);
    expect(db.prepare('SELECT count(*) AS n FROM loans').get()).toEqual({ n: 1 });
  });

  it('refuse des dates de prêt qui ne sont pas des dates calendaires valides', () => {
    const bookId = insertBook(db);
    const userId = insertUser(db, 'a@example.fr');

    expect(() => insertLoan(db, { bookId, userId, dueOn: '2026-02-30' })).toThrow(/CHECK/);
    expect(() => insertLoan(db, { bookId, userId, borrowedOn: '10/03/2026' })).toThrow(/CHECK/);
    expect(() => insertLoan(db, { bookId, userId, dueOn: '2026-03-01' })).toThrow(/CHECK/);
    expect(() => insertLoan(db, { bookId, userId, returnedOn: 'hier' })).toThrow(/CHECK/);
  });

  it('impose un e-mail normalisé et unique', () => {
    insertUser(db, 'lecteur@example.fr');

    expect(() => insertUser(db, 'lecteur@example.fr')).toThrow(/UNIQUE/);
    expect(() => insertUser(db, 'Lecteur@Example.fr')).toThrow(/CHECK/);
    expect(() => insertUser(db, ' lecteur2@example.fr')).toThrow(/CHECK/);
  });

  it('limite les rôles à borrower et bookseller', () => {
    expect(() => insertUser(db, 'libraire@example.fr', 'bookseller')).not.toThrow();
    expect(() => insertUser(db, 'admin@example.fr', 'admin')).toThrow(/CHECK/);
  });

  it('supprime les sessions avec leur utilisateur', () => {
    const userId = insertUser(db, 'a@example.fr');
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run('empreinte', userId, 0, 1);

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('stocke littéralement une charge utile SQL sans altérer les tables', () => {
    const payloadEmail = `${SQL_PAYLOAD}@example.fr`.toLowerCase();
    const userId = insertUser(db, payloadEmail);
    const bookId = insertBook(db, SQL_PAYLOAD, SQL_PAYLOAD);
    db.prepare('INSERT INTO login_failures (email, window_start, count) VALUES (?, ?, ?)').run(
      payloadEmail,
      0,
      1
    );

    expect(db.prepare('SELECT * FROM books WHERE id = ?').get(bookId)).toEqual({
      id: bookId,
      title: SQL_PAYLOAD,
      author: SQL_PAYLOAD,
      price_cents: null,
      sale_stock: 0
    });
    expect(db.prepare('SELECT email FROM users WHERE id = ?').get(userId)).toEqual({
      email: payloadEmail
    });
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
  });

  it('accepte un livre sans prix, puis un prix et un stock valides', () => {
    const bookId = insertBook(db);

    expect(db.prepare('SELECT price_cents, sale_stock FROM books WHERE id = ?').get(bookId)).toEqual({
      price_cents: null,
      sale_stock: 0
    });

    setBookForSale(db, bookId, 1250, 3);
    expect(db.prepare('SELECT price_cents, sale_stock FROM books WHERE id = ?').get(bookId)).toEqual({
      price_cents: 1250,
      sale_stock: 3
    });

    expect(() => setBookForSale(db, bookId, null, 0)).not.toThrow();
  });

  it('refuse un prix nul ou négatif et un stock de vente négatif ou absent', () => {
    const bookId = insertBook(db);

    expect(() => setBookForSale(db, bookId, 0, 1)).toThrow(/CHECK/);
    expect(() => setBookForSale(db, bookId, -100, 1)).toThrow(/CHECK/);
    expect(() => setBookForSale(db, bookId, 1250, -1)).toThrow(/CHECK/);
    expect(() => setBookForSale(db, bookId, null, -1)).toThrow(/CHECK/);
    expect(() => db.prepare('UPDATE books SET sale_stock = NULL WHERE id = ?').run(bookId)).toThrow(
      /NOT NULL/
    );
    expect(() =>
      db.prepare('INSERT INTO books (title, author, price_cents) VALUES (?, ?, ?)').run('T', 'A', -1)
    ).toThrow(/CHECK/);
    expect(() =>
      db.prepare('INSERT INTO books (title, author, sale_stock) VALUES (?, ?, ?)').run('T', 'A', -5)
    ).toThrow(/CHECK/);
    // Table STRICT : un prix textuel (charge utile comprise) est refusé, pas converti.
    expect(() => setBookForSale(db, bookId, SQL_PAYLOAD as unknown as number, 1)).toThrow();
    expect(() => setBookForSale(db, bookId, 12.5, 1)).toThrow();

    expect(db.prepare('SELECT price_cents, sale_stock FROM books WHERE id = ?').get(bookId)).toEqual({
      price_cents: null,
      sale_stock: 0
    });
  });

  it('enregistre une vente valide', () => {
    const bookId = insertBook(db);
    const booksellerId = insertUser(db, 'libraire@example.fr', 'bookseller');

    insertSale(db, { bookId, booksellerId, quantity: 2, unitPriceCents: 1250, soldOn: '2026-03-10' });

    expect(db.prepare('SELECT * FROM sales').all()).toEqual([
      {
        id: 1,
        book_id: bookId,
        bookseller_id: booksellerId,
        quantity: 2,
        unit_price_cents: 1250,
        total_cents: 2500,
        sold_on: '2026-03-10'
      }
    ]);
  });

  it('refuse une vente de quantité, prix ou total nul, négatif ou incohérent', () => {
    const bookId = insertBook(db);
    const booksellerId = insertUser(db, 'libraire@example.fr', 'bookseller');

    expect(() => insertSale(db, { bookId, booksellerId, quantity: 0 })).toThrow(/CHECK/);
    expect(() => insertSale(db, { bookId, booksellerId, quantity: -1 })).toThrow(/CHECK/);
    expect(() => insertSale(db, { bookId, booksellerId, unitPriceCents: 0 })).toThrow(/CHECK/);
    expect(() => insertSale(db, { bookId, booksellerId, unitPriceCents: -1250 })).toThrow(/CHECK/);
    expect(() => insertSale(db, { bookId, booksellerId, totalCents: 0 })).toThrow(/CHECK/);
    expect(() => insertSale(db, { bookId, booksellerId, totalCents: -1250 })).toThrow(/CHECK/);
    expect(() => insertSale(db, { bookId, booksellerId, quantity: 2, totalCents: 1 })).toThrow(
      /CHECK/
    );
    expect(() =>
      insertSale(db, { bookId, booksellerId, quantity: SQL_PAYLOAD as unknown as number, totalCents: 1250 })
    ).toThrow();

    expect(db.prepare('SELECT count(*) AS n FROM sales').get()).toEqual({ n: 0 });
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
  });

  it('refuse des dates de vente qui ne sont pas des dates calendaires valides', () => {
    const bookId = insertBook(db);
    const booksellerId = insertUser(db, 'libraire@example.fr', 'bookseller');

    expect(() => insertSale(db, { bookId, booksellerId, soldOn: '2026-02-30' })).toThrow(/CHECK/);
    expect(() => insertSale(db, { bookId, booksellerId, soldOn: '10/03/2026' })).toThrow(/CHECK/);
    expect(() => insertSale(db, { bookId, booksellerId, soldOn: '2026-03-10 12:00:00' })).toThrow(
      /CHECK/
    );
    expect(() => insertSale(db, { bookId, booksellerId, soldOn: 'hier' })).toThrow(/CHECK/);
    expect(db.prepare('SELECT count(*) AS n FROM sales').get()).toEqual({ n: 0 });
  });

  it('refuse une vente vers un livre ou un libraire inexistant', () => {
    const bookId = insertBook(db);
    const booksellerId = insertUser(db, 'libraire@example.fr', 'bookseller');

    expect(() => insertSale(db, { bookId, booksellerId: booksellerId + 100 })).toThrow(/FOREIGN KEY/);
    expect(() => insertSale(db, { bookId: bookId + 100, booksellerId })).toThrow(/FOREIGN KEY/);
  });

  it('ne supprime pas en cascade les ventes d’un livre ou d’un libraire', () => {
    const foreignKeys = db.prepare("SELECT * FROM pragma_foreign_key_list('sales')").all() as {
      table: string;
      from: string;
      on_delete: string;
    }[];
    const byColumn = Object.fromEntries(
      foreignKeys.map((fk) => [fk.from, { table: fk.table, onDelete: fk.on_delete.toUpperCase() }])
    );
    expect(foreignKeys).toHaveLength(2);
    expect(byColumn).toEqual({
      book_id: { table: 'books', onDelete: 'RESTRICT' },
      bookseller_id: { table: 'users', onDelete: 'RESTRICT' }
    });

    const bookId = insertBook(db);
    const booksellerId = insertUser(db, 'libraire@example.fr', 'bookseller');
    insertSale(db, { bookId, booksellerId });

    expect(() => db.prepare('DELETE FROM users WHERE id = ?').run(booksellerId)).toThrow(
      /FOREIGN KEY/
    );
    expect(() => db.prepare('DELETE FROM books WHERE id = ?').run(bookId)).toThrow(/FOREIGN KEY/);
    expect(db.prepare('SELECT count(*) AS n FROM sales').get()).toEqual({ n: 1 });
  });

  it('crée les index utiles de la table sales', () => {
    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'sales' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toEqual(['sales_book_id', 'sales_bookseller_id', 'sales_sold_on']);
  });
});

describe('migration d’une base v1 existante', () => {
  let db: Db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(MIGRATIONS[0]);
    db.pragma('user_version = 1');
  });

  afterEach(() => {
    db.close();
  });

  it('passe en v2 sans perdre les livres, prêts et comptes existants', () => {
    const firstBook = insertBook(db, 'Le Petit Prince', 'Saint-Exupéry');
    const payloadBook = insertBook(db, SQL_PAYLOAD, SQL_PAYLOAD);
    const userId = insertUser(db, 'a@example.fr');
    insertLoan(db, { bookId: firstBook, userId });
    expect(tableNames(db)).toEqual(['books', 'loans', 'login_failures', 'sessions', 'users']);

    migrate(db);

    expect(getSchemaVersion(db)).toBe(2);
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
    expect(db.prepare('SELECT * FROM books ORDER BY id').all()).toEqual([
      { id: firstBook, title: 'Le Petit Prince', author: 'Saint-Exupéry', price_cents: null, sale_stock: 0 },
      { id: payloadBook, title: SQL_PAYLOAD, author: SQL_PAYLOAD, price_cents: null, sale_stock: 0 }
    ]);
    expect(db.prepare('SELECT book_id, user_id, returned_on FROM loans').all()).toEqual([
      { book_id: firstBook, user_id: userId, returned_on: null }
    ]);
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM sales').get()).toEqual({ n: 0 });
    // L'invariant du prêt actif unique survit à la migration.
    expect(() => insertLoan(db, { bookId: firstBook, userId })).toThrow(/UNIQUE/);
  });

  it('impose les contraintes de vente sur les livres migrés et se rejoue sans effet', () => {
    const bookId = insertBook(db);

    migrate(db);
    migrate(db);

    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(() => setBookForSale(db, bookId, 0, 1)).toThrow(/CHECK/);
    expect(() => setBookForSale(db, bookId, 990, -1)).toThrow(/CHECK/);
    expect(() => setBookForSale(db, bookId, 990, 4)).not.toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM books').get()).toEqual({ n: 1 });
  });
});

describe('openDatabase sur fichier', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'librairie-db-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('crée le dossier parent, puis rouvre la base migrée en conservant les données', () => {
    const path = join(dir, 'data', 'librairie.db');

    const first = openDatabase(path);
    insertBook(first);
    first.close();

    const second = openDatabase(path);
    try {
      expect(second.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(getSchemaVersion(second)).toBe(LATEST_SCHEMA_VERSION);
      expect(second.prepare('SELECT count(*) AS n FROM books').get()).toEqual({ n: 1 });
    } finally {
      second.close();
    }
  });
});

describe('resolveDatabasePath', () => {
  it('utilise data/librairie.db par défaut', () => {
    expect(resolveDatabasePath({})).toBe(DEFAULT_DATABASE_PATH);
    expect(DEFAULT_DATABASE_PATH).toBe('data/librairie.db');
  });

  it('utilise une base en mémoire sous Vitest', () => {
    expect(resolveDatabasePath({ VITEST: 'true' })).toBe(':memory:');
  });

  it('respecte un chemin injecté par LIBRAIRIE_DB_PATH', () => {
    expect(resolveDatabasePath({ LIBRAIRIE_DB_PATH: '/srv/librairie.db', VITEST: 'true' })).toBe(
      '/srv/librairie.db'
    );
  });
});
