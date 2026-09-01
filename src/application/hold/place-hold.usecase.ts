import { Hold } from '../../domain/hold.js';
import type { HoldStore } from '../ports/hold-store.port.js';
import type { HoldPolicy } from '../ports/loan-policy.port.js';

/**
 * Refus : l'adhérent a déjà un exemplaire de ce titre entre les mains.
 *
 * Se mettre dans la file pour un livre qu'on détient reviendrait à attendre
 * derrière soi-même, et bloquerait une place pour quelqu'un qui l'attend.
 */
export class AlreadyHoldsACopy extends Error {
  /**
   * @param memberId - l'adhérent concerné
   * @param titleId - le titre qu'il détient déjà
   */
  constructor(memberId: string, titleId: string) {
    super(`${memberId} detient deja un exemplaire de ${titleId}`);
    this.name = 'AlreadyHoldsACopy';
  }
}

/**
 * Refus : l'adhérent a déjà autant de réservations que le règlement l'autorise.
 */
export class HoldCeilingReached extends Error {
  /**
   * @param memberId - l'adhérent concerné
   * @param ceiling - le plafond configuré
   */
  constructor(memberId: string, ceiling: number) {
    super(`${memberId} a deja ${ceiling} reservations, le maximum autorise`);
    this.name = 'HoldCeilingReached';
  }
}

/**
 * Refus : les impayés suspendent aussi le droit de réserver.
 */
export class BlockedByDebtForHold extends Error {
  /**
   * @param memberId - l'adhérent concerné
   * @param threshold - le seuil configuré
   */
  constructor(memberId: string, threshold: number) {
    super(`${memberId} doit plus de ${threshold} et ne peut plus reserver`);
    this.name = 'BlockedByDebtForHold';
  }
}

/**
 * Refus : le titre est sur l'étagère, il n'y a rien à attendre.
 */
export class NothingToReserve extends Error {
  /**
   * @param titleId - le titre disponible
   * @param available - le nombre d'exemplaires empruntables
   */
  constructor(titleId: string, available: number) {
    super(
      `${available} exemplaire(s) de ${titleId} sont disponibles, il n y a rien a reserver`,
    );
    this.name = 'NothingToReserve';
  }
}

/**
 * Refus : l'adhérent n'existe pas.
 */
export class UnknownMember extends Error {
  /**
   * @param memberId - l'identifiant introuvable
   */
  constructor(memberId: string) {
    super(`adherent introuvable : ${memberId}`);
    this.name = 'UnknownMember';
  }
}

/**
 * Ce qu'une réservation demande.
 */
export interface PlaceHoldRequest {
  /** Le titre réservé. On réserve un titre, jamais un exemplaire. */
  titleId: string;
  /** L'adhérent qui se met dans la file. */
  memberId: string;
  /** La date de dépôt, qui décide de son rang. */
  now: Date;
}

/**
 * Poser une réservation sur un titre, ou refuser en disant pourquoi.
 */
export class PlaceHoldUseCase {
  /**
   * @param store - le port de réservation
   * @param policy - le plafond de réservations et le seuil d'impayés
   */
  constructor(
    private readonly store: HoldStore,
    private readonly policy: HoldPolicy,
  ) {}

  /**
   * Exécute la réservation.
   *
   * @param request - le titre, l'adhérent et la date
   * @returns la réservation posée, en attente
   * @throws {UnknownMember} si l'adhérent n'existe pas
   * @throws {BlockedByDebtForHold} si les impayés dépassent le seuil
   * @throws {AlreadyHoldsACopy} s'il détient déjà un exemplaire du titre
   * @throws {HoldCeilingReached} si son plafond de réservations est atteint
   * @throws {NothingToReserve} si le titre est disponible
   */
  async execute(request: PlaceHoldRequest): Promise<Hold> {
    const { titleId, memberId, now } = request;
    const member = await this.store.memberById(memberId);
    if (member === null) throw new UnknownMember(memberId);
    if (member.isBlockedByDebt(this.policy.debtBlockThreshold)) {
      throw new BlockedByDebtForHold(memberId, this.policy.debtBlockThreshold);
    }
    if (await this.store.memberHoldsCopyOf(memberId, titleId)) {
      throw new AlreadyHoldsACopy(memberId, titleId);
    }
    const own = await this.store.holdsOfMember(memberId);
    if (own.length >= this.policy.holdCeiling) {
      throw new HoldCeilingReached(memberId, this.policy.holdCeiling);
    }
    const available = await this.store.availableCopiesOf(titleId);
    if (available > 0) throw new NothingToReserve(titleId, available);

    const hold = new Hold({ titleId, memberId, placedAt: now });
    await this.store.save(hold);
    return hold;
  }
}
