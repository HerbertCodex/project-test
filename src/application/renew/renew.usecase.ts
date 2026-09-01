import type { Loan } from '../../domain/loan.js';
import type { LoanPolicy } from '../ports/loan-policy.port.js';
import type { RenewStore } from '../ports/renew-store.port.js';

/**
 * Refus : quelqu'un d'autre attend ce titre.
 *
 * C'est la règle la plus constante de toutes les politiques de circulation
 * relevées, et celle qui empêche un emprunteur de bloquer la file
 * indéfiniment en prolongeant sans fin.
 */
export class TitleIsHeldByAnother extends Error {
  /**
   * @param titleId - le titre réservé
   * @param waiting - le nombre d'adhérents qui attendent
   */
  constructor(titleId: string, waiting: number) {
    super(
      `${waiting} adherent(s) attendent ${titleId}, la prolongation est refusee`,
    );
    this.name = 'TitleIsHeldByAnother';
  }
}

/**
 * Refus : le plafond de prolongations est atteint.
 */
export class RenewalLimitReached extends Error {
  /**
   * @param limit - le plafond configuré
   */
  constructor(limit: number) {
    super(`ce pret a deja ete prolonge ${limit} fois, le maximum autorise`);
    this.name = 'RenewalLimitReached';
  }
}

/**
 * Refus : ce prêt n'est plus prolongeable — rendu, ou déclaré perdu.
 */
export class LoanCannotBeRenewed extends Error {
  /**
   * @param copyId - l'exemplaire concerné
   */
  constructor(copyId: string) {
    super(`le pret de ${copyId} est clos ou perdu, il ne se prolonge pas`);
    this.name = 'LoanCannotBeRenewed';
  }
}

/**
 * Refus : les impayés suspendent aussi le droit de prolonger.
 */
export class BlockedByDebtForRenewal extends Error {
  /**
   * @param memberId - l'adhérent concerné
   * @param threshold - le seuil configuré
   */
  constructor(memberId: string, threshold: number) {
    super(`${memberId} doit plus de ${threshold} et ne peut plus prolonger`);
    this.name = 'BlockedByDebtForRenewal';
  }
}

/**
 * Refus : l'exemplaire n'est pas en prêt, ou l'adhérent n'existe pas.
 */
export class NothingToRenew extends Error {
  /**
   * @param what - ce qui manque
   */
  constructor(what: string) {
    super(`rien a prolonger : ${what}`);
    this.name = 'NothingToRenew';
  }
}

/**
 * Ce qu'une prolongation demande.
 */
export interface RenewRequest {
  /** L'exemplaire dont on prolonge le prêt. */
  copyId: string;
  /** L'adhérent qui demande. */
  memberId: string;
  /** La date de la demande, d'où repart l'échéance. */
  now: Date;
}

/**
 * Prolonger un prêt, ou refuser en disant pourquoi.
 *
 * `canBeRenewed` n'est pas redéfini ici : le prédicat vit dans le domaine,
 * posé par l'issue de la perte parce que les deux issues le référençaient. Ce
 * qu'il ne sait pas, en revanche, c'est si quelqu'un attend le titre — ça
 * dépend de la file, que le prêt ne connaît pas, et ça reste ici.
 */
export class RenewUseCase {
  /**
   * @param store - le port de prolongation
   * @param policy - la durée de prêt, le plafond de prolongations et le seuil d'impayés
   */
  constructor(
    private readonly store: RenewStore,
    private readonly policy: LoanPolicy & { readonly renewalLimit: number },
  ) {}

  /**
   * Exécute la prolongation.
   *
   * @param request - l'exemplaire, l'adhérent et la date
   * @returns le prêt prolongé
   * @throws {NothingToRenew} si l'exemplaire n'est pas sorti ou l'adhérent inconnu
   * @throws {LoanCannotBeRenewed} si le prêt est rendu ou perdu
   * @throws {BlockedByDebtForRenewal} si les impayés dépassent le seuil
   * @throws {RenewalLimitReached} si le plafond de prolongations est atteint
   * @throws {TitleIsHeldByAnother} si un autre adhérent attend le titre
   */
  async execute(request: RenewRequest): Promise<Loan> {
    const { copyId, memberId, now } = request;
    const loan = await this.store.openLoanOfCopy(copyId);
    if (loan === null)
      throw new NothingToRenew(`l exemplaire ${copyId} n est pas en pret`);
    if (!loan.canBeRenewed()) throw new LoanCannotBeRenewed(copyId);

    const member = await this.store.memberById(memberId);
    if (member === null) throw new NothingToRenew(`adherent ${memberId}`);
    if (member.isBlockedByDebt(this.policy.debtBlockThreshold)) {
      throw new BlockedByDebtForRenewal(
        memberId,
        this.policy.debtBlockThreshold,
      );
    }
    if (loan.renewals >= this.policy.renewalLimit) {
      throw new RenewalLimitReached(this.policy.renewalLimit);
    }

    const titleId = await this.store.titleOfCopy(copyId);
    const others = (await this.store.waitingHolds(titleId)).filter(
      (hold) => hold.memberId !== memberId,
    );
    if (others.length > 0)
      throw new TitleIsHeldByAnother(titleId, others.length);

    const renewed = loan.renewFrom(now, this.policy.loanPeriodDays);
    await this.store.save(renewed);
    return renewed;
  }
}
