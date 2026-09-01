/**
 * Un exemplaire physique, rattaché à un titre.
 *
 * Il ne porte AUCUN drapeau de disponibilité, et c'est l'invariant central de
 * ce modèle : un booléen se désynchronise en silence, et deux prêts
 * concurrents peuvent le lire libre en même temps. La disponibilité se dérive
 * des prêts — voir `availabilityOf`.
 */
export class Copy {
  /**
   * @param id - identifiant de l'exemplaire
   * @param titleId - le titre dont il est un exemplaire ; c'est le titre qu'on réserve
   */
  constructor(
    readonly id: string,
    readonly titleId: string,
  ) {}
}
