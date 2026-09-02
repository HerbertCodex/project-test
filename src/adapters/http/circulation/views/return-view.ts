import { ApiProperty } from '@nestjs/swagger';

/**
 * Ce qu'un retour rend au guichet.
 */
export class ReturnView {
  /** La dette constatée à la restitution. */
  @ApiProperty({
    description: 'La dette constatée à la restitution',
    example: 0,
  })
  debt: number = 0;

  /** L'adhérent servi par la file, s'il y en a un. */
  @ApiProperty({
    description: "L'adhérent servi par la file, ou null",
    example: null,
    nullable: true,
    type: String,
  })
  setAsideFor: string | null = null;
}
