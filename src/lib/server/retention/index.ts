/**
 * Rétention des données : purge des prêts rendus, purge du journal de sécurité
 * et anonymisation des comptes emprunteurs inactifs.
 *
 * Le module ne planifie rien et ne connaît pas ses déclencheurs : il réunit les
 * trois purges derrière un seul appel, exécuté quand son appelant le décide.
 *
 * Toutes les bornes sont des dates calendaires de Paris reculées d'un nombre
 * entier d'années (`subtractCalendarYear`), jamais des durées en jours ou en
 * millisecondes : la borne tombe le même quantième d'une année à l'autre, que
 * l'intervalle contienne ou non un 29 février.
 *
 * Toutes les fonctions reçoivent la base en paramètre, et une horloge
 * injectable. Le SQL passe exclusivement par des requêtes préparées à
 * paramètres liés.
 */
import { anonymizeAccount } from '../account';
import {
  startOfDayInParis,
  subtractCalendarYear,
  systemClock,
  todayInParis,
  type Clock
} from '../dates';
import type { Db } from '../db';
import { purgeReturnedLoans } from '../loans';
import { purgeSecurityEvents } from '../security-log';

// ---------------------------------------------------------------------------
// Comptes emprunteurs inactifs
// ---------------------------------------------------------------------------

/** Années calendaires sans activité au terme desquelles un emprunteur est anonymisé. */
const ACCOUNT_INACTIVITY_YEARS = 3;

/**
 * Première date calendaire qui vaut encore activité récente : la date du jour à
 * Paris reculée de `ACCOUNT_INACTIVITY_YEARS` années calendaires.
 */
function inactivityBoundary(clock: Clock): string {
  let boundary = todayInParis(clock);
  for (let year = 0; year < ACCOUNT_INACTIVITY_YEARS; year += 1) {
    boundary = subtractCalendarYear(boundary);
  }
  return boundary;
}

/**
 * Comptes à anonymiser, par identifiant croissant.
 *
 * Le rôle `bookseller` est exclu : un compte de personnel, créé exprès par la
 * commande locale, fermerait l'accès à l'espace libraire s'il disparaissait
 * pendant une absence prolongée. Sa suppression reste possible en libre-service.
 *
 * L'activité connue d'un compte est sa dernière connexion, à défaut sa création,
 * et la date la plus récente de ses prêts. Le CHECK de `loans` garantissant
 * `returned_on >= borrowed_on`, cette date vaut `returned_on` pour un prêt rendu
 * et `borrowed_on` pour un prêt en cours, qui épargne en outre le compte à lui
 * seul.
 */
const INACTIVE_BORROWERS = `
  SELECT users.id
  FROM users
  WHERE users.role = 'borrower'
    AND users.deleted_at IS NULL
    AND COALESCE(users.last_login_at, users.created_at) < ?
    AND NOT EXISTS (
      SELECT 1
      FROM loans
      WHERE loans.user_id = users.id
        AND (
          loans.returned_on IS NULL
          OR COALESCE(loans.returned_on, loans.borrowed_on) >= ?
        )
    )
  ORDER BY users.id`;

/**
 * Anonymise les comptes emprunteurs sans activité depuis la borne d'inactivité
 * et renvoie leur nombre. Chaque compte retenu passe par `anonymizeAccount`, qui
 * journalise un `account_deleted` ; un compte déjà anonymisé est hors sélection,
 * si bien qu'un second passage n'écrit rien.
 */
function purgeInactiveBorrowers(db: Db, clock: Clock): number {
  const boundary = inactivityBoundary(clock);
  const rows = db.prepare(INACTIVE_BORROWERS).all(startOfDayInParis(boundary), boundary) as {
    id: number;
  }[];

  let anonymized = 0;
  for (const row of rows) {
    if (anonymizeAccount(db, row.id, clock)) anonymized += 1;
  }
  return anonymized;
}

// ---------------------------------------------------------------------------
// Purges réunies
// ---------------------------------------------------------------------------

/** Ce que chaque purge a traité : lignes supprimées, comptes anonymisés. */
export type RetentionCounts = {
  loans: number;
  securityEvents: number;
  accounts: number;
};

/**
 * Exécute les trois purges de rétention et renvoie leurs compteurs.
 *
 * L'appel est sûr à répéter : chaque purge est bornée par l'horloge fournie, et
 * un second passage sans nouvelle donnée à purger ne renvoie que des zéros.
 */
export function runRetentionPurges(db: Db, clock: Clock = systemClock): RetentionCounts {
  const loans = purgeReturnedLoans(db, clock);
  const securityEvents = purgeSecurityEvents(db, clock);
  // L'anonymisation vient en dernier : ses événements account_deleted portent
  // l'instant du jour et n'ont pas à traverser la purge du journal.
  const accounts = purgeInactiveBorrowers(db, clock);

  return { loans, securityEvents, accounts };
}
