/**
 * Un adhérent : un porteur de droits, que ses dettes suspendent.
 *
 * Les seuils ne vivent pas ici. Ils sont passés en argument, parce qu'ils
 * relèvent de la politique de l'établissement et non du domaine — les
 * politiques relevées vont de 5 à 75 emprunts et de 5 à 42 jours de prêt.
 */
export class Member {
  /**
   * @param id - identifiant de l'adhérent
   * @param membershipExpiresAt - échéance de l'adhésion
   * @param outstandingDebt - total dû, amendes et remplacements confondus
   */
  constructor(
    readonly id: string,
    readonly membershipExpiresAt: Date,
    readonly outstandingDebt: number,
  ) {}

  /**
   * Dit si l'adhésion couvre encore la date donnée.
   *
   * @param now - la date à laquelle on interroge l'adhésion
   * @returns true tant que l'échéance n'est pas dépassée
   */
  isMembershipValidAt(now: Date): boolean {
    return now.getTime() <= this.membershipExpiresAt.getTime();
  }

  /**
   * Dit si les impayés dépassent le seuil qui suspend les droits.
   *
   * Le seuil lui-même est refusé à égalité : bloquer un adhérent qui doit
   * exactement le seuil punirait la limite plutôt que son dépassement.
   *
   * @param threshold - seuil configuré au-delà duquel les droits sont suspendus
   * @returns true si la dette dépasse strictement le seuil
   */
  isBlockedByDebt(threshold: number): boolean {
    return this.outstandingDebt > threshold;
  }
}
