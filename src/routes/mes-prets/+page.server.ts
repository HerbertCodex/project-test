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
  const searchParams = url?.searchParams ?? new URLSearchParams();
  const pageActifs = parsePageParam(searchParams.get('pageActifs'));
  const pageRendus = parsePageParam(searchParams.get('pageRendus'));
  const activePage = listBorrowerActiveLoans(db, borrower.id, pageActifs);
  const returnedPage = listBorrowerReturnedLoans(db, borrower.id, pageRendus);

  // Chaque pagination reconduit l'autre paramètre de page (pageRendus pour la
  // section active et inversement), sinon changer de page dans une section
  // effacerait silencieusement la page affichée par l'autre (voir Pagination.svelte).
  const activePageQuery = new URLSearchParams(searchParams);
  activePageQuery.delete('pageActifs');
  const returnedPageQuery = new URLSearchParams(searchParams);
  returnedPageQuery.delete('pageRendus');

  return {
    active: activePage.items,
    activeOverdueCount: activePage.overdueCount,
    activePageInfo: {
      page: activePage.page,
      pageSize: activePage.pageSize,
      totalItems: activePage.totalItems,
      totalPages: activePage.totalPages
    },
    activePageQuery: activePageQuery.toString(),
    returned: returnedPage.items,
    returnedPageInfo: {
      page: returnedPage.page,
      pageSize: returnedPage.pageSize,
      totalItems: returnedPage.totalItems,
      totalPages: returnedPage.totalPages
    },
    returnedPageQuery: returnedPageQuery.toString()
  };
};
