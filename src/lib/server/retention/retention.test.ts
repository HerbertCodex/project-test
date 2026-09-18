import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANONYMIZED_DISPLAY_NAME, anonymizedEmail } from '../account';
import { addCalendarDays, startOfDayInParis, type Clock } from '../dates';
import { openDatabase, type Db } from '../db';
import { listRecentSecurityEvents, recordSecurityEvent } from '../security-log';
import { runRetentionPurges, runRetentionPurgesSafely } from './index';

// 18 septembre 2026, 12 h UTC = 14 h à Paris (heure d'été).
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const TODAY = '2026-09-18';
// Bornes attendues pour cette date du jour, écrites en clair : une et trois
// années calendaires en arrière, même quantième. La borne d'un an vaut pour les
// prêts rendus comme pour le journal de sécurité.
const ONE_YEAR_BOUNDARY = '2025-09-18';
const INACTIVITY_BOUNDARY = '2023-09-18';

const SQL_PAYLOAD = "'; DROP TABLE users;--";
const EXPECTED_TABLES = [
  'books',
  'loans',
  'login_failures',
  'sales',
  'security_events',
  'sessions',
  'users'
];

const clockAt =
  (instant: number): Clock =>
  () =>
    new Date(instant);
const clock = clockAt(NOW);

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

type NewUser = {
  email: string;
  displayName?: string;
  role?: 'borrower' | 'bookseller';
  /** Dates calendaires de Paris, converties en millisecondes epoch. */
  createdOn?: string;
  lastLoginOn?: string | null;
  deletedOn?: string | null;
};

function createUser({
  email,
  displayName = 'Lecteur',
  role = 'borrower',
  createdOn = '2015-01-01',
  lastLoginOn = null,
  deletedOn = null
}: NewUser): number {
  const inserted = db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at, last_login_at, deleted_at)
       VALUES (?, ?, 'hash-factice', ?, ?, ?, ?)`
    )
    .run(
      email,
      displayName,
      role,
      startOfDayInParis(createdOn),
      lastLoginOn === null ? null : startOfDayInParis(lastLoginOn),
      deletedOn === null ? null : startOfDayInParis(deletedOn)
    );
  return Number(inserted.lastInsertRowid);
}

/** Un livre neuf par prêt : l'exemplaire prêté est unique. */
function addBook(): number {
  const inserted = db
    .prepare("INSERT INTO books (title, author) VALUES ('Le Rivage des Syrtes', 'Julien Gracq')")
    .run();
  return Number(inserted.lastInsertRowid);
}

function addLoan(userId: number, borrowedOn: string, returnedOn: string | null = null): number {
  const inserted = db
    .prepare(
      `INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(addBook(), userId, borrowedOn, addCalendarDays(borrowedOn, 30), returnedOn);
  return Number(inserted.lastInsertRowid);
}

function addSale(booksellerId: number): void {
  db.prepare(
    `INSERT INTO sales (book_id, bookseller_id, quantity, unit_price_cents, total_cents, sold_on)
     VALUES (?, ?, 2, 1000, 2000, '2019-01-05')`
  ).run(addBook(), booksellerId);
}

function userRow(userId: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
}

function returnedDates(): (string | null)[] {
  return (
    db.prepare('SELECT returned_on FROM loans ORDER BY id').all() as {
      returned_on: string | null;
    }[]
  ).map((row) => row.returned_on);
}

type EventRow = { created_at: number; type: string; user_id: number | null; subject: string | null };

function events(): EventRow[] {
  return db
    .prepare('SELECT created_at, type, user_id, subject FROM security_events ORDER BY id')
    .all() as EventRow[];
}

/** Requêtes fixes : aucun nom de table n'est interpolé dans une chaîne SQL. */
const COUNT_QUERIES = {
  books: 'SELECT count(*) AS n FROM books',
  loans: 'SELECT count(*) AS n FROM loans',
  sales: 'SELECT count(*) AS n FROM sales',
  security_events: 'SELECT count(*) AS n FROM security_events',
  users: 'SELECT count(*) AS n FROM users'
} as const;

function count(table: keyof typeof COUNT_QUERIES): number {
  return (db.prepare(COUNT_QUERIES[table]).get() as { n: number }).n;
}

function tableNames(): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

