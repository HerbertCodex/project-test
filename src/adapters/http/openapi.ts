import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * La description du document OpenAPI.
 *
 * @returns la configuration du document
 */
export function openApiConfig(): Omit<
  ReturnType<DocumentBuilder['build']>,
  'paths'
> {
  return new DocumentBuilder()
    .setTitle('Bibliothèque — circulation')
    .setDescription('Prêt, prolongation, retour et réservation d exemplaires.')
    .setVersion('1')
    .build();
}

/**
 * Monte la page OpenAPI, si l'environnement le demande.
 *
 * **Elle n'est PAS montée par défaut.** Exposer la description complète d'une
 * API en production est une décision : elle nomme chaque route, chaque champ et
 * chaque refus, ce qui est précieux pour un intégrateur et tout autant pour
 * quelqu'un qui cherche une prise. `OPENAPI=1` la sert ; rien ne la sert sans.
 *
 * @param app - l'application à documenter
 */
export function mountOpenApi(app: INestApplication): void {
  if (process.env.OPENAPI !== '1') return;
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, openApiConfig()),
  );
}
