import { ApiProperty } from '@nestjs/swagger';

/**
 * Ce qu'un prêt rend au guichet.
 *
 * Rangé sous `views/` et non sous `dto/`, et ce n'est pas un rangement de
 * confort : les corps de requête portent des contraintes que le validateur
 * applique, et un test refuse un fichier de `dto/` qui n'en déclare pas. Une
 * réponse n'a rien à valider — elle est décrite, pas vérifiée. Les mélanger
 * viderait cette règle de son sens.
 */
export class LoanView {
  /** L'exemplaire concerné. */
  @ApiProperty({ description: "L'exemplaire concerné", example: 'c1' })
  copyId: string = '';

  /** L'adhérent concerné. */
  @ApiProperty({ description: "L'adhérent concerné", example: 'm1' })
  memberId: string = '';

  /** L'échéance du prêt. */
  @ApiProperty({
    description: "L'échéance du prêt",
    example: '2026-09-25T00:00:00.000Z',
  })
  dueAt: string = '';
}
