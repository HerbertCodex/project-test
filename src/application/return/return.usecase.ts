import { firstWaiting } from '../../domain/hold.js';
import { Loan } from '../../domain/loan.js';
import type { HoldPolicy, LoanPolicy } from '../ports/loan-policy.port.js';
import type { NotificationSender } from '../ports/notification-sender.port.js';
import type { ReturnStore } from '../ports/return-store.port.js';

/**
 * Refus : cet exemplaire n'est pas sorti.
 *
 * Ce n'est pas une opération neutre qu'on pourrait ignorer : rendre un
 * exemplaire que personne n'a emprunté est le signe d'une erreur de saisie, et
 * l'avaler laisserait un guichet croire qu'il a rangé un document.
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
 * Ce qu'un retour produit.
 */
export interface ReturnOutcome {
  /** Le prêt, portant désormais sa date de retour. */
  loan: Loan;
  /** La dette de retard constatée, zéro si le retour est dans les temps. */
  debt: number;
  /**
   * L'adhérent pour qui l'exemplaire vient d'être mis de côté, ou null s'il
   * redevient simplement empruntable.
   */
  setAsideFor: string | null;
  /** Vrai si l'exemplaire était déclaré perdu et vient d'être réactivé. */
  reactivated: boolean;
}

/**
 * Rendre un exemplaire, constater ce qui est dû, et servir la file.
 *
 * Le système CONSTATE la dette et ne l'encaisse jamais — décision 2 de
 * l'opérateur, rendue structurelle par `ReturnStore`, dont aucune méthode
 * n'encaisse.
 */
export class ReturnUseCase {
  /**
   * @param store - le port de retour : trouver le prêt, le fermer, constater la dette, servir la file
   * @param policy - le barème de retard et le délai de retrait
   * @param notifier - le port par lequel on prévient le suivant de la file
   */
  constructor(
    private readonly store: ReturnStore,
    private readonly policy: LoanPolicy & HoldPolicy,
    private readonly notifier: NotificationSender,
  ) {}

  /**
   * Exécute le retour.
   *
   * @param request - l'exemplaire rendu et la date du retour
   * Un exemplaire déclaré perdu qui revient est réactivé : sa dette de
   * remplacement est soldée, mais l'amende de retard reste due — le document a
   * bien été rendu tard, et les deux dettes restent distinctes.
   *
   * @returns le prêt fermé, la dette de retard, la réactivation et l'adhérent servi
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

    const reactivated = open.isLost();
    if (reactivated) await this.store.clearReplacementDebt(open.memberId);

    return {
      loan: closed,
      debt,
      reactivated,
      setAsideFor: await this.serveQueue(copyId, now),
    };
  }

  /**
   * Sert la file du titre, si quelqu'un attend.
   *
   * L'exemplaire rendu ne redevient empruntable que si personne n'attend. Sinon
   * il est mis de côté NOMINATIVEMENT pour le premier de la file : sans ça, la
   * file ne serait qu'un souhait et le titre repartirait avec le premier qui
   * passe.
   *
   * La notification part après la mise de côté, et son échec ne peut pas faire
   * échouer le retour — c'est le contrat du port, tenu par `forgiving`.
   *
   * @param copyId - l'exemplaire rendu
   * @param now - la date du retour, d'où court le délai de retrait
   * @returns l'adhérent servi, ou null si personne n'attendait
   */
  private async serveQueue(copyId: string, now: Date): Promise<string | null> {
    const titleId = await this.store.titleOfCopy(copyId);
    const next = firstWaiting(titleId, await this.store.waitingHolds(titleId));
    if (next === null) return null;

    const pickupBy = new Date(
      now.getTime() + this.policy.holdPickupDays * 86_400_000,
    );
    await this.store.setAsideForHold(next, copyId, pickupBy);
    await this.notifier.holdAvailable({
      memberId: next.memberId,
      titleId,
      copyId,
      pickupBy,
    });
    return next.memberId;
  }
}
