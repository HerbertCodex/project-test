import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PROBLEM_JSON, problemTypeOf, type ProblemDetails } from './problem.js';
import { refusalOf, type NestRefusal } from './http-error.js';
import { instanceOf, internalRefusal, reportIncident } from './incident.js';
import { statusFor } from './refusal-map.js';

/**
 * Traduit tout refus en un problème RFC 9457, quelle qu'en soit l'origine.
 *
 * C'est le seul endroit où un refus du domaine devient un statut. Le domaine ne
 * connaît pas HTTP, et l'inverse — un cas d'usage levant une `HttpException` —
 * est refusé par le test qui interdit `@nestjs/common` dans les couches
 * internes.
 *
 * **Ce qui n'est pas cartographié n'est PAS avalé.** Une erreur inconnue devient
 * un 500, ce qui est juste : c'est une panne de la technique, et la confondre
 * avec un refus du métier ferait chercher une règle là où il y a un incident.
 * La table, elle, ne contient aucun 5xx. Ce que la décision 0009 change, c'est
 * la forme : le 500 sort sous le même format que le reste, au lieu d'être une
 * forme de plus à connaître.
 *
 * **Une panne est journalisée, un refus non.** Un refus métier est une issue
 * prévue, pas un incident : le journaliser noierait les vraies pannes sous le
 * bruit des règles qui font leur travail.
 */
@Catch()
export class RefusalFilter implements ExceptionFilter {
  /**
   * @param exception - ce qui a été levé
   * @param host - le contexte de la requête
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const [status, refusal, occurrence] = this.resolve(exception);
    const problem: ProblemDetails = {
      type: problemTypeOf(refusal.name),
      title: refusal.name,
      status,
      detail: refusal.detail,
      instance: instanceOf(http.getRequest<Request>().url, occurrence),
      ...(refusal.fields === undefined ? {} : { fields: refusal.fields }),
    };
    response.status(status).contentType(PROBLEM_JSON).json(problem);
  }

  /**
   * Range ce qui a été levé dans un statut et un refus nommé.
   *
   * @param exception - ce qui a été levé
   * @returns le statut, le refus, et l'occurrence s'il y a eu incident
   */
  private resolve(exception: unknown): [number, NestRefusal, string | null] {
    if (exception instanceof HttpException) {
      return [exception.getStatus(), refusalOf(exception), null];
    }
    const status = exception instanceof Error ? statusFor(exception) : null;
    if (status === null) {
      return [500, internalRefusal(), reportIncident(exception)];
    }
    const refusal = exception as Error;
    return [status, { name: refusal.name, detail: refusal.message }, null];
  }
}
