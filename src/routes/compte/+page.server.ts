import { fail, redirect } from '@sveltejs/kit';
import { deleteOwnAccount } from '$lib/server/account';
import { LOGIN_FAILED_MESSAGE, deleteSessionCookie, type AuthUser } from '$lib/server/auth';
import { LIBRARY_TIME_ZONE } from '$lib/server/dates';
import { getDb } from '$lib/server/db';
import { countActiveLoans } from '$lib/server/loans';
import type { Actions, PageServerLoad } from './$types';

/**
 * Garde de l'écran de compte : comme `requireBorrower`, un visiteur anonyme est
 * renvoyé vers la connexion, mais sans restriction de rôle — emprunteur et
 * libraire administrent le leur par le même parcours.
 */
function requireUser(user: AuthUser | null): AuthUser {
  if (!user) redirect(303, '/connexion');
  return user;
}

// Non exporté : SvelteKit n'accepte de ce module que les exports de route.
const ACTIVE_LOAN_MESSAGE =
  'Vous avez encore un prêt en cours. Rendez vos livres à la librairie avant de supprimer votre compte.';

// Même formateur que /connexion : les deux écrans partagent la fenêtre de
// blocage, donc ils doivent annoncer la même heure de fin, en heure de Paris.
const parisTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: LIBRARY_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23'
});

/** « Trop de tentatives. Réessayez à partir de 14 h 15. » (heure de Paris). */
function lockoutMessage(lockedUntil: number): string {
  const parts = Object.fromEntries(
    parisTime.formatToParts(new Date(lockedUntil)).map((part) => [part.type, part.value])
  );
  return `Trop de tentatives. Réessayez à partir de ${parts.hour} h ${parts.minute}.`;
}

/**
 * Compte de la session : seulement ce que l'écran affiche. Ni e-mail, ni
 * identifiant, ni empreinte de session ne quittent le serveur, et rien n'est lu
 * de l'URL.
 */
export const load: PageServerLoad = ({ locals }) => {
  const user = requireUser(locals.user);
  const activeLoanCount = countActiveLoans(getDb(), user.id);
  return {
    displayName: user.displayName,
    role: user.role,
    activeLoanCount,
    hasActiveLoan: activeLoanCount > 0
  };
};

export const actions: Actions = {
  /**
   * Suppression en libre-service, sur POST uniquement. Le compte traité vient
   * exclusivement de la session : un `userId`, un `email` ou un `role` envoyés
   * par le formulaire ne sont jamais lus.
   */
  supprimer: async ({ request, locals, cookies }) => {
    const user = requireUser(locals.user);

    const form = await request.formData();
    const result = await deleteOwnAccount(getDb(), user, form.get('password'));

    if (!result.ok) {
      // Même forme pour les trois refus : seul `passwordError` change, et le mot
      // de passe saisi n'est jamais renvoyé au client. Un prêt en cours comme un
      // blocage sont annoncés sans marquer le champ, qui n'en est pas la cause.
      if (result.reason === 'active-loan') {
        return fail(409, { message: ACTIVE_LOAN_MESSAGE, passwordError: false });
      }
      if (result.reason === 'locked') {
        return fail(429, { message: lockoutMessage(result.lockedUntil), passwordError: false });
      }
      // Message identique à celui de la connexion, sans compter les essais.
      return fail(400, { message: LOGIN_FAILED_MESSAGE, passwordError: true });
    }

    // Les sessions sont déjà supprimées en base ; le cookie devenu inutile part
    // avec les attributs qui l'ont posé.
    deleteSessionCookie(cookies);
    redirect(303, '/compte/supprime');
  }
};
