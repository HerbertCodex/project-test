/**
 * Suppression de compte en libre-service et anonymisation en place de la ligne
 * `users`.
 *
 * Toutes les fonctions reçoivent la base en paramètre, et une horloge
 * injectable là où l'instant compte. Le SQL passe exclusivement par des
 * requêtes préparées à paramètres liés.
 *
 * Aucune ligne `users` n'est jamais supprimée : les prêts et les ventes la
 * référencent en ON DELETE RESTRICT et doivent rester lisibles. La ligne est
 * remplacée par un tombstone dont plus aucune colonne ne désigne la personne,
 * et l'ancien e-mail est effacé des autres tables qui le portaient.
 */
import {
  PASSWORD_MAX_LENGTH,
  getLockoutEnd,
  normalizeEmail,
  recordLoginFailure,
  verifyPassword,
  type AuthUser
} from '../auth';
import { systemClock, type Clock } from '../dates';
import type { Db } from '../db';
import { hasActiveLoan } from '../loans';
import { recordSecurityEvent } from '../security-log';

// ---------------------------------------------------------------------------
// Forme du tombstone
// ---------------------------------------------------------------------------

/** Nom affiché de toute ligne anonymisée : non vide, et ne désignant personne. */
export const ANONYMIZED_DISPLAY_NAME = 'Compte supprimé';

/** Domaine réservé (RFC 2606) : aucun e-mail substitut n'est délivrable. */
const ANONYMIZED_EMAIL_DOMAIN = 'compte-supprime.invalid';

/**
 * Valeur écrite dans `password_hash` : elle n'est pas un hachage Argon2, donc
 * `verifyPassword` renvoie faux pour n'importe quel mot de passe présenté.
 */
const ANONYMIZED_PASSWORD_HASH = 'compte-supprime:aucun-mot-de-passe';

/**
 * E-mail substitut d'un compte anonymisé. Il dérive de l'identifiant, immuable
 * et unique, donc il est unique lui aussi ; il est en minuscules et sans
 * espace, comme l'exigent les CHECK de `users`. L'ancien e-mail redevient de
 * ce fait disponible à l'inscription.
 *
 * @throws RangeError si l'identifiant n'est pas un entier strictement positif.
 */
export function anonymizedEmail(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new RangeError('Identifiant de compte invalide : aucun e-mail substitut.');
  }
  return `compte-${userId}@${ANONYMIZED_EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Anonymisation
// ---------------------------------------------------------------------------

/**
 * Anonymise en place le compte désigné, dans une seule transaction : tombstone
 * de la ligne `users` (le rôle est conservé), suppression de toutes ses
 * sessions et de la ligne `login_failures` de son ancien e-mail, effacement du
 * sujet des événements de sécurité qui portaient cet e-mail, puis
 * journalisation d'un `account_deleted` rattaché au compte et sans sujet.
 *
 * Les prêts et les ventes ne sont pas touchés : ils restent rattachés à la
 * ligne anonymisée.
 *
 * @returns vrai si le compte vient d'être anonymisé ; faux s'il est inconnu ou
 * déjà anonymisé, auquel cas rien n'est écrit ni journalisé.
 */
export function anonymizeAccount(db: Db, userId: number, clock: Clock = systemClock): boolean {
  // Horloge lue une seule fois : la date de suppression et l'événement portent
  // le même instant, même si l'horloge système avance entre deux appels.
  const now = clock();

  return db
    .transaction(() => {
      const row = db
        .prepare('SELECT email FROM users WHERE id = ? AND deleted_at IS NULL')
        .get(userId) as { email: string } | undefined;
      if (!row) return false;

      db.prepare(
        `UPDATE users SET email = ?, display_name = ?, password_hash = ?, deleted_at = ?
         WHERE id = ? AND deleted_at IS NULL`
      ).run(
        anonymizedEmail(userId),
        ANONYMIZED_DISPLAY_NAME,
        ANONYMIZED_PASSWORD_HASH,
        now.getTime(),
        userId
      );
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM login_failures WHERE email = ?').run(row.email);
      db.prepare('UPDATE security_events SET subject = NULL WHERE subject = ?').run(row.email);
      recordSecurityEvent(db, { type: 'account_deleted', userId, subject: null }, () => now);
      return true;
    })
    .immediate();
}

// ---------------------------------------------------------------------------
// Suppression en libre-service
// ---------------------------------------------------------------------------

export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'active-loan' }
  | { ok: false; reason: 'locked'; lockedUntil: number };

/**
 * Supprime le compte de la session après reconfirmation de son mot de passe.
 *
 * Le compte traité est exclusivement celui de `user`, quel que soit son rôle :
 * aucun identifiant venu d'un formulaire n'entre ici.
 *
 * Les échecs de mot de passe comptent dans la même fenêtre de blocage que la
 * connexion et sont journalisés de la même façon : un blocage en cours refuse
 * la demande sans vérifier le mot de passe, et le refus reste indiscernable
 * d'une erreur de saisie ordinaire.
 *
 * @param password valeur brute du formulaire : son type et sa longueur sont
 * vérifiés avant tout calcul Argon2.
 * @returns le succès, ou le motif du refus : `locked` avec la fin du blocage,
 * `active-loan` tant qu'un prêt n'est pas rendu (rien n'est alors écrit), ou
 * `invalid` pour toute saisie qui ne vérifie pas le mot de passe du compte.
 */
export async function deleteOwnAccount(
  db: Db,
  user: AuthUser,
  password: unknown,
  clock: Clock = systemClock
): Promise<AccountDeletionResult> {
  const invalid: AccountDeletionResult = { ok: false, reason: 'invalid' };
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return invalid;
  }

  // L'e-mail du blocage et le hachage vérifié viennent de la base, jamais de la
  // session : un compte déjà anonymisé n'a plus rien à supprimer.
  const row = db
    .prepare('SELECT email, password_hash FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(user.id) as { email: string; password_hash: string } | undefined;
  if (!row) return invalid;

  const email = normalizeEmail(row.email);

  const lockedUntil = getLockoutEnd(db, email, clock);
  if (lockedUntil !== null) {
    recordSecurityEvent(db, { type: 'lockout_attempt', userId: user.id, subject: email }, clock);
    return { ok: false, reason: 'locked', lockedUntil };
  }

  // Le prêt en cours est une obligation : la suppression ne doit pas l'effacer.
  if (hasActiveLoan(db, user.id)) return { ok: false, reason: 'active-loan' };

  if (!(await verifyPassword(row.password_hash, password))) {
    recordLoginFailure(db, email, clock);
    recordSecurityEvent(db, { type: 'login_failure', userId: user.id, subject: email }, clock);
    // Un blocage en cours juste après l'échec ne peut venir que de cet échec :
    // une fenêtre déjà bloquée aurait été refusée plus haut.
    if (getLockoutEnd(db, email, clock) !== null) {
      recordSecurityEvent(db, { type: 'lockout_started', userId: user.id, subject: email }, clock);
    }
    return invalid;
  }

  // La ligne login_failures de cet e-mail est supprimée par l'anonymisation.
  anonymizeAccount(db, user.id, clock);
  return { ok: true };
}
