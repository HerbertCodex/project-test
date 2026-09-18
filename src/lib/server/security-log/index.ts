/**
 * Journal de sécurité : enregistrement d'un événement, lecture des derniers
 * événements et purge au-delà d'un an calendaire.
 *
 * Toutes les fonctions reçoivent la base en paramètre, et une horloge
 * injectable là où l'instant compte. Le SQL passe exclusivement par des
 * requêtes préparées à paramètres liés.
 *
 * Le schéma ne prévoit aucun champ de détail libre : un événement porte son
 * type, son instant, le compte concerné s'il existe et un sujet court. Les
 * appelants n'y placent que l'e-mail normalisé tenté ou le chemin demandé,
 * jamais un mot de passe, un hachage ou une empreinte de session.
 *
 * La rétention se compte en dates calendaires de Paris. Le module ne planifie
 * rien : la purge s'exécute quand son appelant la déclenche.
 */
import {
  startOfDayInParis,
  subtractCalendarYear,
  systemClock,
  todayInParis,
  type Clock
} from '../dates';
import type { Db } from '../db';
import { DEFAULT_PAGE_SIZE, pageWindow } from '../pagination';

// ---------------------------------------------------------------------------
// Types d'événements
// ---------------------------------------------------------------------------

/** Liste fermée des types journalisables, identique au CHECK de la migration 3. */
export const SECURITY_EVENT_TYPES = [
  'login_success',
  'login_failure',
  'lockout_started',
  'lockout_attempt',
  'signup',
  'access_denied',
  'account_deleted'
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/** Libellé français affiché au libraire pour chaque type. */
export const SECURITY_EVENT_LABELS: Readonly<Record<SecurityEventType, string>> = {
  login_success: 'Connexion réussie',
  login_failure: 'Connexion échouée',
  lockout_started: 'Début de blocage',
  lockout_attempt: 'Tentative pendant un blocage',
  signup: 'Inscription',
  access_denied: 'Accès refusé',
  account_deleted: 'Suppression de compte'
};

/** Garde d'exécution : la liste fermée du type TypeScript, vérifiée à l'appel. */
export function isSecurityEventType(value: unknown): value is SecurityEventType {
  return typeof value === 'string' && (SECURITY_EVENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Sujet
// ---------------------------------------------------------------------------

/** Borne du sujet, alignée sur le CHECK de security_events (longueur d'un e-mail). */
export const SECURITY_SUBJECT_MAX_LENGTH = 254;

const CONTROL_CHARACTERS = /\p{Cc}/gu;

/**
 * Sujet tel qu'il est stocké : les caractères de contrôle sont refusés (ils
 * sont retirés, l'événement restant enregistré), les espaces de bord ôtés et la
 * longueur ramenée à la borne du schéma. Un sujet absent ou vide vaut null.
 * Le contenu restant est conservé littéralement : c'est une donnée, jamais du
 * balisage ni du SQL.
 */
export function normalizeSecuritySubject(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const subject = raw.replace(CONTROL_CHARACTERS, '').trim().slice(0, SECURITY_SUBJECT_MAX_LENGTH);
  return subject.length === 0 ? null : subject;
}

// ---------------------------------------------------------------------------
// Enregistrement
// ---------------------------------------------------------------------------

/** Événement à journaliser : le compte et le sujet sont facultatifs. */
export type SecurityEventInput = {
  type: SecurityEventType;
  userId?: number | null;
  subject?: string | null;
};

const INSERT_EVENT = `INSERT INTO security_events (created_at, type, user_id, subject)
                      VALUES (?, ?, ?, ?)`;

/**
 * Enregistre un événement daté de l'horloge fournie.
 *
 * @throws RangeError si le type n'appartient pas à la liste fermée, si
 * l'identifiant de compte n'est pas un entier ou si l'horloge ne donne pas un
 * instant exploitable : aucune ligne n'est alors écrite.
 */
export function recordSecurityEvent(
  db: Db,
  event: SecurityEventInput,
  clock: Clock = systemClock
): void {
  if (!isSecurityEventType(event.type)) {
    throw new RangeError('Type d’événement de sécurité inconnu : rien n’est journalisé.');
  }

  const userId = event.userId ?? null;
  if (userId !== null && !Number.isSafeInteger(userId)) {
    throw new RangeError('Identifiant de compte invalide : rien n’est journalisé.');
  }

  const createdAt = clock().getTime();
  if (!Number.isSafeInteger(createdAt)) {
    throw new RangeError('Instant invalide : rien n’est journalisé.');
  }

  const subject = normalizeSecuritySubject(event.subject);
  db.prepare(INSERT_EVENT).run(createdAt, event.type, userId, subject);
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Événement affichable : `userName` est nul si aucun compte n'y est rattaché. */
export type SecurityEvent = {
  id: number;
  createdAt: number;
  type: SecurityEventType;
  label: string;
  userId: number | null;
  userName: string | null;
  subject: string | null;
};

type SecurityEventRow = {
  id: number;
  created_at: number;
  type: SecurityEventType;
  user_id: number | null;
  display_name: string | null;
  subject: string | null;
};

/** Page d'événements du journal : les lignes de la page demandée et le total réel. */
export type SecurityEventPage = {
  items: SecurityEvent[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

/**
 * Une page des événements, du plus récent au plus ancien, avec le nom affiché
 * du compte concerné quand il existe encore. `page` est bornée silencieusement
 * à [1, totalPages] : aucune valeur invalide ou hors bornes ne lève d'erreur.
 */
export function listRecentSecurityEvents(db: Db, page = 1): SecurityEventPage {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM security_events').get() as {
    count: number;
  };
  const { page: clampedPage, totalPages, offset } = pageWindow(page, count);

  const rows = db
    .prepare(
      `SELECT security_events.id, security_events.created_at, security_events.type,
              security_events.user_id, security_events.subject, users.display_name
       FROM security_events
       LEFT JOIN users ON users.id = security_events.user_id
       ORDER BY security_events.created_at DESC, security_events.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(DEFAULT_PAGE_SIZE, offset) as SecurityEventRow[];

  const items = rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    // Le CHECK de la table garantit l'appartenance à la liste fermée.
    type: row.type,
    label: SECURITY_EVENT_LABELS[row.type],
    userId: row.user_id,
    userName: row.display_name,
    subject: row.subject
  }));

  return { items, page: clampedPage, pageSize: DEFAULT_PAGE_SIZE, totalItems: count, totalPages };
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/**
 * Premier instant conservé : début de journée à Paris de la date du jour
 * reculée d'une année calendaire. La rétention se compte en dates calendaires
 * de Paris, jamais en 365 jours de millisecondes.
 */
export function securityLogRetentionStart(clock: Clock = systemClock): number {
  return startOfDayInParis(subtractCalendarYear(todayInParis(clock)));
}

/**
 * Supprime les événements strictement antérieurs à `securityLogRetentionStart`.
 *
 * La borne est recalculée à chaque appel depuis l'horloge fournie : la fonction
 * ne planifie rien et se répète sans dommage.
 *
 * @returns le nombre d'événements supprimés.
 */
export function purgeSecurityEvents(db: Db, clock: Clock = systemClock): number {
  const retentionStart = securityLogRetentionStart(clock);
  return db.prepare('DELETE FROM security_events WHERE created_at < ?').run(retentionStart).changes;
}
