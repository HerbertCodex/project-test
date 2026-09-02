import { HttpException } from '@nestjs/common';
import type { ApiError } from '../envelope/envelope.js';

const BY_STATUS = new Map<number, string>([
  [400, 'ValidationFailed'],
  [404, 'RouteNotFound'],
]);

/**
 * Le refus nommé que porte une exception venant de Nest lui-même.
 *
 * Deux sources arrivent ici et il faut les distinguer. La validation de saisie
 * construit déjà son refus complet — voir `configureApp` — et il est repris tel
 * quel. Le reste vient du framework : une URL sans route, essentiellement, et
 * son statut suffit à le nommer.
 *
 * `RouteNotFound` est ce qui répare le défaut fondateur de la décision 0008 :
 * une URL inconnue et un adhérent inconnu rendaient tous deux un 404 sous deux
 * formes différentes. Ils partagent maintenant la forme et se distinguent par
 * le code, ce qui est la seule façon pour un client de brancher sans renifler.
 *
 * @param exception - l'exception levée par Nest
 * @returns le refus, sous la forme de l'enveloppe
 */
export function apiErrorOf(exception: HttpException): ApiError {
  const payload = exception.getResponse();
  if (typeof payload === 'object' && 'code' in payload) {
    return payload as unknown as ApiError;
  }
  const status = exception.getStatus();
  return {
    code: BY_STATUS.get(status) ?? exception.constructor.name,
    message: exception.message,
  };
}
