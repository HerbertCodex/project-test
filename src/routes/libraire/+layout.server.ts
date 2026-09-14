import { requireBookseller } from '$lib/server/catalogue';
import type { LayoutServerLoad } from './$types';

/**
 * Garde de rendu de tout /libraire/**. Les actions ne passent pas par ce load :
 * chacune refait le contrôle avec requireBookseller.
 */
export const load: LayoutServerLoad = ({ locals }) => {
  requireBookseller(locals.user);
};
