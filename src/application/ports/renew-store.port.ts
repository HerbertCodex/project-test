import type { Hold } from '../../domain/hold.js';
import type { Loan } from '../../domain/loan.js';
import type { MemberReader } from './member-reader.port.js';

/**
 * Ce que la prolongation a besoin de lire et d'écrire, et rien de plus.
 */
export interface RenewStore extends MemberReader {
  /**
   * @param copyId - l'exemplaire dont on prolonge le prêt
   * @returns le prêt ouvert, ou null s'il n'est pas sorti
   */
  openLoanOfCopy(copyId: string): Promise<Loan | null>;

  /**
   * @param copyId - l'exemplaire concerné
   * @returns l'identifiant de son titre, qui porte la file
   */
  titleOfCopy(copyId: string): Promise<string>;

  /**
   * @param titleId - le titre interrogé
   * @returns les réservations en attente sur ce titre
   */
  waitingHolds(titleId: string): Promise<Hold[]>;

  /**
   * @param loan - le prêt prolongé, à persister
   */
  save(loan: Loan): Promise<void>;
}
