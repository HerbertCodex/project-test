import type { Copy } from '../../domain/copy.js';
import type { Loan } from '../../domain/loan.js';
import type { Member } from '../../domain/member.js';

/**
 * Le port de lecture et d'écriture de la circulation.
 *
 * Il déclare ce dont les cas d'usage ont besoin, pas ce qu'une base de données
 * sait faire : aucune notion de transaction, de requête ni de table. C'est la
 * couche de persistance qui s'y plie, et c'est ce qui permet de la remplacer.
 */
export interface CirculationStore {
  /**
   * @param copyId - l'exemplaire cherché
   * @returns l'exemplaire, ou null s'il n'existe pas
   */
  copyById(copyId: string): Promise<Copy | null>;

  /**
   * @param memberId - l'adhérent cherché
   * @returns l'adhérent, ou null s'il n'existe pas
   */
  memberById(memberId: string): Promise<Member | null>;

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
