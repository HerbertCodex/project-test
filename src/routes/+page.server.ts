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
import type { Actions, PageServerLoad } from './$types';

/**
 * Catalogue public, quel que soit le visiteur : id, titre, auteur, statut de prêt,
 * prix et état de vente, jamais de stock chiffré. Les filtres GET sont validés et
 * normalisés par le module catalogue ; seules leurs valeurs retenues sont renvoyées.
 */
export const load: PageServerLoad = ({ url }) => {
  const filters = catalogueFiltersFromSearchParams(url.searchParams);
  return {
    books: listCatalogue(getDb(), filters),
    filters,
    searchMaxLength: BOOK_TEXT_MAX_LENGTH
  };
};

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

    return { borrowed: { title: result.loan.title, dueOn: loanDate(result.loan.dueOn) } };
  }
};
