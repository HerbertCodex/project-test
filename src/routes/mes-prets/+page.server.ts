import { getDb } from '$lib/server/db';
import {
  listBorrowerActiveLoans,
  listBorrowerReturnedLoans,
  requireBorrower
} from '$lib/server/loans';
import { parsePageParam } from '$lib/server/pagination';
import type { PageServerLoad } from './$types';

/**
 * Prêts de l'emprunteur connecté. L'utilisateur vient uniquement de la
 * session ; les prêts en cours et les prêts rendus sont paginés
 * indépendamment via deux paramètres d'URL distincts.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  const borrower = requireBorrower(locals.user);
  const db = getDb();
  const pageActifs = parsePageParam(url?.searchParams.get('pageActifs') ?? null);
  const pageRendus = parsePageParam(url?.searchParams.get('pageRendus') ?? null);
  const activePage = listBorrowerActiveLoans(db, borrower.id, pageActifs);
  const returnedPage = listBorrowerReturnedLoans(db, borrower.id, pageRendus);
  return {
    active: activePage.items,
    activePageInfo: {
      page: activePage.page,
      pageSize: activePage.pageSize,
      totalItems: activePage.totalItems,
      totalPages: activePage.totalPages
    },
    returned: returnedPage.items,
    returnedPageInfo: {
      page: returnedPage.page,
      pageSize: returnedPage.pageSize,
      totalItems: returnedPage.totalItems,
      totalPages: returnedPage.totalPages
    }
  };
};
