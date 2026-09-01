/**
 * Une réservation : une place dans la file d'attente d'un TITRE.
 *
 * On réserve un titre, jamais un exemplaire. C'est ce qui distingue une file
 * d'attente d'une pré-réservation : n'importe quel exemplaire rendu satisfait
 * la première réservation en attente, et l'adhérent veut le livre, pas
 * celui-là en particulier.
 *
 * Une réservation traverse deux états et un seul sens : elle **attend**, puis
 * un exemplaire lui est **mis de côté** nominativement, avec une date limite
 * de retrait au-delà de laquelle elle expire.
 */
export class Hold {
  readonly titleId: string;
  readonly memberId: string;
  readonly placedAt: Date;
  readonly setAsideCopyId: string | null;
  readonly pickupBy: Date | null;

  /**
   * @param hold - le titre, l'adhérent, la date de dépôt, et la mise de côté éventuelle
   */
  constructor(hold: {
    titleId: string;
    memberId: string;
    placedAt: Date;
    setAsideCopyId?: string | null;
    pickupBy?: Date | null;
  }) {
    this.titleId = hold.titleId;
    this.memberId = hold.memberId;
    this.placedAt = hold.placedAt;
    this.setAsideCopyId = hold.setAsideCopyId ?? null;
    this.pickupBy = hold.pickupBy ?? null;
  }

  /**
   * @returns true tant qu'aucun exemplaire ne lui est mis de côté
   */
  isWaiting(): boolean {
    return this.setAsideCopyId === null;
  }

  /**
   * @returns true dès qu'un exemplaire l'attend au guichet
   */
  isReady(): boolean {
    return this.setAsideCopyId !== null;
  }

  /**
   * Met un exemplaire de côté pour cette réservation.
   *
   * @param copyId - l'exemplaire rendu qui la satisfait
   * @param pickupBy - la date limite de retrait
   * @returns la réservation devenue prête
   */
  setAside(copyId: string, pickupBy: Date): Hold {
    return new Hold({
      titleId: this.titleId,
      memberId: this.memberId,
      placedAt: this.placedAt,
      setAsideCopyId: copyId,
      pickupBy,
    });
  }
}

/**
 * La file d'un titre, dans l'ordre d'arrivée.
 *
 * @param titleId - le titre dont on veut la file
 * @param holds - les réservations connues, tous titres confondus
 * @returns les réservations de ce titre, la plus ancienne d'abord
 */
export function queueFor(titleId: string, holds: readonly Hold[]): Hold[] {
  return holds
    .filter((hold) => hold.titleId === titleId)
    .sort((left, right) => left.placedAt.getTime() - right.placedAt.getTime());
}

/**
 * La première réservation d'un titre qui attend encore.
 *
 * Celles déjà servies sont ignorées : sans ça, un exemplaire rendu serait
 * promis deux fois au même adhérent, et le second resterait bloqué derrière
 * une place qui n'attend plus rien.
 *
 * @param titleId - le titre dont on cherche le suivant
 * @param holds - les réservations connues
 * @returns la première en attente, ou null si personne n'attend
 */
export function firstWaiting(
  titleId: string,
  holds: readonly Hold[],
): Hold | null {
  return queueFor(titleId, holds).find((hold) => hold.isWaiting()) ?? null;
}
