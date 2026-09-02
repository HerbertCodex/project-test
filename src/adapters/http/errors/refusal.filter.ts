import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError, ErrorEnvelope } from '../envelope/envelope.js';
import { statusFor } from './refusal-map.js';
import { apiErrorOf } from './http-error.js';

/**
 * Traduit tout refus en une enveloppe `{error}`, quel qu'en soit l'origine.
 *
 * C'est le seul endroit où un refus du domaine devient un statut. Le domaine ne
 * connaît pas HTTP, et l'inverse — un cas d'usage levant une `HttpException` —
 * est refusé par le test qui interdit `@nestjs/common` dans les couches
 * internes.
 *
 * **Ce qui n'est pas cartographié n'est PAS avalé.** Une erreur inconnue devient
 * un 500, ce qui est juste : c'est une panne de la technique, et la confondre
 * avec un refus du métier ferait chercher une règle là où il y a un incident.
 * La table, elle, ne contient aucun 5xx. Ce qui change avec la décision 0008,
 * c'est seulement la FORME : le 500 sort désormais sous la même enveloppe que
 * le reste, au lieu d'être la quatrième forme que devait connaître un client.
 */
@Catch()
export class RefusalFilter implements ExceptionFilter {
  /**
   * @param exception - ce qui a été levé
   * @param host - le contexte de la requête
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, error] = this.resolve(exception);
    const body: ErrorEnvelope = { error };
    response.status(status).json(body);
  }

  /**
   * Range ce qui a été levé dans un statut et un refus nommé.
   *
   * @param exception - ce qui a été levé
   * @returns le statut et le refus
   */
  private resolve(exception: unknown): [number, ApiError] {
    if (exception instanceof HttpException) {
      return [exception.getStatus(), apiErrorOf(exception)];
    }
    const status = exception instanceof Error ? statusFor(exception) : null;
    if (status === null) {
      return [500, { code: 'InternalError', message: 'erreur interne' }];
    }
    const refusal = exception as Error;
    return [status, { code: refusal.name, message: refusal.message }];
  }
}
