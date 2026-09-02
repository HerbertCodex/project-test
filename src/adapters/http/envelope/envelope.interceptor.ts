import { Injectable } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import type { Envelope } from './envelope.js';

/**
 * Enveloppe toute réponse réussie sous `data`.
 *
 * Posé au composition root et non sur un module : une route ajoutée demain est
 * enveloppée parce qu'elle existe, pas parce que quelqu'un a pensé à le
 * demander. C'est le pendant, côté succès, de `RefusalFilter`.
 *
 * La page OpenAPI n'est pas concernée : Swagger enregistre ses routes
 * directement sur le serveur HTTP, hors de la chaîne d'intercepteurs de Nest.
 * Ce n'est pas une supposition — un test le vérifie, parce qu'une enveloppe
 * autour d'un document OpenAPI donnerait une page qu'aucun outil ne sait lire.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  /**
   * @param _context - le contexte de la requête, inutilisé
   * @param next - la suite de la chaîne
   * @returns la réponse enveloppée
   */
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<Envelope<unknown>> {
    return next.handle().pipe(map((data: unknown) => ({ data })));
  }
}
