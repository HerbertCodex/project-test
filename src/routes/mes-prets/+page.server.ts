import { getDb } from '$lib/server/db';
import { listBorrowerLoans, requireBorrower } from '$lib/server/loans';
import type { PageServerLoad } from './$types';

/**
 * Prêts de l'emprunteur connecté. L'utilisateur vient uniquement de la
 * session : aucun paramètre d'URL n'est lu.
 */
export const load: PageServerLoad = ({ locals }) => {
  const borrower = requireBorrower(locals.user);
  return listBorrowerLoans(getDb(), borrower.id);
};
