import type { Loan } from './loan.js';

/**
 * Ce qu'un exemplaire peut être, du point de vue du prêt.
 */
export type Availability = 'available' | 'on_loan';

/**
 * Refus : l'exemplaire porte déjà un prêt ouvert.
 *
 * C'est le refus fondateur de ce domaine. Il vient du monde réel — on prête un
 * objet physique — et non d'une contrainte de schéma.
 */
export class CopyAlreadyOnLoan extends Error {
  /**
   * @param copyId - l'exemplaire déjà sorti
   */
  constructor(readonly copyId: string) {
    super(`l'exemplaire ${copyId} porte deja un pret ouvert`);
    this.name = 'CopyAlreadyOnLoan';
  }
}

/**
 * Dérive la disponibilité d'un exemplaire de ses prêts.
 *
 * Aucun état n'est lu ailleurs que dans les prêts eux-mêmes : c'est ce qui
 * rend impossible la désynchronisation qu'un drapeau booléen produit.
 *
 * @param copyId - l'exemplaire interrogé
 * @param loans - les prêts connus, tous exemplaires confondus
 * @returns 'on_loan' si un prêt ouvert le concerne, 'available' sinon
 */
export function availabilityOf(
  copyId: string,
  loans: readonly Loan[],
): Availability {
  const open = loans.some((loan) => loan.copyId === copyId && loan.isOpen());
  return open ? 'on_loan' : 'available';
}

/**
 * Refuse de prêter un exemplaire déjà sorti.
 *
 * @param copyId - l'exemplaire qu'on veut prêter
 * @param loans - les prêts connus
 * @throws {CopyAlreadyOnLoan} si un prêt ouvert porte déjà sur cet exemplaire
 */
export function assertLendable(copyId: string, loans: readonly Loan[]): void {
  if (availabilityOf(copyId, loans) === 'on_loan')
    throw new CopyAlreadyOnLoan(copyId);
}
