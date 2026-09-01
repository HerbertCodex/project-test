import type { Loan } from '../../domain/loan.js';

/**
 * Ce que la bascule en « perdu » a besoin de lire et d'écrire, et rien de plus.
 *
 * Aucune méthode ne déclenche quoi que ce soit dans le temps : la spec définit
 * la règle, pas l'ordonnanceur qui l'appelle. C'est ce qui rend cette bascule
 * exerçable par un test sans attendre quarante-cinq jours.
 */
export interface LossStore {
  /**
   * @returns tous les prêts encore ouverts
   */
  openLoans(): Promise<Loan[]>;

  /**
   * Enregistre un prêt comme perdu.
   *
   * @param loan - le prêt portant sa date de bascule
   */
  markLost(loan: Loan): Promise<void>;

  /**
   * Le coût de remplacement d'un exemplaire.
   *
   * @param copyId - l'exemplaire perdu
   * @returns ce que son remplacement coûte
   */
  replacementCostOf(copyId: string): Promise<number>;

  /**
   * Ajoute une dette de REMPLACEMENT, distincte de l'amende de retard.
   *
   * Les deux sont séparées jusque dans le port : les fusionner rendrait le
   * solde inexplicable à l'adhérent, et un solde inexplicable finit annulé.
   *
   * @param memberId - l'adhérent qui doit
   * @param amount - le coût de remplacement
   */
  addReplacementDebt(memberId: string, amount: number): Promise<void>;
}
