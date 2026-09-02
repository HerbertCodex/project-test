import { ApiProperty } from '@nestjs/swagger';

/**
 * Un refus, tel que la documentation le décrit.
 */
class ApiErrorView {
  /** Le nom du refus, sur lequel un client branche. */
  @ApiProperty({ description: 'Le nom du refus', example: 'CopyAlreadyOnLoan' })
  code: string = '';

  /** Ce qui s'est passé, en clair. */
  @ApiProperty({ description: 'Ce qui s est passé, en clair' })
  message: string = '';

  /** Les champs à reprendre, pour les seules erreurs de saisie. */
  @ApiProperty({
    description: 'Les champs à reprendre, sur une erreur de saisie',
    required: false,
    type: [String],
  })
  fields?: string[];
}

/**
 * L'enveloppe d'erreur, identique pour tous les statuts 4xx et 5xx.
 *
 * Une seule classe pour tous les refus : c'est ce qui rend vraie la promesse de
 * la décision 0008 dans la documentation elle-même. Deux schémas décrivant deux
 * formes d'erreur diraient au lecteur qu'il doit en distinguer deux.
 */
export class ErrorEnvelopeView {
  /** Le refus. */
  @ApiProperty({ description: 'Le refus', type: ApiErrorView })
  error: ApiErrorView = new ApiErrorView();
}
