import { error, fail } from '@sveltejs/kit';
import {
  BOOK_TEXT_MAX_LENGTH,
  catalogueFiltersFromSearchParams,
  listCatalogue
} from '$lib/server/catalogue';
import { getDb } from '$lib/server/db';
import {
  BOOK_NOT_FOUND_MESSAGE,
  BOOK_UNAVAILABLE_MESSAGE,
  BORROWER_ONLY_MESSAGE,
  borrowBook,
  loanDate,
  parseRecordId,
  requireBorrower
} from '$lib/server/loans';
import { parsePageParam } from '$lib/server/pagination';
import { runRetentionPurgesSafely } from '$lib/server/retention';
import type { Actions, PageServerLoad } from './$types';

/**
 * Catalogue public, quel que soit le visiteur : id, titre, auteur, statut de prêt,
 * prix et état de vente, jamais de stock chiffré. Les filtres GET sont validés et
 * normalisés par le module catalogue ; seules leurs valeurs retenues sont renvoyées.
 * Sans URL (appel direct du load, par exemple depuis un test), aucun filtre n'est appliqué.
 * `page` est bornée silencieusement : jamais d'erreur pour une valeur invalide ou hors bornes.
 */
export const load: PageServerLoad = ({ url }) => {
  const searchParams = url?.searchParams ?? new URLSearchParams();
  const filters = catalogueFiltersFromSearchParams(searchParams);
  const page = parsePageParam(searchParams.get('page'));
  const catalogue = listCatalogue(getDb(), filters, page);

  // Filtres à reconduire dans les liens de pagination : tout paramètre déjà
  // présent hors `page`, jamais devinés depuis CATALOGUE_FILTER_PARAMS (non
  // importable côté client).
  const pageQuery = new URLSearchParams(searchParams);
  pageQuery.delete('page');

  return {
    books: catalogue.items,
    page: catalogue.page,
    pageSize: catalogue.pageSize,
    totalItems: catalogue.totalItems,
    totalPages: catalogue.totalPages,
    pageQuery: pageQuery.toString(),
    filters,
    searchMaxLength: BOOK_TEXT_MAX_LENGTH
  };
};

const PURGE_AFTER_BORROW_FAILURE_MESSAGE =
  "Purges de rétention : échec après un emprunt, la base n'a pas été purgée.";

export const actions: Actions = {
  emprunter: async ({ request, locals }) => {
    // Contrôle avant toute lecture : anonyme → /connexion, libraire → 403.
    const borrower = requireBorrower(locals.user);

    const form = await request.formData();
    const bookId = parseRecordId(form.get('bookId'));
    if (bookId === null) {
      return fail(400, { borrowError: BOOK_NOT_FOUND_MESSAGE });
    }

    const result = borrowBook(getDb(), borrower, bookId);
    if (!result.ok) {
      if (result.reason === 'conflict') return fail(409, { borrowError: BOOK_UNAVAILABLE_MESSAGE });
      if (result.reason === 'not-found') return fail(404, { borrowError: BOOK_NOT_FOUND_MESSAGE });
      error(403, BORROWER_ONLY_MESSAGE);
    }

    // Emprunt réussi : occasion de purger, un emprunt refusé ne purge rien.
    runRetentionPurgesSafely(getDb(), PURGE_AFTER_BORROW_FAILURE_MESSAGE);

    return { borrowed: { title: result.loan.title, dueOn: loanDate(result.loan.dueOn) } };
  }
};