describe('purge des prêts rendus', () => {
  it('supprime les prêts rendus avant la borne d’un an et garde ceux rendus à la borne ou après', () => {
    const user = createUser({ email: 'lecteur@example.fr', lastLoginOn: TODAY });
    addLoan(user, '2024-01-10', '2025-09-17');
    addLoan(user, '2024-01-10', ONE_YEAR_BOUNDARY);
    addLoan(user, '2026-08-01', '2026-09-01');

    expect(runRetentionPurges(db, clock).loans).toBe(1);

    // Le prêt rendu la veille de la borne part, celui rendu le jour même reste.
    expect(returnedDates()).toEqual([ONE_YEAR_BOUNDARY, '2026-09-01']);
  });

  it('ne supprime jamais un prêt en cours, si ancien soit-il', () => {
    const user = createUser({ email: 'lecteur@example.fr', lastLoginOn: TODAY });
    addLoan(user, '2015-03-01');

    expect(runRetentionPurges(db, clock).loans).toBe(0);

    expect(returnedDates()).toEqual([null]);
  });

  it('ne supprime ni livre ni vente', () => {
    const seller = createUser({
      email: 'libraire@example.fr',
      displayName: 'Jeanne',
      role: 'bookseller'
    });
    const user = createUser({ email: 'lecteur@example.fr', lastLoginOn: TODAY });
    addLoan(user, '2019-01-10', '2019-02-10');
    addSale(seller);
    addSale(seller);
    const books = count('books');

    expect(runRetentionPurges(db, clock).loans).toBe(1);

    expect(count('loans')).toBe(0);
    expect(count('books')).toBe(books);
    expect(count('sales')).toBe(2);
  });

  it('ramène la borne au 28 février quand le jour est un 29 février', () => {
    // 29 février 2028 : l'année 2027 n'a pas de 29 février, la borne est le 28.
    const leapDay = clockAt(Date.UTC(2028, 1, 29, 12, 0, 0));
    const user = createUser({ email: 'lecteur@example.fr', lastLoginOn: '2028-01-01' });
    addLoan(user, '2026-06-01', '2027-02-27');
    addLoan(user, '2026-06-01', '2027-02-28');

    expect(runRetentionPurges(db, leapDay).loans).toBe(1);

    expect(returnedDates()).toEqual(['2027-02-28']);
  });
});

describe('purge du journal de sécurité', () => {
  it('supprime les événements antérieurs à la borne et laisse les plus récents lisibles', () => {
    const user = createUser({ email: 'lecteur@example.fr', lastLoginOn: TODAY });
    const boundary = startOfDayInParis(ONE_YEAR_BOUNDARY);
    recordSecurityEvent(
      db,
      { type: 'login_failure', subject: 'ancien@example.fr' },
      clockAt(boundary - 1)
    );
    recordSecurityEvent(db, { type: 'login_success', userId: user }, clockAt(boundary));
    recordSecurityEvent(db, { type: 'login_success', userId: user }, clock);

    expect(runRetentionPurges(db, clock).securityEvents).toBe(1);

    expect(listRecentSecurityEvents(db).map((event) => event.createdAt)).toEqual([NOW, boundary]);
  });
});

