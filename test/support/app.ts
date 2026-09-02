import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { configureApp } from '../../src/adapters/http/configure-app.js';

/**
 * Démarre une application configurée depuis un module, sans rien doubler.
 *
 * Partagé parce que `duplication` a refusé la seconde copie de cette séquence.
 * Ce qu'elle a de commun compte plus que le module passé : c'est
 * `configureApp` qui est appelé, celui-là même que `main.ts` appelle. Une
 * variante recopiée finirait par configurer autrement que le point d'entrée, et
 * le test vérifierait alors sa propre copie.
 *
 * Elle ne remplace pas `startCirculationApp`, qui double la base par
 * `overrideProvider` : ici rien n'est doublé, et c'est la raison d'être des
 * appelants.
 *
 * @param module - le module racine à monter
 * @returns l'application initialisée
 */
export async function startFrom(
  module: Type,
): Promise<INestApplication<Server>> {
  const built = await Test.createTestingModule({ imports: [module] }).compile();
  const app = configureApp(
    built.createNestApplication<INestApplication<Server>>(),
  );
  await app.init();
  return app;
}
