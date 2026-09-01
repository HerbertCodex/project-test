import type { Copy } from '../../domain/copy.js';
import type { Loan } from '../../domain/loan.js';
import type { MemberReader } from './member-reader.port.js';

/**
 * Ce que l'emprunt a besoin de lire et d'écrire, et rien de plus.
 *
 * Un port par cas d'usage plutôt qu'un magasin général : c'est la ségrégation
 * d'interface, et elle a été apprise ici à ses dépens. Un `CirculationStore`
 * unique a d'abord existé ; l'étendre pour le retour a cassé le double de test
 * de l'emprunt, qui devait soudain implémenter trois méthodes dont il n'a que
 * faire. Quatre cas d'usage restaient à écrire, donc quatre ruptures
 * identiques à venir.
 */
export interface BorrowStore extends MemberReader {
  /**
   * @param copyId - l'exemplaire cherché
   * @returns l'exemplaire, ou null s'il n'existe pas
   */
  copyById(copyId: string): Promise<Copy | null>;

  /**
   * @param copyId - l'exemplaire interrogé
   * @returns les prêts ouverts qui le concernent
   */
  openLoansOfCopy(copyId: string): Promise<Loan[]>;

  /**
   * @param memberId - l'adhérent interrogé
   * @returns ses prêts ouverts, ce qui donne son compte courant d'emprunts
   */
  openLoansOfMember(memberId: string): Promise<Loan[]>;

  /**
   * Dit pour qui un exemplaire est mis de côté.
   *
   * @param copyId - l'exemplaire interrogé
   * @returns l'adhérent à qui il est réservé, ou null s'il ne l'est pas
   */
  setAsideFor(copyId: string): Promise<string | null>;

  /**
   * @param loan - le prêt à persister
   */
  save(loan: Loan): Promise<void>;
}
