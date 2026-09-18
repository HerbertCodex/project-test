import { getDb } from '$lib/server/db';
import {
  listBorrowerActiveLoans,
  listBorrowerReturnedLoans,
  requireBorrower
} from '$lib/server/loans';
import type { PageServerLoad } from './$types';

/**
 * Prêts de l'emprunteur connecté. L'utilisateur vient uniquement de la
 * session ; la pagination de cet écran (paramètres d'URL, position affichée)
 * reste à faire, chaque liste est donc chargée sur sa première page.
 */
export const load: PageServerLoad = ({ locals }) => {
  const borrower = requireBorrower(locals.user);
  const db = getDb();
  return {
    active: listBorrowerActiveLoans(db, borrower.id, 1).items,
    returned: listBorrowerReturnedLoans(db, borrower.id, 1).items
  };
};
