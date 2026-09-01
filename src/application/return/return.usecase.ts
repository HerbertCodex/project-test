import { Loan } from '../../domain/loan.js';
import type { ReturnStore } from '../ports/return-store.port.js';
import type { LoanPolicy } from '../ports/loan-policy.port.js';

/**
 * Refus : cet exemplaire n'est pas sorti.
 *
 * Ce n'est pas une opération neutre qu'on pourrait ignorer : rendre un
 * exemplaire que personne n'a emprunté est le signe d'une erreur de saisie,
 * et l'avaler laisserait un guichet croire qu'il a rangé un document.
 */
export class CopyNotOnLoan extends Error {
  /**
   * @param copyId - l'exemplaire qu'on tentait de rendre
   */
  constructor(copyId: string) {
    super(`l exemplaire ${copyId} n est pas en pret`);
    this.name = 'CopyNotOnLoan';
  }
}

/**
 * Ce qu'un retour demande.
 */
export interface ReturnRequest {
  /** L'exemplaire rendu. */
  copyId: string;
  /** La date à laquelle il est rendu. */
  now: Date;
}

/**
 * Ce qu'un retour produit : le prêt fermé, et ce qui reste dû.
 */
export interface ReturnOutcome {
  /** Le prêt, portant désormais sa date de retour. */
  loan: Loan;
  /** La dette de retard constatée, zéro si le retour est dans les temps. */
  debt: number;
}

/**
 * Rendre un exemplaire, et constater ce qui est dû.
 *
 * Le système CONSTATE la dette et ne l'encaisse jamais — décision 2 de
 * l'opérateur. Aucun moyen de paiement n'apparaît ici, et un test lit ces
 * sources pour s'en assurer.
 */
export class ReturnUseCase {
  /**
   * @param store - le port de retour : trouver le prêt, le fermer, constater la dette
   * @param policy - le barème de retard
   */
  constructor(
    private readonly store: ReturnStore,
    private readonly policy: LoanPolicy,
  ) {}

  /**
   * Exécute le retour.
   *
   * @param request - l'exemplaire rendu et la date du retour
   * @returns le prêt fermé et la dette constatée
   * @throws {CopyNotOnLoan} si l'exemplaire n'est pas sorti
   */
  async execute(request: ReturnRequest): Promise<ReturnOutcome> {
    const { copyId, now } = request;
    const open = await this.store.openLoanOfCopy(copyId);
    if (open === null) throw new CopyNotOnLoan(copyId);

    const closed = new Loan({
      copyId: open.copyId,
      memberId: open.memberId,
      startedAt: open.startedAt,
      dueAt: open.dueAt,
      returnedAt: now,
    });
    await this.store.closeLoan(closed);

    const debt = open.daysOverdueAt(now) * this.policy.lateFeePerDay;
    if (debt > 0) await this.store.addDebt(open.memberId, debt);

    return { loan: closed, debt };
  }
}
