import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestRefusal } from './http-error.js';

const logger = new Logger('RefusalFilter');

/**
 * Journalise une panne et rend l'occurrence sous laquelle la retrouver.
 *
 * **Une erreur non cartographiée ne laissait AUCUNE trace.** Le filtre
 * l'attrapait, rendait « erreur interne », et le message d'origine disparaissait
 * — mesuré, pas supposé. Un incident en production était donc invisible, ce qui
 * est plus grave que le constat qui a mené ici.
 *
 * L'identifiant est rendu à l'appelant dans `instance` et écrit dans le journal :
 * c'est ce qui permet à quelqu'un qui reçoit un 500 de dire lequel, et à
 * l'exploitant de le retrouver. Rendu SANS le message, qui ne sort jamais.
 *
 * @param cause - l'erreur qui n'a pas été reconnue
 * @returns l'identifiant d'occurrence
 */
export function reportIncident(cause: unknown): string {
  const occurrence = randomUUID();
  logger.error(
    `incident ${occurrence}`,
    cause instanceof Error ? cause.stack : String(cause),
  );
  return occurrence;
}

/**
 * Le `instance` d'un problème.
 *
 * Les refus métier gardent le chemin NU, et c'est délibéré : un identifiant
 * d'occurrence sur un 409 promettrait une entrée de journal qui n'existe pas.
 * Une promesse non tenue dans un contrat est pire que son absence, parce qu'on
 * la suit. Seul un incident en a une.
 *
 * @param url - le chemin appelé
 * @param occurrence - l'identifiant, s'il y a eu incident
 * @returns l'URI de l'occurrence
 */
export function instanceOf(url: string, occurrence: string | null): string {
  return occurrence === null ? url : `${url}#${occurrence}`;
}

/**
 * Le refus rendu pour une panne interne.
 *
 * @returns le refus, sans rien du message d'origine
 */
export function internalRefusal(): NestRefusal {
  return { name: 'InternalError', detail: 'erreur interne' };
}
