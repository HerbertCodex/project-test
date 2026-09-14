import type { Handle, RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME, deleteSessionCookie, validateSessionToken } from '$lib/server/auth';
import { getDb } from '$lib/server/db';

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

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = loadUser(event);

  const response = await resolve(event);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) {
      response.headers.set(name, value);
    }
  }

  return response;
};
