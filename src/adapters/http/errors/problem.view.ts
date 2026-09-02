import { ApiProperty } from '@nestjs/swagger';

/**
 * Un problème RFC 9457, tel que la documentation le décrit.
 *
 * Une seule classe pour tous les refus, quel que soit le statut : c'est ce qui
 * rend vraie dans la documentation la promesse de la décision 0009. Deux
 * schémas d'erreur diraient au lecteur qu'il doit distinguer deux formes.
 */
export class ProblemDetailsView {
  /** L'URI qui identifie la catégorie de problème. */
  @ApiProperty({
    description: 'L URI qui identifie la catégorie de problème',
    example: '/problems/copy-already-on-loan',
  })
  type: string = '';

  /** Le libellé stable de la catégorie. */
  @ApiProperty({
    description: 'Le libellé de la catégorie',
    example: 'CopyAlreadyOnLoan',
  })
  title: string = '';

  /** Le statut HTTP, recopié dans le corps. */
  @ApiProperty({
    description: 'Le statut HTTP, recopié dans le corps',
    example: 409,
  })
  status: number = 0;

  /** Ce qui s'est passé pour cette requête. */
  @ApiProperty({ description: 'Ce qui s est passé pour cette requête' })
  detail: string = '';

  /** Le chemin appelé. */
  @ApiProperty({ description: 'Le chemin appelé', example: '/loans' })
  instance: string = '';

  /** Les champs à reprendre, sur une erreur de saisie. */
  @ApiProperty({
    description: 'Les champs à reprendre, sur une erreur de saisie',
    required: false,
    type: [String],
  })
  fields?: string[];
}
