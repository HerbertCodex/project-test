import type { Hold } from '../../domain/hold.js';
import type { MemberReader } from './member-reader.port.js';

/**
 * Ce que poser une réservation a besoin de lire et d'écrire, et rien de plus.
 *
 * Un port par cas d'usage, comme `BorrowStore` et `ReturnStore` : la leçon a
 * été payée sur i-fnr6, où un magasin général a cassé le double de test d'un
 * autre cas d'usage dès qu'on l'a étendu.
 */
export interface HoldStore extends MemberReader {
  /**
   * @param titleId - le titre interrogé
   * @returns les réservations de ce titre
   */
  holdsOfTitle(titleId: string): Promise<Hold[]>;

  /**
   * @param memberId - l'adhérent interrogé
   * @returns ses réservations, ce qui donne son compte courant
   */
  holdsOfMember(memberId: string): Promise<Hold[]>;

  /**
   * Dit si l'adhérent détient déjà un exemplaire du titre.
   *
   * @param memberId - l'adhérent interrogé
   * @param titleId - le titre interrogé
   * @returns true s'il en a déjà un en prêt
   */
  memberHoldsCopyOf(memberId: string, titleId: string): Promise<boolean>;

  /**
   * Combien d'exemplaires du titre sont sur l'étagère.
   *
   * @param titleId - le titre interrogé
   * @returns le nombre d'exemplaires empruntables tout de suite
   */
  availableCopiesOf(titleId: string): Promise<number>;

  /**
   * @param hold - la réservation à persister
   */
  save(hold: Hold): Promise<void>;
}
