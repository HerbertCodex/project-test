import request from 'supertest';
import { mountOpenApi } from '../../../src/adapters/http/openapi.js';
import {
  runningApp,
  startCirculationApp,
} from '../../support/circulation-app.js';
import type { Server } from 'node:http';

const PROBLEM = 'application/problem+json';

describe('Les erreurs en Problem Details', () => {
  const app = runningApp();

  it('rend les succes NUS, sans enveloppe', async () => {
    const created = await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(201);
    expect(created.body.data).toBeUndefined();
    expect(created.body).toMatchObject({ copyId: 'c1', memberId: 'm1' });

    const returned = await request(app().getHttpServer())
      .post('/returns')
      .send({ copyId: 'c1' })
      .expect(200);
    expect(returned.body.data).toBeUndefined();
    expect(returned.body).toHaveProperty('debt');
  });

  it('rend un refus metier en application/problem+json, avec les cinq champs', async () => {
    await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' });
    const refused = await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm2' })
      .expect(409);

    expect(refused.headers['content-type']).toContain(PROBLEM);
    expect(refused.body.type).toBe('/problems/copy-already-on-loan');
    expect(refused.body.title).toBe('CopyAlreadyOnLoan');
    expect(refused.body.status).toBe(409);
    expect(typeof refused.body.detail).toBe('string');
    expect(refused.body.instance).toBe('/loans');
  });

  it('le status du corps EGALE le statut de la reponse, sur chaque refus', async () => {
    const cases: [object, number][] = [
      [{ copyId: 'c1', memberId: 'fantome' }, 404],
      [{ copyId: 'c1', memberId: 'endette' }, 403],
      [{ copyId: '' }, 400],
    ];
    for (const [body, status] of cases) {
      const refused = await request(app().getHttpServer())
        .post('/loans')
        .send(body)
        .expect(status);
      expect(refused.body.status).toBe(status);
    }
  });

  it('LE CRITERE QUI COMPTE : les deux 404 ont la MEME forme et des type differents', async () => {
    const unknownRoute = await request(app().getHttpServer())
      .post('/pas-une-route')
      .send({})
      .expect(404);
    const unknownMember = await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'fantome' })
      .expect(404);

    for (const problem of [unknownRoute, unknownMember]) {
      expect(problem.headers['content-type']).toContain(PROBLEM);
      expect(Object.keys(problem.body).sort()).toEqual([
        'detail',
        'instance',
        'status',
        'title',
        'type',
      ]);
    }
    expect(unknownRoute.body.type).toBe('/problems/route-not-found');
    expect(unknownMember.body.type).toBe('/problems/unknown-party');
  });

  it('nomme les champs a reprendre sur une erreur de saisie', async () => {
    const invalid = await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: '' })
      .expect(400);

    expect(invalid.body.type).toBe('/problems/validation-failed');
    expect(invalid.body.fields.sort()).toEqual(['copyId', 'memberId']);
  });

  it('n applique rien de tout ca au document OpenAPI', async () => {
    process.env.OPENAPI = '1';
    const documented = await startCirculationApp(mountOpenApi);
    try {
      const document = await request(documented.getHttpServer() as Server)
        .get('/docs-json')
        .expect(200);
      expect(document.body.openapi).toBeDefined();
      expect(document.body.paths).toBeDefined();
      expect(document.body.data).toBeUndefined();
    } finally {
      await documented.close();
      delete process.env.OPENAPI;
    }
  });
});