describe('anonymisation des comptes emprunteurs inactifs', () => {
  it('anonymise un emprunteur sans connexion ni prêt depuis trois ans', () => {
    const user = createUser({
      email: 'dormeur@example.fr',
      displayName: 'Dormeur',
      createdOn: '2014-05-05',
      lastLoginOn: '2023-09-17'
    });

    expect(runRetentionPurges(db, clock).accounts).toBe(1);

    expect(userRow(user)).toMatchObject({
      email: anonymizedEmail(user),
      display_name: ANONYMIZED_DISPLAY_NAME,
      // Le rôle n'est pas modifié, et la ligne n'est jamais supprimée.
      role: 'borrower',
      deleted_at: NOW
    });
    expect(count('users')).toBe(1);
    // Exactement un événement, rattaché au compte et sans sujet.
    expect(events()).toEqual([
      { created_at: NOW, type: 'account_deleted', user_id: user, subject: null }
    ]);
  });

  it('épargne un emprunteur dont la dernière connexion atteint tout juste la borne', () => {
    const user = createUser({
      email: 'fidele@example.fr',
      createdOn: '2014-05-05',
      lastLoginOn: INACTIVITY_BOUNDARY
    });

    expect(runRetentionPurges(db, clock).accounts).toBe(0);

    expect(userRow(user)).toMatchObject({ email: 'fidele@example.fr', deleted_at: null });
    expect(events()).toEqual([]);
  });

  it('retient la date de création quand aucune connexion n’a été enregistrée', () => {
    const jamais = createUser({ email: 'jamais@example.fr', createdOn: '2023-09-17' });
    const inscrit = createUser({ email: 'inscrit@example.fr', createdOn: INACTIVITY_BOUNDARY });

    expect(runRetentionPurges(db, clock).accounts).toBe(1);

    expect(userRow(jamais)).toMatchObject({ email: anonymizedEmail(jamais), deleted_at: NOW });
    expect(userRow(inscrit)).toMatchObject({ email: 'inscrit@example.fr', deleted_at: null });
  });

  it('épargne un emprunteur inactif qui n’a pas rendu son prêt', () => {
    const user = createUser({ email: 'debiteur@example.fr', createdOn: '2014-05-05' });
    addLoan(user, '2015-03-01');

    expect(runRetentionPurges(db, clock)).toMatchObject({ loans: 0, accounts: 0 });

    expect(userRow(user)).toMatchObject({ email: 'debiteur@example.fr', deleted_at: null });
    expect(count('loans')).toBe(1);
    expect(events()).toEqual([]);
  });

  it('épargne un emprunteur dont un prêt a été rendu depuis la borne', () => {
    const user = createUser({ email: 'lecteur@example.fr', createdOn: '2014-05-05' });
    addLoan(user, '2026-05-01', '2026-06-01');

    expect(runRetentionPurges(db, clock).accounts).toBe(0);

    expect(userRow(user)).toMatchObject({ email: 'lecteur@example.fr', deleted_at: null });
  });

  it('épargne tout libraire inactif, y compris sans connexion depuis dix ans', () => {
    const recent = createUser({
      email: 'libraire@example.fr',
      displayName: 'Jeanne',
      role: 'bookseller',
      createdOn: '2014-05-05',
      lastLoginOn: '2023-09-17'
    });
    const ancien = createUser({
      email: 'fondateur@example.fr',
      displayName: 'Hubert',
      role: 'bookseller',
      createdOn: '2010-01-01',
      lastLoginOn: '2016-09-18'
    });
    addSale(ancien);

    expect(runRetentionPurges(db, clock).accounts).toBe(0);

    expect(userRow(recent)).toMatchObject({ email: 'libraire@example.fr', deleted_at: null });
    expect(userRow(ancien)).toMatchObject({
      email: 'fondateur@example.fr',
      display_name: 'Hubert',
      deleted_at: null
    });
    expect(count('sales')).toBe(1);
    expect(events()).toEqual([]);
  });

  it('laisse inchangé un compte déjà anonymisé', () => {
    const user = createUser({
      email: anonymizedEmail(1),
      displayName: ANONYMIZED_DISPLAY_NAME,
      createdOn: '2014-05-05',
      deletedOn: '2024-01-01'
    });
    const before = userRow(user);

    expect(runRetentionPurges(db, clock).accounts).toBe(0);

    expect(userRow(user)).toEqual(before);
    expect(events()).toEqual([]);
  });

  it('ne réanonymise rien au second appel', () => {
    createUser({ email: 'dormeur@example.fr', createdOn: '2014-05-05' });
    const user = createUser({ email: 'lecteur@example.fr', lastLoginOn: TODAY });
    addLoan(user, '2019-01-10', '2019-02-10');
    recordSecurityEvent(
      db,
      { type: 'login_success', userId: user },
      clockAt(startOfDayInParis('2020-01-01'))
    );

    expect(runRetentionPurges(db, clock)).toEqual({ loans: 1, securityEvents: 1, accounts: 1 });
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();
    const journal = events();

    expect(runRetentionPurges(db, clock)).toEqual({ loans: 0, securityEvents: 0, accounts: 0 });

    expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(users);
    expect(journal.map((event) => event.type)).toEqual(['account_deleted']);
    expect(events()).toEqual(journal);
  });

  it('anonymise un compte au nom affiché hostile sans altérer les tables', () => {
    const user = createUser({
      email: `${SQL_PAYLOAD.replace(/\s/g, '')}@example.fr`.toLowerCase(),
      displayName: SQL_PAYLOAD,
      createdOn: '2014-05-05'
    });
    recordSecurityEvent(db, { type: 'login_failure', subject: SQL_PAYLOAD }, clock);

    expect(runRetentionPurges(db, clock).accounts).toBe(1);

    expect(userRow(user)).toMatchObject({
      email: anonymizedEmail(user),
      display_name: ANONYMIZED_DISPLAY_NAME
    });
    // La charge utile a été stockée et relue littéralement, sans effet.
    expect(events().map((event) => event.subject)).toEqual([SQL_PAYLOAD, null]);
    expect(tableNames()).toEqual(EXPECTED_TABLES);
    expect(count('users')).toBe(1);
  });
});

describe('purges réunies', () => {
  it('renvoie des compteurs nuls sur une base vide, sans rien supprimer', () => {
    expect(runRetentionPurges(db, clock)).toEqual({ loans: 0, securityEvents: 0, accounts: 0 });

    expect(tableNames()).toEqual(EXPECTED_TABLES);
    expect(count('users')).toBe(0);
    expect(count('security_events')).toBe(0);
  });

  it('se passe d’horloge fournie, l’horloge système servant de défaut', () => {
    expect(runRetentionPurges(db)).toEqual({ loans: 0, securityEvents: 0, accounts: 0 });
  });
});

describe('runRetentionPurgesSafely', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('purge silencieusement sans rien journaliser quand la purge réussit', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = createUser({ email: 'dormeur@example.fr', createdOn: '2014-05-05' });

    runRetentionPurgesSafely(db, 'message inutilisé', clock);

    expect(userRow(user).deleted_at).toBe(NOW);
    expect(logged).not.toHaveBeenCalled();
  });

  it('journalise le message fourni par l’appelant et ne relance pas l’erreur en cas d’échec', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failingDb = { prepare: () => ({ all: () => { throw new Error('SELECT échec'); } }) } as unknown as Db;

    expect(() =>
      runRetentionPurgesSafely(failingDb, "Purges de rétention : échec après un emprunt, la base n'a pas été purgée.", clock)
    ).not.toThrow();

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(
      "Purges de rétention : échec après un emprunt, la base n'a pas été purgée."
    );
  });

  it('se passe d’horloge fournie, l’horloge système servant de défaut', () => {
    expect(() => runRetentionPurgesSafely(db, 'message inutilisé')).not.toThrow();
  });
});
