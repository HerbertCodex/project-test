import { applyDecorators } from '@nestjs/common';
import { ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorEnvelopeView } from './error-envelope.view.js';
import { REFUSAL_STATUS, type RefusalName } from './refusal-map.js';

/**
 * Documente les refus qu'une route peut réellement produire.
 *
 * Les codes sont LUS dans la table de correspondance, jamais recopiés. C'est
 * ce qui empêche la documentation de mentir : renommer un refus ou changer son
 * code met à jour la page sans que personne y pense, et un refus qu'on
 * documenterait sans qu'il existe ne compilerait pas — `RefusalName` l'interdit.
 *
 * Une documentation fausse est pire qu'absente, parce qu'elle est suivie : un
 * client écrit contre un 403 qui n'arrive jamais traite un cas qui n'existe
 * pas et rate celui qui existe.
 *
 * Tous les statuts renvoient au MÊME schéma d'enveloppe. Deux schémas d'erreur
 * diraient au lecteur qu'il doit distinguer deux formes, ce que la décision
 * 0008 existe précisément pour lui épargner.
 *
 * @param refusals - les refus que la route peut lever
 * @returns le décorateur composé à poser sur la méthode
 */
export function ApiRefusals(...refusals: RefusalName[]): MethodDecorator {
  const byStatus = new Map<number, RefusalName[]>();
  for (const refusal of refusals) {
    const status = REFUSAL_STATUS[refusal];
    byStatus.set(status, [...(byStatus.get(status) ?? []), refusal]);
  }
  return applyDecorators(
    ...[...byStatus].map(([status, names]) =>
      ApiResponse({
        status,
        description: names.join(', '),
        schema: { $ref: getSchemaPath(ErrorEnvelopeView) },
      }),
    ),
  );
}
