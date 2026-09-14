import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_PATH,
  LATEST_SCHEMA_VERSION,
  getSchemaVersion,
  migrate,
  openDatabase,
  resolveDatabasePath,
  type Db
} from './index';

const SQL_PAYLOAD = "'; DROP TABLE books;--";

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
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(tableNames(db)).toEqual(['books', 'loans', 'login_failures', 'sessions', 'users']);
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

    expect(db.prepare('SELECT title, author FROM books WHERE id = ?').get(bookId)).toEqual({
      title: SQL_PAYLOAD,
      author: SQL_PAYLOAD
    });
    expect(db.prepare('SELECT email FROM users WHERE id = ?').get(userId)).toEqual({
      email: payloadEmail
    });
    expect(tableNames(db)).toEqual(['books', 'loans', 'login_failures', 'sessions', 'users']);
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
