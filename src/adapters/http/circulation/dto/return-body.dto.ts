import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Ce qu'un retour demande.
 *
 * Même règle que pour l'emprunt : une seule déclaration par champ, lue par le
 * validateur comme par la documentation, et une valeur initiale plutôt qu'une
 * affirmation, pour la raison écrite sur `BorrowBody`.
 */
export class ReturnBody {
  /** L'exemplaire rendu. */
  @ApiProperty({ description: "L'exemplaire rendu", example: 'c1' })
  @IsString()
  @IsNotEmpty()
  copyId: string = '';
}
