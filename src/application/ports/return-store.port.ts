import type { Loan } from '../../domain/loan.js';

/**
 * Ce que le retour a besoin de lire et d'écrire, et rien de plus.
 *
 * Trois méthodes : trouver le prêt ouvert, le fermer, constater la dette.
 * Aucun moyen de paiement n'y figure, et c'est la décision 2 de l'opérateur
 * rendue structurelle — on ne peut pas encaisser à travers ce port, quelle que
 * soit l'implémentation.
 */
export interface ReturnStore {
  /**
   * Le prêt ouvert qui porte sur un exemplaire.
   *
   * L'invariant du domaine garantit qu'il n'y en a jamais deux, ce qui est
   * pourquoi ce port rend un prêt et non une liste.
   *
   * @param copyId - l'exemplaire rendu
   * @returns le prêt ouvert, ou null si l'exemplaire n'est pas sorti
   */
  openLoanOfCopy(copyId: string): Promise<Loan | null>;

  /**
   * Ferme un prêt rendu.
   *
   * @param loan - le prêt, portant sa date de retour
   */
  closeLoan(loan: Loan): Promise<void>;

  /**
   * Ajoute au solde dû par un adhérent. Le système constate, il n'encaisse pas.
   *
   * @param memberId - l'adhérent qui doit
   * @param amount - le montant à ajouter au solde
   */
  addDebt(memberId: string, amount: number): Promise<void>;
}
