import { verify } from 'argon2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOGIN_FAILURE_WINDOW_MS,
  MAX_LOGIN_FAILURES,
  createBookseller,
  createBorrower,
  createSession,
  login,
  recordLoginFailure,
  validateSessionToken,
  verifyPassword,
  type AuthUser
} from '../auth';
import type { Clock } from '../dates';
import { openDatabase, type Db } from '../db';
import { hasActiveLoan } from '../loans';
import { recordSecurityEvent } from '../security-log';
import {
  ANONYMIZED_DISPLAY_NAME,
  anonymizeAccount,
  anonymizedEmail,
  deleteOwnAccount
} from './index';

// Enveloppe le vrai verify pour observer qu'aucun calcul Argon2 n'a lieu.
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

const PASSWORD = 'correct horse battery';
const WRONG_PASSWORD = 'mauvais mot de passe';
const BORROWER_EMAIL = 'lecteur@example.fr';
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

const T0 = Date.UTC(2026, 8, 18, 12, 0, 0);
const clockAt =
  (instant: number): Clock =>
  () =>
    new Date(instant);
const clock = clockAt(T0);

type EventRow = {
  created_at: number;
  type: string;
  user_id: number | null;
  subject: string | null;
};

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  vi.mocked(verify).mockClear();
});

afterEach(() => {
  db.close();
});

async function borrower(email = BORROWER_EMAIL, displayName = 'Lecteur') {
  const created = await createBorrower(db, { email, displayName, password: PASSWORD });
  if (!created.ok) throw new Error('compte emprunteur de test non créé');
  return created.user;
}

async function bookseller(email = 'libraire@example.fr') {
  const created = await createBookseller(db, { email, displayName: 'Jeanne', password: PASSWORD });
  if (!created.ok) throw new Error('compte libraire de test non créé');
  return created.user;
}

/** Un livre neuf par prêt et par vente : l'exemplaire de prêt est unique. */
function addBook(): number {
  const inserted = db
    .prepare("INSERT INTO books (title, author) VALUES ('Le Rivage des Syrtes', 'Julien Gracq')")
    .run();
  return Number(inserted.lastInsertRowid);
}

function addLoan(userId: number, returnedOn: string | null = null): void {
  db.prepare(
    `INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on)
     VALUES (?, ?, '2026-09-01', '2026-10-01', ?)`
  ).run(addBook(), userId, returnedOn);
}

function addSale(booksellerId: number): void {
  db.prepare(
    `INSERT INTO sales (book_id, bookseller_id, quantity, unit_price_cents, total_cents, sold_on)
     VALUES (?, ?, 2, 1000, 2000, '2026-09-01')`
  ).run(addBook(), booksellerId);
}

function userRow(userId: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
}

function events(): EventRow[] {
  return db
    .prepare('SELECT created_at, type, user_id, subject FROM security_events ORDER BY id')
    .all() as EventRow[];
}

/** Requêtes fixes : aucun nom de table n'est interpolé dans une chaîne SQL. */
const COUNT_QUERIES = {
  sessions: 'SELECT count(*) AS n FROM sessions',
  loans: 'SELECT count(*) AS n FROM loans',
  sales: 'SELECT count(*) AS n FROM sales',
  login_failures: 'SELECT count(*) AS n FROM login_failures',
  users: 'SELECT count(*) AS n FROM users'
} as const;

function count(table: keyof typeof COUNT_QUERIES): number {
  return (db.prepare(COUNT_QUERIES[table]).get() as { n: number }).n;
}

function failureRow(): { email: string; window_start: number; count: number } | undefined {
  return db.prepare('SELECT * FROM login_failures').get() as
    | { email: string; window_start: number; count: number }
    | undefined;
}

function tableNames(db: Db): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

