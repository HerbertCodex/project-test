import { Loan } from '../../domain/loan.js';
import { assertLendable } from '../../domain/availability.js';
import type { CirculationStore } from '../ports/circulation-store.port.js';
import type { LoanPolicy } from '../ports/loan-policy.port.js';

/**
 * Refus : l'adhésion a expiré.
 */
export class MembershipExpired extends Error {
  /**
   * @param memberId - l'adhérent concerné
   */
  constructor(memberId: string) {
    super(`l adhesion de ${memberId} a expire`);
    this.name = 'MembershipExpired';
  }
}

/**
 * Refus : l'adhérent a déjà autant d'emprunts que le règlement l'autorise.
 */
export class BorrowCeilingReached extends Error {
  /**
   * @param memberId - l'adhérent concerné
   * @param ceiling - le plafond configuré
   */
  constructor(memberId: string, ceiling: number) {
    super(`${memberId} detient deja ${ceiling} emprunts, le maximum autorise`);
    this.name = 'BorrowCeilingReached';
  }
}

/**
 * Refus : les impayés dépassent le seuil qui suspend les droits.
 */
export class BlockedByDebt extends Error {
  /**
   * @param memberId - l'adhérent concerné
   * @param threshold - le seuil configuré
   */
  constructor(memberId: string, threshold: number) {
    super(`${memberId} doit plus de ${threshold} et ne peut plus emprunter`);
    this.name = 'BlockedByDebt';
  }
}

/**
 * Refus : cet exemplaire attend quelqu'un d'autre.
 */
export class CopySetAsideForAnother extends Error {
  /**
   * @param copyId - l'exemplaire mis de côté
   * @param heldFor - l'adhérent pour qui il l'est
   */
  constructor(copyId: string, heldFor: string) {
    super(`l exemplaire ${copyId} est mis de cote pour ${heldFor}`);
    this.name = 'CopySetAsideForAnother';
  }
}

/**
 * Refus : l'exemplaire ou l'adhérent n'existe pas.
 */
export class UnknownParty extends Error {
  /**
   * @param what - ce qui est introuvable
   */
  constructor(what: string) {
    super(`introuvable : ${what}`);
    this.name = 'UnknownParty';
  }
}

/**
 * Ce qu'un emprunt demande. L'échéance n'y figure pas, et c'est délibéré :
 * elle découle de la durée de prêt configurée, jamais d'une saisie.
 */
export interface BorrowRequest {
  /** L'exemplaire qu'on veut prêter. */
  copyId: string;
  /** L'adhérent qui l'emprunte. */
  memberId: string;
  /** La date à laquelle l'opération a lieu. */
  now: Date;
}

/**
 * Prêter un exemplaire, ou refuser en disant pourquoi.
 *
 * Les cinq refus viennent du métier, pas du format. Aucun ne connaît HTTP :
 * c'est l'adaptateur entrant qui traduit `BlockedByDebt` en 403 et
 * `CopyAlreadyOnLoan` en 409. Cette classe n'est pas décorée `@Injectable`
 * pour la même raison — le câblage Nest appartient à l'adaptateur.
 */
export class BorrowUseCase {
  /**
   * @param store - le port de lecture et d'écriture
   * @param policy - les seuils du règlement
   */
  constructor(
    private readonly store: CirculationStore,
    private readonly policy: LoanPolicy,
  ) {}

  /**
   * Exécute l'emprunt.
   *
   * @param request - l'exemplaire, l'adhérent et la date de l'opération
   * @returns le prêt créé
   * @throws {UnknownParty} si l'exemplaire ou l'adhérent n'existe pas
   * @throws {CopyAlreadyOnLoan} si l'exemplaire porte déjà un prêt ouvert
   * @throws {MembershipExpired} si l'adhésion a expiré
   * @throws {BorrowCeilingReached} si le plafond d'emprunts est atteint
   * @throws {BlockedByDebt} si les impayés dépassent le seuil
   * @throws {CopySetAsideForAnother} si l'exemplaire attend un autre adhérent
   */
  async execute(request: BorrowRequest): Promise<Loan> {
    const { copyId, memberId, now } = request;
    const copy = await this.store.copyById(copyId);
    if (copy === null) throw new UnknownParty(`exemplaire ${copyId}`);
    const member = await this.store.memberById(memberId);
    if (member === null) throw new UnknownParty(`adherent ${memberId}`);

    assertLendable(copyId, await this.store.openLoansOfCopy(copyId));

    if (!member.isMembershipValidAt(now)) throw new MembershipExpired(memberId);
    if (member.isBlockedByDebt(this.policy.debtBlockThreshold)) {
      throw new BlockedByDebt(memberId, this.policy.debtBlockThreshold);
    }

    const held = await this.store.openLoansOfMember(memberId);
    if (held.length >= this.policy.borrowCeiling) {
      throw new BorrowCeilingReached(memberId, this.policy.borrowCeiling);
    }

    const setAside = await this.store.setAsideFor(copyId);
    if (setAside !== null && setAside !== memberId) {
      throw new CopySetAsideForAnother(copyId, setAside);
    }

    const loan = new Loan({
      copyId,
      memberId,
      startedAt: now,
      dueAt: new Date(now.getTime() + this.policy.loanPeriodDays * 86_400_000),
    });
    await this.store.save(loan);
    return loan;
  }
}
