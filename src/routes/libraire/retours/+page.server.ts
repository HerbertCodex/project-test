import { fail } from '@sveltejs/kit';
import { requireBookseller } from '$lib/server/catalogue';
import { getDb } from '$lib/server/db';
import {
  LOAN_NOT_RETURNABLE_MESSAGE,
  listActiveLoans,
  parseRecordId,
  recordReturn
} from '$lib/server/loans';
import { runRetentionPurges } from '$lib/server/retention';
import type { Actions, PageServerLoad } from './$types';

/** Prêts en cours, retards en tête. Contrôle refait ici en plus du layout /libraire. */
export const load: PageServerLoad = ({ locals }) => {
  requireBookseller(locals.user);
  return { loans: listActiveLoans(getDb()).items };
};

/**
 * Relance les purges de rétention après un retour enregistré.
 *
 * Le retour est déjà écrit quand la purge s'exécute : un échec de purge ne doit
 * pas transformer un retour réussi en erreur, la purge étant retentée au prochain
 * retour, au prochain emprunt ou au démarrage suivant. L'erreur est donc contenue
 * et signalée par un message générique, sans SQL ni pile.
 */
function purgeAfterReturn(): void {
  try {
    runRetentionPurges(getDb());
  } catch {
    console.error("Purges de rétention : échec après un retour, la base n'a pas été purgée.");
  }
}

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
    purgeAfterReturn();

    return { returned: { title: result.loan.title, borrowerName: result.loan.borrowerName } };
  }
};
