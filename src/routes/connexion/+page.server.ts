import { fail, redirect } from '@sveltejs/kit';
import { LOGIN_FAILED_MESSAGE, SESSION_COOKIE_NAME, login, setSessionCookie } from '$lib/server/auth';
import { LIBRARY_TIME_ZONE } from '$lib/server/dates';
import { getDb } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

const parisTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: LIBRARY_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23'
});

/** « Trop de tentatives… Réessayez à partir de 14 h 47. » (heure de Paris). */
function lockoutMessage(lockedUntil: number): string {
  const parts = Object.fromEntries(
    parisTime.formatToParts(new Date(lockedUntil)).map((part) => [part.type, part.value])
  );
  return `Trop de tentatives pour cet e-mail. Réessayez à partir de ${parts.hour} h ${parts.minute}.`;
}

export const load: PageServerLoad = ({ url }) => ({
  // Valeur fixe comparée exactement : rien de l'URL n'est recopié dans la page.
  accountCreated: url.searchParams.get('inscription') === '1'
});

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = form.get('email');

    const result = await login(
      getDb(),
      { email, password: form.get('password') },
      { previousSessionToken: cookies.get(SESSION_COOKIE_NAME) }
    );

    if (!result.ok) {
      // Même message qu'un compte existe ou non ; le mot de passe n'est jamais renvoyé.
      const echoedEmail = typeof email === 'string' ? email.trim() : '';
      if (result.reason === 'locked') {
        return fail(429, { email: echoedEmail, message: lockoutMessage(result.lockedUntil) });
      }
      return fail(400, { email: echoedEmail, message: LOGIN_FAILED_MESSAGE });
    }

    // Remplace tout cookie de session préexistant par le nouveau jeton.
    setSessionCookie(cookies, result.session.token);
    // Destinations fixes : aucun paramètre de redirection n'est accepté.
    redirect(303, result.user.role === 'bookseller' ? '/libraire/retours' : '/');
  }
};
