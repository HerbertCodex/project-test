import type { Hold } from '../../domain/hold.js';
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

  /**
   * Le titre dont un exemplaire est un exemplaire.
   *
   * Nécessaire parce qu'on réserve un TITRE : c'est lui qui porte la file, pas
   * l'exemplaire qu'on vient de rendre.
   *
   * @param copyId - l'exemplaire rendu
   * @returns l'identifiant de son titre
   */
  titleOfCopy(copyId: string): Promise<string>;

  /**
   * Les réservations d'un titre qui attendent encore.
   *
   * @param titleId - le titre interrogé
   * @returns les réservations en attente, ordre indifférent — le domaine trie
   */
  waitingHolds(titleId: string): Promise<Hold[]>;

  /**
   * Met un exemplaire de côté pour une réservation.
   *
   * @param hold - la réservation servie
   * @param copyId - l'exemplaire qui lui est affecté
   * @param pickupBy - la date limite de retrait
   */
  setAsideForHold(hold: Hold, copyId: string, pickupBy: Date): Promise<void>;

  /**
   * Solde la dette de remplacement d'un adhérent dont l'exemplaire revient.
   *
   * Elle est soldée SEULE : l'amende de retard reste due, parce que le
   * document a bien été rendu tard. Les fusionner ici annulerait par la porte
   * de derrière la distinction que i-6k29 a établie.
   *
   * @param memberId - l'adhérent dont l'exemplaire est revenu
   */
  clearReplacementDebt(memberId: string): Promise<void>;
}
