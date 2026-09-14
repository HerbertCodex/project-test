import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME, deleteSession, deleteSessionCookie } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

/** Un GET ne déconnecte jamais : il renvoie simplement au catalogue. */
export const load: PageServerLoad = () => {
  redirect(303, '/');
};

export const actions: Actions = {
  default: ({ cookies }) => {
    deleteSession(getDb(), cookies.get(SESSION_COOKIE_NAME));
    deleteSessionCookie(cookies);
    redirect(303, '/');
  }
};
