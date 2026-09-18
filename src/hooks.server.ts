import type { Handle, RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME, deleteSessionCookie, validateSessionToken } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { runRetentionPurges } from '$lib/server/retention';
import { recordSecurityEvent } from '$lib/server/security-log';

/**
 * Exécute les purges de rétention à l'ouverture de la base par l'application.
 *
 * L'appel a lieu au chargement du module, donc une seule fois par processus :
 * c'est ici que l'application ouvre sa base, `getDb()` la créant et la migrant
 * au premier appel. Le déclenchement n'est volontairement pas placé dans
 * `$lib/server/db`, que la commande locale `libraire:creer` charge sous Node
 * sans Vite : y importer le module de rétention casserait la commande.
 *
 * Un échec de purge ne doit pas empêcher le serveur de répondre : l'erreur est
 * contenue et signalée par un message générique, sans SQL ni pile, la purge
 * étant retentée au démarrage suivant.
 */
function purgeOnStartup(): void {
  try {
    runRetentionPurges(getDb());
  } catch {
    console.error("Purges de rétention : échec au démarrage, la base n'a pas été purgée.");
  }
}

purgeOnStartup();

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY'
};

/** Utilisateur de la session du cookie ; un cookie invalide est effacé. */
function loadUser(event: RequestEvent): App.Locals['user'] {
  const token = event.cookies.get(SESSION_COOKIE_NAME);
  if (token === undefined) return null;

  const user = validateSessionToken(getDb(), token);
  if (!user) deleteSessionCookie(event.cookies);
  return user;
}

const FORBIDDEN = 403;

/**
 * Journalise un refus d'accès, point central pour les gardes requireBookseller
 * et requireBorrower, dont la signature reste inchangée : elles répondent 403 à
 * un utilisateur connecté et redirigent l'anonyme en 303 vers /connexion, si
 * bien que le statut et la présence d'une session suffisent ici à reconnaître
 * un refus. Le sujet est le chemin demandé, que le module de journal borne et
 * débarrasse de ses caractères de contrôle ; aucun secret n'y figure.
 */
function logAccessDenied(event: RequestEvent, response: Response): void {
  const user = event.locals.user;
  if (response.status !== FORBIDDEN || !user) return;

  recordSecurityEvent(getDb(), {
    type: 'access_denied',
    userId: user.id,
    subject: event.url.pathname
  });
}

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = loadUser(event);

  const response = await resolve(event);

  logAccessDenied(event, response);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) {
      response.headers.set(name, value);
    }
  }

  return response;
};
