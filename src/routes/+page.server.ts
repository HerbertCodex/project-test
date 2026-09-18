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
import { runRetentionPurges } from '$lib/server/retention';
import type { Actions, PageServerLoad } from './$types';

/**
 * Catalogue public, quel que soit le visiteur : id, titre, auteur, statut de prêt,
 * prix et état de vente, jamais de stock chiffré. Les filtres GET sont validés et
 * normalisés par le module catalogue ; seules leurs valeurs retenues sont renvoyées.
 * Sans URL (appel direct du load, par exemple depuis un test), aucun filtre n'est appliqué.
 */
export const load: PageServerLoad = ({ url }) => {
  const filters = catalogueFiltersFromSearchParams(url?.searchParams ?? new URLSearchParams());
  return {
    books: listCatalogue(getDb(), filters),
    filters,
    searchMaxLength: BOOK_TEXT_MAX_LENGTH
  };
};

/**
 * Relance les purges de rétention après un emprunt enregistré.
 *
 * Le prêt est déjà écrit quand la purge s'exécute : un échec de purge ne doit pas
 * transformer un emprunt réussi en erreur, la purge étant retentée au prochain
 * emprunt, au prochain retour ou au démarrage suivant. L'erreur est donc contenue
 * et signalée par un message générique, sans SQL ni pile.
 */
function purgeAfterBorrow(): void {
  try {
    runRetentionPurges(getDb());
  } catch {
    console.error("Purges de rétention : échec après un emprunt, la base n'a pas été purgée.");
  }
}

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
    purgeAfterBorrow();

    return { borrowed: { title: result.loan.title, dueOn: loanDate(result.loan.dueOn) } };
  }
};
