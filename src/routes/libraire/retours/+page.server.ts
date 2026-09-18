import { fail } from '@sveltejs/kit';
import { requireBookseller } from '$lib/server/catalogue';
import { getDb } from '$lib/server/db';
import {
  LOAN_NOT_RETURNABLE_MESSAGE,
  listActiveLoans,
  parseRecordId,
  recordReturn
} from '$lib/server/loans';
import { parsePageParam } from '$lib/server/pagination';
import { runRetentionPurgesSafely } from '$lib/server/retention';
import type { Actions, PageServerLoad } from './$types';

const PURGE_FAILURE_MESSAGE =
  "Purges de rétention : échec après un retour, la base n'a pas été purgée.";

/**
 * Une page des prêts en cours, retards en tête. `page` est bornée
 * silencieusement : jamais d'erreur pour une valeur invalide ou hors bornes.
 * Contrôle refait ici en plus du layout /libraire.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  requireBookseller(locals.user);
  const page = parsePageParam(url?.searchParams.get('page') ?? null);
  const loansPage = listActiveLoans(getDb(), page);
  return {
    loans: loansPage.items,
    page: loansPage.page,
    pageSize: loansPage.pageSize,
    totalItems: loansPage.totalItems,
    totalPages: loansPage.totalPages
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    // Le layout /libraire ne protège pas les actions : contrôle avant toute lecture.
    requireBookseller(locals.user);

    const form = await request.formData();
    const loanId = parseRecordId(form.get('loanId'));
    if (loanId === null) {
      return fail(400, { returnError: LOAN_NOT_RETURNABLE_MESSAGE });
    }

    const result = recordReturn(getDb(), loanId);
    if (!result.ok) {
      const status = result.reason === 'not-found' ? 404 : 409;
      return fail(status, { returnError: LOAN_NOT_RETURNABLE_MESSAGE });
    }

    // Retour réussi : occasion de purger, un retour refusé ne purge rien.
    runRetentionPurgesSafely(getDb(), PURGE_FAILURE_MESSAGE);

    return { returned: { title: result.loan.title, borrowerName: result.loan.borrowerName } };
  }
};
