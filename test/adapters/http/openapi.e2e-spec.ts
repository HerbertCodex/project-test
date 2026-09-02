import request from 'supertest';
import type { Server } from 'node:http';
import { mountOpenApi } from '../../../src/adapters/http/openapi.js';
import { startCirculationApp } from '../../support/circulation-app.js';

/**
 * Sert l'application avec la variable positionnée, et interroge `/docs-json`.
 *
 * Le montage est lu au démarrage : la variable est donc posée AVANT
 * `mountOpenApi` et rendue ensuite, quoi qu'il arrive, pour qu'un test qui
 * échoue ne contamine pas le suivant.
 *
 * @param flag - la valeur d'OPENAPI, ou undefined pour l'absence
 * @returns le statut rendu par la page
 */
async function statusOfDocs(flag: string | undefined): Promise<number> {
  const before = process.env.OPENAPI;
  if (flag == null) delete process.env.OPENAPI;
  else process.env.OPENAPI = flag;
  const app = await startCirculationApp(mountOpenApi);
  try {
    const response = await request(app.getHttpServer() as Server).get(
      '/docs-json',
    );
    return response.status;
  } finally {
    await app.close();
    if (before == null) delete process.env.OPENAPI;
    else process.env.OPENAPI = before;
  }
}

describe('La page de documentation', () => {
  it('est servie quand OPENAPI vaut 1', async () => {
    expect(await statusOfDocs('1')).toBe(200);
  });

  it('n est PAS servie sans la variable', async () => {
    expect(await statusOfDocs(undefined)).toBe(404);
  });

  it('n est pas servie non plus pour une autre valeur', async () => {
    expect(await statusOfDocs('true')).toBe(404);
  });
});
