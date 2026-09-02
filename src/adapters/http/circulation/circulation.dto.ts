import { BadRequestException } from '@nestjs/common';

/**
 * Vérifie qu'un champ obligatoire est une chaîne non vide.
 *
 * La validation vit à la frontière et nulle part ailleurs : le domaine reçoit
 * des valeurs valides ou rien. Le message nomme le champ, parce qu'un refus
 * que l'appelant ne peut pas corriger ne vaut guère mieux qu'un silence.
 *
 * @param body - le corps reçu
 * @param field - le champ attendu
 * @returns la valeur, garantie non vide
 * @throws {BadRequestException} si le champ manque ou n'est pas une chaîne
 */
export function requiredString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException({
      message: `${field} est obligatoire`,
      field,
    });
  }
  return value;
}