describe('e-mail substitut', () => {
  it('dérive de l’identifiant une adresse unique, normalisée, sur un domaine réservé', () => {
    const first = anonymizedEmail(1);
    const second = anonymizedEmail(2);

    expect(first).not.toBe(second);
    expect(first).toBe(first.trim().toLowerCase());
    expect(first).not.toMatch(/\s/);
    // RFC 2606 : .invalid ne peut être ni délivré ni joint.
    expect(first.endsWith('.invalid')).toBe(true);
    expect(first).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it('refuse un identifiant qui n’est pas un entier strictement positif', () => {
    for (const userId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => anonymizedEmail(userId)).toThrow(RangeError);
    }
  });
});

describe('anonymisation en place', () => {
  it('remplace la ligne users et efface l’ancien e-mail sans toucher aux prêts ni aux ventes', async () => {
    const user = await borrower();
    const seller = await bookseller();
    createSession(db, user.id, clock);
    createSession(db, user.id, clock);
    addLoan(user.id, '2026-09-10');
    addSale(seller.id);
    recordLoginFailure(db, BORROWER_EMAIL, clock);
    recordSecurityEvent(db, { type: 'login_failure', userId: user.id, subject: BORROWER_EMAIL }, clock);
    recordSecurityEvent(db, { type: 'login_failure', userId: null, subject: 'autre@example.fr' }, clock);

    expect(anonymizeAccount(db, user.id, clock)).toBe(true);

    const row = userRow(user.id);
    expect(row).toEqual({
      id: user.id,
      email: anonymizedEmail(user.id),
      display_name: ANONYMIZED_DISPLAY_NAME,
      password_hash: expect.any(String),
      // Le rôle n'est pas modifié par l'anonymisation.
      role: 'borrower',
      created_at: expect.any(Number),
      last_login_at: null,
      deleted_at: T0
    });
    // Aucun mot de passe ne peut vérifier le hachage de remplacement.
    expect(String(row.password_hash)).not.toContain('$argon2');
    expect(await verifyPassword(String(row.password_hash), PASSWORD)).toBe(false);
    expect(await verifyPassword(String(row.password_hash), String(row.password_hash))).toBe(false);

    expect(count('sessions')).toBe(0);
    expect(count('login_failures')).toBe(0);
    // Le sujet de l'ancien e-mail est effacé, les autres sujets sont intacts.
    expect(events().map((event) => [event.type, event.subject])).toEqual([
      ['login_failure', null],
      ['login_failure', 'autre@example.fr'],
      ['account_deleted', null]
    ]);
    // Les prêts et les ventes restent rattachés à la ligne anonymisée.
    expect(count('loans')).toBe(1);
    expect(count('sales')).toBe(1);
    expect(db.prepare('SELECT user_id FROM loans').all()).toEqual([{ user_id: user.id }]);
    expect(db.prepare('SELECT bookseller_id FROM sales').all()).toEqual([
      { bookseller_id: seller.id }
    ]);
  });

  it('journalise exactement un account_deleted rattaché au compte et sans sujet', async () => {
    const user = await borrower();

    anonymizeAccount(db, user.id, clock);

    expect(events()).toEqual([
      { created_at: T0, type: 'account_deleted', user_id: user.id, subject: null }
    ]);
  });

  it('reste sans effet sur un compte inconnu ou déjà anonymisé', async () => {
    const user = await borrower();
    anonymizeAccount(db, user.id, clock);
    const before = userRow(user.id);

    expect(anonymizeAccount(db, user.id, clockAt(T0 + LOGIN_FAILURE_WINDOW_MS))).toBe(false);
    expect(anonymizeAccount(db, user.id + 999, clock)).toBe(false);

    expect(userRow(user.id)).toEqual(before);
    // Une purge rejouée n'ajoute pas de second événement.
    expect(events().map((event) => event.type)).toEqual(['account_deleted']);
  });

  it('anonymise un compte au nom et à l’e-mail hostiles sans altérer les tables', async () => {
    const email = `${SQL_PAYLOAD.replace(/\s/g, '')}@example.fr`.toLowerCase();
    const user = await borrower(email, SQL_PAYLOAD);
    recordLoginFailure(db, email, clock);
    recordSecurityEvent(db, { type: 'login_failure', userId: user.id, subject: email }, clock);

    expect(anonymizeAccount(db, user.id, clock)).toBe(true);

    expect(userRow(user.id)).toMatchObject({
      email: anonymizedEmail(user.id),
      display_name: ANONYMIZED_DISPLAY_NAME
    });
    expect(count('login_failures')).toBe(0);
    expect(events().map((event) => event.subject)).toEqual([null, null]);
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);
  });
});

