import { SwaggerModule } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { openApiConfig } from '../../src/adapters/http/openapi.js';
import { startCirculationApp } from './circulation-app.js';

/**
 * Construit le document OpenAPI de l'application réelle.
 *
 * Il est CONSTRUIT et non lu depuis un fichier figé : une description
 * enregistrée à côté du code dérive du code, et c'est précisément ce que les
 * tests de cette issue existent pour empêcher.
 *
 * @returns le document, prêt à être interrogé
 */
export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
  const app = await startCirculationApp();
  try {
    return SwaggerModule.createDocument(app, openApiConfig());
  } finally {
    await app.close();
  }
}

/**
 * L'opération POST déclarée pour un chemin.
 *
 * Elle échoue fort si le chemin n'est pas documenté, au lieu de rendre
 * `undefined` : une assertion qui suit ne dirait alors pas ce qui manque.
 *
 * @param document - le document interrogé
 * @param path - le chemin cherché
 * @returns l'opération trouvée
 */
export function postOf(document: OpenAPIObject, path: string): OperationObject {
  const post = document.paths?.[path]?.post;
  if (post == null) throw new Error(`chemin non documenté: ${path}`);
  return post;
}

/**
 * Tous les statuts documentés, à plat.
 *
 * @param document - le document interrogé
 * @returns les couples chemin/statut
 */
export function statusesOf(document: OpenAPIObject): [string, string][] {
  return Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    Object.keys(item.post?.responses ?? {}).map(
      (code) => [path, code] as [string, string],
    ),
  );
}

/**
 * Les propriétés que class-validator exige réellement.
 *
 * Mesurées par le COMPORTEMENT — on lui soumet un corps vide et on regarde ce
 * qu'il refuse — et non lues dans ses métadonnées : `@IsOptional` et `@IsString`
 * y portent le même type, si bien qu'une lecture des métadonnées ne les
 * distinguerait pas et laisserait passer précisément la divergence cherchée.
 *
 * @param Dto - la classe de corps interrogée
 * @returns les noms des propriétés exigées, triés
 */
export async function requiredByValidator(
  Dto: ClassConstructor<object>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(Dto, {}));
  return errors.map((error) => error.property).sort();
}

/**
 * Les propriétés que le document annonce obligatoires.
 *
 * @param document - le document interrogé
 * @param schema - le nom du schéma
 * @returns les noms annoncés, triés
 */
export function requiredByDocument(
  document: OpenAPIObject,
  schema: string,
): string[] {
  const found = document.components?.schemas?.[schema];
  if (found == null) throw new Error(`schéma non documenté: ${schema}`);
  return [...((found as { required?: string[] }).required ?? [])].sort();
}

/**
 * Les propriétés d'un schéma, `$ref` suivi d'un niveau.
 *
 * @param document - le document interrogé
 * @param schema - le schéma ou la référence
 * @returns les noms de ses propriétés, triés
 */
export function propertiesOf(
  document: OpenAPIObject,
  schema: Record<string, unknown> | undefined,
): string[] {
  const reference = schema?.['$ref'];
  const resolved =
    typeof reference === 'string'
      ? (document.components?.schemas?.[reference.split('/').pop() ?? ''] as
          Record<string, unknown> | undefined)
      : schema;
  return Object.keys(
    (resolved?.['properties'] as Record<string, unknown>) ?? {},
  ).sort();
}

/**
 * Le schéma déclaré pour un statut d'une opération.
 *
 * @param document - le document interrogé
 * @param path - le chemin
 * @param code - le statut
 * @returns le schéma déclaré
 */
export function schemaFor(
  document: OpenAPIObject,
  path: string,
  code: string,
): Record<string, unknown> | undefined {
  const response = postOf(document, path).responses?.[code];
  const content = (
    response as { content?: Record<string, { schema?: unknown }> }
  )?.content;
  return content?.['application/json']?.schema as
    Record<string, unknown> | undefined;
}
