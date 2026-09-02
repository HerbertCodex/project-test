import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { statusFor } from './refusal-map.js';

/**
 * Traduit un refus métier en code HTTP, et laisse passer le reste.
 *
 * C'est le seul endroit où un refus du domaine devient un statut. Le domaine
 * ne connaît pas HTTP, et l'inverse — un cas d'usage levant une
 * `HttpException` — est refusé par le test qui interdit `@nestjs/common` dans
 * les couches internes.
 *
 * **Ce qui n'est pas cartographié n'est PAS avalé.** Une erreur inconnue
 * ressort telle quelle et devient un 500, ce qui est juste : c'est une panne
 * de la technique, et la confondre avec un refus du métier ferait chercher une
 * règle là où il y a un incident. La table, elle, ne contient aucun 5xx.
 */
@Catch()
export class RefusalFilter implements ExceptionFilter {
  /**
   * @param exception - ce qui a été levé
   * @param host - le contexte de la requête
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const status = exception instanceof Error ? statusFor(exception) : null;
    if (status === null) {
      response.status(500).json({ message: 'erreur interne' });
      return;
    }

    response.status(status).json({
      refusal: (exception as Error).name,
      message: (exception as Error).message,
    });
  }
}