describe('suppression en libre-service', () => {
  it('refuse un mot de passe absent, vide, non textuel ou trop long sans calcul Argon2', async () => {
    const user = await borrower();
    createSession(db, user.id, clock);
    vi.mocked(verify).mockClear();

    for (const password of [undefined, null, 42, {}, '', 'a'.repeat(257), 'a'.repeat(100_000)]) {
      expect(await deleteOwnAccount(db, user, password, clock)).toEqual({
        ok: false,
        reason: 'invalid'
      });
    }

    expect(verify).not.toHaveBeenCalled();
    expect(userRow(user.id)).toMatchObject({ email: BORROWER_EMAIL, deleted_at: null });
    expect(count('sessions')).toBe(1);
    expect(count('login_failures')).toBe(0);
    expect(events()).toEqual([]);
  });

  it('refuse tant qu’un prêt est en cours, sans rien écrire', async () => {
    const user = await borrower();
    createSession(db, user.id, clock);
    addLoan(user.id, '2026-09-10');
    addLoan(user.id);
    const before = userRow(user.id);
    vi.mocked(verify).mockClear();

    expect(hasActiveLoan(db, user.id)).toBe(true);
    expect(await deleteOwnAccount(db, user, PASSWORD, clock)).toEqual({
      ok: false,
      reason: 'active-loan'
    });

    // Le refus précède la vérification du mot de passe : rien n'est écrit.
    expect(verify).not.toHaveBeenCalled();
    expect(userRow(user.id)).toEqual(before);
    expect(count('sessions')).toBe(1);
    expect(count('loans')).toBe(2);
    expect(count('login_failures')).toBe(0);
    expect(events()).toEqual([]);
  });

  it('accepte la suppression quand tous les prêts ont été rendus', async () => {
    const user = await borrower();
    addLoan(user.id, '2026-09-10');

    expect(hasActiveLoan(db, user.id)).toBe(false);
    expect(await deleteOwnAccount(db, user, PASSWORD, clock)).toEqual({ ok: true });
    expect(count('loans')).toBe(1);
  });

  it('refuse un mot de passe incorrect, compte l’échec et le journalise', async () => {
    const user = await borrower();
    createSession(db, user.id, clock);

    expect(await deleteOwnAccount(db, user, WRONG_PASSWORD, clock)).toEqual({
      ok: false,
      reason: 'invalid'
    });

    expect(failureRow()).toEqual({ email: BORROWER_EMAIL, window_start: T0, count: 1 });
    expect(events()).toEqual([
      { created_at: T0, type: 'login_failure', user_id: user.id, subject: BORROWER_EMAIL }
    ]);
    // Ni la ligne users ni les sessions ne sont touchées par un échec.
    expect(userRow(user.id)).toMatchObject({ email: BORROWER_EMAIL, deleted_at: null });
    expect(count('sessions')).toBe(1);
  });

  it('partage la fenêtre de blocage de la connexion et journalise son début au cinquième échec', async () => {
    const user = await borrower();
    // Quatre échecs de connexion, puis un cinquième sur la suppression.
    for (let attempt = 1; attempt < MAX_LOGIN_FAILURES; attempt++) {
      await login(db, { email: BORROWER_EMAIL, password: WRONG_PASSWORD }, { clock });
    }

    expect(await deleteOwnAccount(db, user, WRONG_PASSWORD, clock)).toEqual({
      ok: false,
      reason: 'invalid'
    });

    expect(failureRow()).toMatchObject({ count: MAX_LOGIN_FAILURES });
    expect(events().map((event) => event.type).slice(-2)).toEqual([
      'login_failure',
      'lockout_started'
    ]);
  });

  it('refuse pendant un blocage sans vérifier le mot de passe ni compter d’échec', async () => {
    const user = await borrower();
    createSession(db, user.id, clock);
    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES; attempt++) {
      recordLoginFailure(db, BORROWER_EMAIL, clock);
    }
    const before = failureRow();
    vi.mocked(verify).mockClear();

    const during = clockAt(T0 + 60_000);
    expect(await deleteOwnAccount(db, user, PASSWORD, during)).toEqual({
      ok: false,
      reason: 'locked',
      lockedUntil: T0 + LOGIN_FAILURE_WINDOW_MS
    });

    expect(verify).not.toHaveBeenCalled();
    expect(failureRow()).toEqual(before);
    expect(events()).toEqual([
      {
        created_at: T0 + 60_000,
        type: 'lockout_attempt',
        user_id: user.id,
        subject: BORROWER_EMAIL
      }
    ]);
    expect(userRow(user.id)).toMatchObject({ email: BORROWER_EMAIL, deleted_at: null });
    expect(count('sessions')).toBe(1);
  });

  it('anonymise le compte et ferme toutes ses sessions avec le bon mot de passe', async () => {
    const user = await borrower();
    const first = createSession(db, user.id, clock);
    const second = createSession(db, user.id, clock);
    recordLoginFailure(db, BORROWER_EMAIL, clock);

    expect(await deleteOwnAccount(db, user, PASSWORD, clock)).toEqual({ ok: true });

    expect(userRow(user.id)).toMatchObject({
      email: anonymizedEmail(user.id),
      display_name: ANONYMIZED_DISPLAY_NAME,
      deleted_at: T0
    });
    // Toutes les sessions du compte tombent, pas seulement celle du navigateur.
    expect(count('sessions')).toBe(0);
    expect(validateSessionToken(db, first.token, clock)).toBeNull();
    expect(validateSessionToken(db, second.token, clock)).toBeNull();
    expect(count('login_failures')).toBe(0);
    expect(events()).toEqual([
      { created_at: T0, type: 'account_deleted', user_id: user.id, subject: null }
    ]);
  });

  it('libère l’ancien e-mail pour une nouvelle inscription, sur un compte distinct', async () => {
    const user = await borrower();
    expect(await deleteOwnAccount(db, user, PASSWORD, clock)).toEqual({ ok: true });

    expect(await login(db, { email: BORROWER_EMAIL, password: PASSWORD }, { clock })).toEqual({
      ok: false,
      reason: 'invalid'
    });

    const recreated = await createBorrower(
      db,
      { email: BORROWER_EMAIL, displayName: 'Autre lecteur', password: PASSWORD },
      clock
    );
    expect(recreated.ok).toBe(true);
    if (!recreated.ok) return;
    expect(recreated.user.id).not.toBe(user.id);
    expect(count('users')).toBe(2);
    expect((await login(db, { email: BORROWER_EMAIL, password: PASSWORD }, { clock })).ok).toBe(
      true
    );
  });

  it('supprime le compte libraire par le même parcours en conservant ses ventes', async () => {
    const seller = await bookseller();
    const session = createSession(db, seller.id, clock);
    addSale(seller.id);
    addSale(seller.id);

    expect(await deleteOwnAccount(db, seller, PASSWORD, clock)).toEqual({ ok: true });

    expect(userRow(seller.id)).toMatchObject({
      email: anonymizedEmail(seller.id),
      display_name: ANONYMIZED_DISPLAY_NAME,
      role: 'bookseller',
      deleted_at: T0
    });
    // Les ventes restent en base, rattachées à la ligne anonymisée.
    expect(count('sales')).toBe(2);
    expect(db.prepare('SELECT DISTINCT bookseller_id FROM sales').all()).toEqual([
      { bookseller_id: seller.id }
    ]);
    // L'ancienne session ne donne plus accès à l'espace libraire.
    expect(validateSessionToken(db, session.token, clock)).toBeNull();
  });

  it('ne traite que le compte de la session, quels que soient l’e-mail et le rôle reçus', async () => {
    const user = await borrower();
    const other = await borrower('autre@example.fr', 'Autre');
    createSession(db, other.id, clock);
    // Un appelant hostile fournit l'e-mail et le rôle d'un autre compte : seul
    // l'identifiant de la session est retenu, et l'e-mail vient de la base.
    const forged: AuthUser = { ...user, email: other.email, role: 'bookseller' };

    expect(await deleteOwnAccount(db, forged, WRONG_PASSWORD, clock)).toEqual({
      ok: false,
      reason: 'invalid'
    });
    expect(failureRow()).toMatchObject({ email: BORROWER_EMAIL });
    expect(await deleteOwnAccount(db, forged, PASSWORD, clock)).toEqual({ ok: true });

    expect(userRow(user.id)).toMatchObject({
      email: anonymizedEmail(user.id),
      role: 'borrower',
      deleted_at: T0
    });
    expect(userRow(other.id)).toMatchObject({
      email: 'autre@example.fr',
      display_name: 'Autre',
      deleted_at: null
    });
    expect(count('sessions')).toBe(1);
  });

  it('n’écrit ni mot de passe, ni hachage, ni jeton dans les colonnes des événements', async () => {
    const user = await borrower();
    const session = createSession(db, user.id, clock);
    const { password_hash: passwordHash } = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string };

    await deleteOwnAccount(db, user, WRONG_PASSWORD, clock);
    expect(await deleteOwnAccount(db, user, PASSWORD, clock)).toEqual({ ok: true });

    const secrets = [PASSWORD, WRONG_PASSWORD, passwordHash, session.token];
    const rows = db.prepare('SELECT * FROM security_events').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // La liste explicite garantit qu'une colonne ajoutée plus tard reste couverte.
      expect(Object.keys(row).sort()).toEqual(['created_at', 'id', 'subject', 'type', 'user_id']);
      for (const value of Object.values(row)) {
        for (const secret of secrets) {
          expect(String(value)).not.toContain(secret);
        }
      }
    }
  });
});
