import type { LayoutServerLoad } from './$types';

/** N'expose au navigateur que ce que l'en-tête affiche : ni id ni e-mail. */
export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.user ? { displayName: locals.user.displayName, role: locals.user.role } : null
});
