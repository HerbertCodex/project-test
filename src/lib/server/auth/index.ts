/**
 * Comptes, mots de passe (Argon2id), sessions, blocage des connexions et
 * journalisation des événements de connexion.
 *
 * Toutes les fonctions reçoivent la base en paramètre, et une horloge
 * injectable là où le temps compte.
 *
 * Ce module est aussi chargé tel quel par Node (suppression des types, sans
 * Vite) depuis `scripts/libraire-creer.ts` : il ne doit contenir aucun import
 * relatif ni alias `$lib` à l'exécution, seulement des `import type`. Le
 * journal de sécurité fait exception par un import dynamique, résolu à la
 * première connexion seulement (voir `loadSecurityLog`).
 */
import { createHash, randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import type { HashOptions } from 'argon2';
import type { Cookies } from '@sveltejs/kit';
import type { Clock } from '../dates';
import type { Db } from '../db';
import type { SecurityEventType } from '../security-log';

export type Role = 'borrower' | 'bookseller';

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
  role: Role;
};

type UserRow = {
  id: number;
  email: string;
  display_name: string;
  password_hash: string;
  role: Role;
};

const currentTime: Clock = () => new Date();

function toAuthUser(row: Omit<UserRow, 'password_hash'>): AuthUser {
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}

/**
 * Compte portant cet e-mail normalisé, ou undefined. Une ligne anonymisée est
 * ignorée : son e-mail substitut ne doit ni se connecter, ni bloquer une
 * inscription reprenant l'ancienne adresse.
 */
function findUserRowByEmail(db: Db, email: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT id, email, display_name, password_hash, role FROM users
       WHERE email = ? AND deleted_at IS NULL`
    )
    .get(email) as UserRow | undefined;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const EMAIL_MAX_LENGTH = 254;
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export type AccountField = 'email' | 'displayName' | 'password';
export type FieldErrors = Partial<Record<AccountField, string>>;

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** Valeurs brutes d'un formulaire ou de la commande : rien n'est présumé. */
export type AccountInput = { email: unknown; displayName: unknown; password: unknown };
export type ValidAccount = { email: string; displayName: string; password: string };
export type AccountValidation = { ok: true; value: ValidAccount } | { ok: false; errors: FieldErrors };

const CONTROL_CHARACTER = /\p{Cc}/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Forme canonique d'un e-mail : sans espaces autour, en minuscules. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(raw: unknown): Validation<string> {
  const email = typeof raw === 'string' ? normalizeEmail(raw) : '';
  if (email.length === 0) {
    return { ok: false, error: 'Saisissez une adresse e-mail.' };
  }
  if (email.length > EMAIL_MAX_LENGTH || CONTROL_CHARACTER.test(email) || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Saisissez une adresse e-mail valide.' };
  }
  return { ok: true, value: email };
}

export function validateDisplayName(raw: unknown): Validation<string> {
  const displayName = typeof raw === 'string' ? raw.trim() : '';
  if (displayName.length === 0) {
    return { ok: false, error: 'Saisissez un nom affiché.' };
  }
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Le nom affiché ne doit pas dépasser ${DISPLAY_NAME_MAX_LENGTH} caractères.`
    };
  }
  if (CONTROL_CHARACTER.test(displayName)) {
    return { ok: false, error: 'Le nom affiché contient des caractères non autorisés.' };
  }
  return { ok: true, value: displayName };
}

