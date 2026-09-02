import { HttpException } from '@nestjs/common';

const BY_STATUS = new Map<number, string>([
  [400, 'ValidationFailed'],
  [404, 'RouteNotFound'],
]);

/**
 * Ce que porte une exception venant de Nest lui-même.
 *
 * Deux sources arrivent ici et il faut les distinguer. La validation de saisie
 * construit déjà son refus nommé, avec les champs en faute — voir
 * `configureApp` — et il est repris tel quel. Le reste vient du framework : une
 * URL sans route, essentiellement, et son statut suffit à le nommer.
 *
 * `RouteNotFound` est ce qui garde fermé le défaut relevé en 0008 : une URL
 * inconnue et un adhérent inconnu rendaient tous deux un 404 sous deux formes
 * différentes. Ils partagent la forme et se distinguent par `type`, ce qui est
 * la seule façon pour un client de brancher sans renifler.
 */
export interface NestRefusal {
  /** Le nom du refus. */
  name: string;
  /** Ce qui s'est passé. */
  detail: string;
  /** Les champs en faute, sur une erreur de saisie. */
  fields?: string[];
}

/**
 * Range une exception de Nest en refus nommé.
 *
 * @param exception - l'exception levée
 * @returns le refus
 */
export function refusalOf(exception: HttpException): NestRefusal {
  const payload = exception.getResponse();
  if (typeof payload === 'object' && 'code' in payload) {
    const named = payload as {
      code: string;
      message: string;
      fields?: string[];
    };
    return { name: named.code, detail: named.message, fields: named.fields };
  }
  return {
    name: BY_STATUS.get(exception.getStatus()) ?? exception.constructor.name,
    detail: exception.message,
  };
}
