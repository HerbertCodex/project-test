import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Ce qu'un emprunt demande.
 *
 * Les contraintes sont DÉCLARÉES une seule fois : `class-validator` les
 * applique à l'exécution et Swagger les lit du même endroit. Deux déclarations
 * pour un même champ finiraient par diverger, et c'est la documentation qui
 * mentirait — celle que personne ne relit. Le test qui garde cet accord lit les
 * deux sources, parce qu'une version antérieure comparait le document à une
 * liste écrite à la main et restait verte sur une vraie divergence.
 *
 * Elles sont DÉCLARÉES plutôt que vérifiées à la main. C'est la voie
 * idiomatique de NestJS, et la version précédente l'évitait pour ne pas avoir
 * à demander une dépendance — un contournement silencieux que l'opérateur a
 * relevé en relisant le diff, ce qui est exactement le moment où il ne fallait
 * pas qu'il le découvre.
 */
export class BorrowBody {
  /** L'exemplaire qu'on veut prêter. */
  @ApiProperty({ description: "L'exemplaire qu'on veut prêter", example: 'c1' })
  @IsString()
  @IsNotEmpty()
  copyId: string;

  /** L'adhérent qui l'emprunte. */
  @ApiProperty({ description: "L'adhérent qui l'emprunte", example: 'm1' })
  @IsString()
  @IsNotEmpty()
  memberId: string;
}