/** Le mot de passe n'est jamais retouché (pas de trim) : il est pris tel quel. */
export function validatePassword(raw: unknown): Validation<string> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'Saisissez un mot de passe.' };
  }
  if (raw.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`
    };
  }
  if (raw.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      error: `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`
    };
  }
  return { ok: true, value: raw };
}

export function validateAccount(input: AccountInput): AccountValidation {
  const email = validateEmail(input.email);
  const displayName = validateDisplayName(input.displayName);
  const password = validatePassword(input.password);

  if (email.ok && displayName.ok && password.ok) {
    return {
      ok: true,
      value: { email: email.value, displayName: displayName.value, password: password.value }
    };
  }

  const errors: FieldErrors = {};
  if (!email.ok) errors.email = email.error;
  if (!displayName.ok) errors.displayName = displayName.error;
  if (!password.ok) errors.password = password.error;
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Mots de passe
// ---------------------------------------------------------------------------

/** Minimum OWASP pour Argon2id : m = 19 456 KiB, t = 2, p = 1. */
export const ARGON2_OPTIONS: Readonly<HashOptions> = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Vrai seulement si `password` correspond au hachage. Un mot de passe vide ou
 * trop long est refusé sans calcul Argon2 ; un hachage illisible donne faux.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (password.length === 0 || password.length > PASSWORD_MAX_LENGTH) return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Vérification Argon2 contre un hachage aléatoire, pour qu'un e-mail inconnu
 * coûte autant qu'un mauvais mot de passe. Renvoie toujours faux.
 */
async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url')).catch((error: unknown) => {
    dummyHash = undefined;
    throw error;
  });
  await verifyPassword(await dummyHash, password);
  return false;
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

export const EMAIL_TAKEN_MESSAGE = 'Un compte existe déjà avec cet e-mail.';

export type AccountCreationResult = { ok: true; user: AuthUser } | { ok: false; errors: FieldErrors };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

async function createAccount(
  db: Db,
  input: AccountInput,
  role: Role,
  clock: Clock
): Promise<AccountCreationResult> {
  const validation = validateAccount(input);
  if (!validation.ok) return validation;

  const { email, displayName, password } = validation.value;
  const emailTaken: AccountCreationResult = { ok: false, errors: { email: EMAIL_TAKEN_MESSAGE } };
  if (findUserRowByEmail(db, email)) return emailTaken;

  const passwordHash = await hashPassword(password);
  try {
    const result = db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(email, displayName, passwordHash, role, clock().getTime());
    return { ok: true, user: { id: Number(result.lastInsertRowid), email, displayName, role } };
  } catch (error) {
    // Création concurrente du même e-mail entre la vérification et l'insertion.
    if (isUniqueViolation(error)) return emailTaken;
    throw error;
  }
}

/**
 * Crée un compte libraire. Réservé à la commande locale `libraire:creer` :
 * aucune route web ne doit l'appeler.
 */
export function createBookseller(
  db: Db,
  input: AccountInput,
  clock: Clock = currentTime
): Promise<AccountCreationResult> {
  return createAccount(db, input, 'bookseller', clock);
}

/** Crée un compte emprunteur (inscription libre). */
export function createBorrower(
  db: Db,
  input: AccountInput,
  clock: Clock = currentTime
): Promise<AccountCreationResult> {
  return createAccount(db, input, 'borrower', clock);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;
const SESSION_TOKEN_BYTES = 32;
/** 32 octets en base64url sans remplissage. */
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const SESSION_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: SESSION_DURATION_SECONDS
} as const;

export type Session = { token: string; expiresAt: number };

/** Empreinte SHA-256 (hexadécimal) : seule forme du jeton stockée en base. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Crée une session à expiration absolue de 7 jours avec un nouveau jeton
 * CSPRNG. Les sessions déjà expirées sont purgées au passage.
 */
export function createSession(db: Db, userId: number, clock: Clock = currentTime): Session {
  const now = clock().getTime();
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const expiresAt = now + SESSION_DURATION_MS;

  db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(hashSessionToken(token), userId, now, expiresAt);
  })();

  return { token, expiresAt };
}

/**
 * Utilisateur de la session désignée par le jeton, ou null (jeton absent,
 * mal formé, inconnu, expiré, ou rattaché à un compte anonymisé). L'usage ne
 * prolonge jamais la session.
 */
export function validateSessionToken(
  db: Db,
  token: string | undefined,
  clock: Clock = currentTime
): AuthUser | null {
  if (token === undefined || !SESSION_TOKEN_PATTERN.test(token)) return null;

  const tokenHash = hashSessionToken(token);
  const row = db
    .prepare(
      `SELECT users.id, users.email, users.display_name, users.role, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND users.deleted_at IS NULL`
    )
    .get(tokenHash) as (Omit<UserRow, 'password_hash'> & { expires_at: number }) | undefined;
  if (!row) return null;

  if (clock().getTime() >= row.expires_at) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return toAuthUser(row);
}

/** Supprime la session du jeton (déconnexion). Sans effet si elle n'existe pas. */
export function deleteSession(db: Db, token: string | undefined): void {
  if (token === undefined || token.length === 0) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token));
}

export function setSessionCookie(cookies: Pick<Cookies, 'set'>, token: string): void {
  cookies.set(SESSION_COOKIE_NAME, token, { ...SESSION_COOKIE_OPTIONS });
}

export function deleteSessionCookie(cookies: Pick<Cookies, 'delete'>): void {
  const { maxAge: _maxAge, ...attributes } = SESSION_COOKIE_OPTIONS;
  cookies.delete(SESSION_COOKIE_NAME, attributes);
}

// ---------------------------------------------------------------------------
// Échecs de connexion et blocage
// ---------------------------------------------------------------------------

export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

type FailureRow = { window_start: number; count: number };

/**
 * Fin (ms epoch) du blocage en cours pour cet e-mail, ou null. La fenêtre
 * s'ouvre au premier échec et n'est jamais prolongée.
 */
export function getLockoutEnd(db: Db, email: string, clock: Clock = currentTime): number | null {
  const row = db
    .prepare('SELECT window_start, count FROM login_failures WHERE email = ?')
    .get(normalizeEmail(email)) as FailureRow | undefined;
  if (!row) return null;

  const windowEnd = row.window_start + LOGIN_FAILURE_WINDOW_MS;
  return row.count >= MAX_LOGIN_FAILURES && clock().getTime() < windowEnd ? windowEnd : null;
}

/** Compte un échec ; une fenêtre échue est remplacée par une nouvelle. */
export function recordLoginFailure(db: Db, email: string, clock: Clock = currentTime): void {
  // Dans DO UPDATE, les colonnes non qualifiées désignent la ligne existante,
  // avant toute affectation.
  db.prepare(
    `INSERT INTO login_failures (email, window_start, count) VALUES (@email, @now, 1)
     ON CONFLICT (email) DO UPDATE SET
       window_start = CASE WHEN @now >= window_start + @window THEN @now ELSE window_start END,
       count = CASE WHEN @now >= window_start + @window THEN 1 ELSE count + 1 END`
  ).run({ email: normalizeEmail(email), now: clock().getTime(), window: LOGIN_FAILURE_WINDOW_MS });
}

export function clearLoginFailures(db: Db, email: string): void {
  db.prepare('DELETE FROM login_failures WHERE email = ?').run(normalizeEmail(email));
}

// ---------------------------------------------------------------------------
// Journal de sécurité
// ---------------------------------------------------------------------------

type SecurityLog = typeof import('../security-log');

let securityLog: Promise<SecurityLog> | undefined;

/**
 * Charge le module de journal à la demande, une seule fois par processus.
 *
 * L'import est dynamique parce qu'un import relatif statique rendrait ce
 * module inutilisable par la commande locale, exécutée par Node sans Vite.
 * Cette commande ne se connecte pas : elle ne déclenche jamais ce chargement.
 * Un échec n'est pas mis en cache, pour qu'une tentative suivante réessaie.
 */
function loadSecurityLog(): Promise<SecurityLog> {
  securityLog ??= import('../security-log').catch((error: unknown) => {
    securityLog = undefined;
    throw error;
  });
  return securityLog;
}

/**
 * Journalise un événement de connexion daté de l'horloge de `login`.
 *
 * Le sujet est l'e-mail normalisé tenté, y compris quand aucun compte ne
 * correspond : le journal doit dire quelle adresse est visée. Le module de
 * journal borne ce sujet ; un e-mail vide y devient un sujet absent. Ni le mot
 * de passe, ni le hachage, ni le jeton de session ne quittent `login`.
 */
async function recordLoginEvent(
  db: Db,
  type: SecurityEventType,
  email: string,
  userId: number | null,
  clock: Clock
): Promise<void> {
  const { recordSecurityEvent } = await loadSecurityLog();
  recordSecurityEvent(db, { type, userId, subject: email }, clock);
}

/**
 * Ouvre la session du compte et date sa dernière connexion dans la même
 * transaction : un succès laisse les deux traces, ou aucune.
 */
function openSession(db: Db, userId: number, clock: Clock): Session {
  // Horloge lue une seule fois : la session et la date de connexion portent le
  // même instant, même avec une horloge système qui avance entre deux appels.
  const now = clock();
  return db.transaction(() => {
    const session = createSession(db, userId, () => now);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.getTime(), userId);
    return session;
  })();
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

/** Message unique pour un e-mail inconnu comme pour un mauvais mot de passe. */
export const LOGIN_FAILED_MESSAGE = 'E-mail ou mot de passe incorrect.';

export type LoginInput = { email: unknown; password: unknown };

export type LoginResult =
  | { ok: true; user: AuthUser; session: Session }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'locked'; lockedUntil: number };

export type LoginOptions = {
  clock?: Clock;
  /** Jeton du cookie reçu avec la requête : sa session est supprimée en cas de succès. */
  previousSessionToken?: string;
};

/**
 * Vérifie les identifiants sous le contrôle du blocage par e-mail normalisé
 * (compte existant ou non) et ouvre une nouvelle session en cas de succès.
 *
 * Chaque issue est journalisée : succès, échec, échec qui déclenche le
 * blocage, et tentative reçue pendant un blocage (jamais comptée comme un
 * échec, puisqu'elle n'est pas vérifiée).
 */
export async function login(
  db: Db,
  input: LoginInput,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const clock = options.clock ?? currentTime;
  const email = typeof input.email === 'string' ? normalizeEmail(input.email) : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const trackable = email.length > 0 && email.length <= EMAIL_MAX_LENGTH;

  // Le compte est lu avant la vérification du blocage pour que même une
  // tentative bloquée désigne le compte visé dans le journal.
  const row = trackable ? findUserRowByEmail(db, email) : undefined;
  const userId = row?.id ?? null;

  const lockedBefore = trackable ? getLockoutEnd(db, email, clock) : null;
  if (lockedBefore !== null) {
    await recordLoginEvent(db, 'lockout_attempt', email, userId, clock);
    return { ok: false, reason: 'locked', lockedUntil: lockedBefore };
  }

  const passwordMatches = row
    ? await verifyPassword(row.password_hash, password)
    : await verifyDummyPassword(password);

  if (!row || !passwordMatches) {
    if (trackable) recordLoginFailure(db, email, clock);
    await recordLoginEvent(db, 'login_failure', email, userId, clock);
    // Un blocage en cours juste après l'échec ne peut venir que de cet échec :
    // une fenêtre déjà bloquée aurait été refusée plus haut.
    if (trackable && getLockoutEnd(db, email, clock) !== null) {
      await recordLoginEvent(db, 'lockout_started', email, userId, clock);
    }
    return { ok: false, reason: 'invalid' };
  }

  // Des tentatives parallèles ont pu déclencher le blocage pendant la vérification.
  const lockedAfter = getLockoutEnd(db, email, clock);
  if (lockedAfter !== null) {
    await recordLoginEvent(db, 'lockout_attempt', email, row.id, clock);
    return { ok: false, reason: 'locked', lockedUntil: lockedAfter };
  }

  clearLoginFailures(db, email);
  deleteSession(db, options.previousSessionToken);
  const user = toAuthUser(row);
  const session = openSession(db, user.id, clock);
  await recordLoginEvent(db, 'login_success', email, user.id, clock);
  return { ok: true, user, session };
}
