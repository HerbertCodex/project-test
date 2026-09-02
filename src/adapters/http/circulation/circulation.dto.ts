import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Ce qu'un emprunt demande.
 *
 * Les contraintes sont DÉCLARÉES plutôt que vérifiées à la main. C'est la voie
 * idiomatique de NestJS, et la version précédente l'évitait pour ne pas avoir
 * à demander une dépendance — un contournement silencieux que l'opérateur a
 * relevé en relisant le diff, ce qui est exactement le moment où il ne fallait
 * pas qu'il le découvre.
 */
export class BorrowBody {
  /** L'exemplaire qu'on veut prêter. */
  @IsString()
  @IsNotEmpty()
  copyId!: string;

  /** L'adhérent qui l'emprunte. */
  @IsString()
  @IsNotEmpty()
  memberId!: string;
}

/**
 * Ce qu'un retour demande.
 */
export class ReturnBody {
  /** L'exemplaire rendu. */
  @IsString()
  @IsNotEmpty()
  copyId!: string;
}
