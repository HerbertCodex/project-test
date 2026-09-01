/**
 * Ce que la bibliothèque a besoin de dire à un adhérent quand sa réservation
 * devient disponible.
 *
 * Le vocabulaire est celui du métier : qui, quel titre, quel exemplaire mis de
 * côté, et jusqu'à quand. Rien sur le canal — ni adresse, ni sujet, ni gabarit.
 */
export interface HoldAvailableNotice {
  /** L'adhérent qui était en tête de file. */
  memberId: string;
  /** Le titre réservé. */
  titleId: string;
  /** L'exemplaire mis de côté nominativement pour lui. */
  copyId: string;
  /** Date limite de retrait, au-delà de laquelle la réservation expire. */
  pickupBy: Date;
}

/**
 * Le port sortant de notification.
 *
 * C'est le seul adaptateur de cette spec, et il porte à lui seul le
 * remboursement de l'architecture hexagonale : la règle « prévenir le suivant
 * de la file » est du domaine, le canal par lequel on prévient ne l'est pas.
 *
 * **Contrat : une implémentation ne lève jamais.** Un envoi qui échoue ne doit
 * pas faire échouer le retour qui l'a déclenché — ce serait un refus venant de
 * la technique, alors que ce produit ne refuse que pour des raisons métier.
 * `forgiving` garantit ce contrat pour une implémentation qui ne le tient pas.
 */
export interface NotificationSender {
  /**
   * Prévient l'adhérent que sa réservation l'attend.
   *
   * @param notice - qui prévenir, pour quel titre, et jusqu'à quand
   * @returns une promesse qui aboutit toujours
   */
  holdAvailable(notice: HoldAvailableNotice): Promise<void>;
}
