import type { Hold } from '../../domain/hold.js';

/**
 * Ce que l'expiration a besoin de lire et d'écrire, et rien de plus.
 *
 * Aucune méthode ne déclenche quoi que ce soit dans le temps : la spec définit
 * la règle, pas l'ordonnanceur qui l'appelle.
 */
export interface ExpireHoldStore {
  /**
   * @returns les réservations qui ont un exemplaire mis de côté
   */
  readyHolds(): Promise<Hold[]>;

  /**
   * @param titleId - le titre interrogé
   * @returns les réservations de ce titre qui attendent encore
   */
  waitingHolds(titleId: string): Promise<Hold[]>;

  /**
   * Marque une réservation comme expirée, sans effacer ce qui précède.
   *
   * @param hold - la réservation non retirée
   */
  markExpired(hold: Hold): Promise<void>;

  /**
   * Met l'exemplaire de côté pour la réservation suivante.
   *
   * @param hold - la réservation servie
   * @param copyId - l'exemplaire qui lui passe
   * @param pickupBy - la nouvelle date limite de retrait
   */
  setAsideForHold(hold: Hold, copyId: string, pickupBy: Date): Promise<void>;

  /**
   * Rend l'exemplaire empruntable, faute de suivant.
   *
   * @param copyId - l'exemplaire libéré
   */
  releaseCopy(copyId: string): Promise<void>;
}
