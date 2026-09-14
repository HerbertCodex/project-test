import { fail } from '@sveltejs/kit';
import { requireBookseller } from '$lib/server/catalogue';
import { getDb } from '$lib/server/db';
import {
  LOAN_NOT_RETURNABLE_MESSAGE,
  listActiveLoans,
  parseRecordId,
  recordReturn
} from '$lib/server/loans';
import type { Actions, PageServerLoad } from './$types';

/** Prêts en cours, retards en tête. Contrôle refait ici en plus du layout /libraire. */
export const load: PageServerLoad = ({ locals }) => {
  requireBookseller(locals.user);
  return { loans: listActiveLoans(getDb()) };
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

    return { returned: { title: result.loan.title, borrowerName: result.loan.borrowerName } };
  }
};
