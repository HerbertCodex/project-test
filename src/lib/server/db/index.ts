import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export const DEFAULT_DATABASE_PATH = 'data/librairie.db';
export const IN_MEMORY_DATABASE_PATH = ':memory:';

/**
 * Migrations versionnées : l'élément d'indice i fait passer la base de la
 * version i à la version i + 1 (PRAGMA user_version). Ne jamais modifier une
 * migration publiée : en ajouter une nouvelle à la fin.
 *
 * Choix de schéma :
 * - les e-mails sont stockés normalisés (minuscules, sans espaces autour) ;
 * - les dates de prêt sont des dates calendaires AAAA-MM-JJ (Europe/Paris),
 *   les instants de session et de blocage des millisecondes epoch ;
 * - aucune suppression en cascade de users vers loans : un compte sera
 *   anonymisé (incrément 3), jamais supprimé avec son historique de prêts ;
 * - l'index unique partiel garantit au plus un prêt actif par livre.
 *
 * Exporté uniquement pour que les tests reconstruisent une base d'une version
 * antérieure ; l'application passe toujours par `migrate`.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
      CHECK (length(email) > 0 AND email = lower(trim(email))),
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('borrower', 'bookseller')),
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX sessions_user_id ON sessions (user_id);
  CREATE INDEX sessions_expires_at ON sessions (expires_at);

  CREATE TABLE login_failures (
    email TEXT PRIMARY KEY
      CHECK (length(email) > 0 AND email = lower(trim(email))),
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL CHECK (count >= 0)
  ) STRICT;

  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) > 0),
    author TEXT NOT NULL CHECK (length(author) > 0)
  ) STRICT;

  CREATE TABLE loans (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books (id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    borrowed_on TEXT NOT NULL CHECK (date(borrowed_on) IS borrowed_on),
    due_on TEXT NOT NULL CHECK (date(due_on) IS due_on AND due_on >= borrowed_on),
    returned_on TEXT CHECK (
      returned_on IS NULL
      OR (date(returned_on) IS returned_on AND returned_on >= borrowed_on)
    )
  ) STRICT;
  CREATE UNIQUE INDEX loans_one_active_per_book ON loans (book_id) WHERE returned_on IS NULL;
  CREATE INDEX loans_user_id ON loans (user_id);
  CREATE INDEX loans_active_due_on ON loans (due_on) WHERE returned_on IS NULL;
  `,
  // v2 : vente au comptoir. SQLite (>= 3.37) accepte les CHECK en ADD COLUMN
  // et les vérifie sur les lignes existantes : aucune reconstruction de books.
  // Le prix est en centimes, nul pour un livre non vendable ; le stock de vente
  // est indépendant de l'exemplaire de prêt. Chaque vente fige le prix unitaire
  // et reste conservée (ON DELETE RESTRICT, comme loans).
  `
  ALTER TABLE books ADD COLUMN price_cents INTEGER
    CHECK (price_cents IS NULL OR price_cents > 0);
  ALTER TABLE books ADD COLUMN sale_stock INTEGER NOT NULL DEFAULT 0
    CHECK (sale_stock >= 0);

  CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books (id) ON DELETE RESTRICT,
    bookseller_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
    total_cents INTEGER NOT NULL
      CHECK (total_cents > 0 AND total_cents = quantity * unit_price_cents),
    sold_on TEXT NOT NULL CHECK (date(sold_on) IS sold_on)
  ) STRICT;
  CREATE INDEX sales_book_id ON sales (book_id);
  CREATE INDEX sales_bookseller_id ON sales (bookseller_id);
  CREATE INDEX sales_sold_on ON sales (sold_on);
  `
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

export function getSchemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Applique, chacune dans sa transaction, les migrations non encore appliquées. */
export function migrate(db: Db): void {
  const current = getSchemaVersion(db);
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Schéma de base en version ${current}, plus récent que la version ${LATEST_SCHEMA_VERSION} connue de l'application.`
    );
  }

  for (let version = current; version < LATEST_SCHEMA_VERSION; version++) {
    const nextVersion = version + 1;
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      // PRAGMA n'accepte pas de paramètre lié ; nextVersion est un entier interne.
      db.pragma(`user_version = ${Number(nextVersion)}`);
    })();
  }
}

/**
 * Ouvre (et crée si besoin) la base, active les clés étrangères et la migre.
 * `path` vaut un chemin de fichier ou `:memory:`.
 */
export function openDatabase(path: string = DEFAULT_DATABASE_PATH): Db {
  if (path !== IN_MEMORY_DATABASE_PATH) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    if (path !== IN_MEMORY_DATABASE_PATH) {
      db.pragma('journal_mode = WAL');
    }
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

type DatabaseEnv = Record<string, string | undefined>;

/**
 * Chemin de la base : `LIBRAIRIE_DB_PATH` s'il est défini, `:memory:` sous
 * Vitest, sinon `data/librairie.db`.
 */
export function resolveDatabasePath(env: DatabaseEnv = process.env): string {
  if (env.LIBRAIRIE_DB_PATH) return env.LIBRAIRIE_DB_PATH;
  if (env.VITEST) return IN_MEMORY_DATABASE_PATH;
  return DEFAULT_DATABASE_PATH;
}

let shared: Db | undefined;

/** Connexion partagée du processus, ouverte et migrée au premier appel. */
export function getDb(): Db {
  shared ??= openDatabase(resolveDatabasePath());
  return shared;
}

export function closeDb(): void {
  shared?.close();
  shared = undefined;
}
