import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { mountOpenApi } from '../../../src/adapters/http/openapi.js';
import { startCirculationApp } from '../../support/circulation-app.js';

describe('L enveloppe de reponse', () => {
  let app: INestApplication<Server>;

  beforeEach(async () => {
    app = await startCirculationApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('enveloppe CHAQUE succes sous data, sur toutes les routes declarees', async () => {
    const created = await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(201);
    expect(Object.keys(created.body)).toEqual(['data']);
    expect(created.body.data).toMatchObject({ copyId: 'c1', memberId: 'm1' });

    const returned = await request(app.getHttpServer())
      .post('/returns')
      .send({ copyId: 'c1' })
      .expect(200);
    expect(Object.keys(returned.body)).toEqual(['data']);
    expect(returned.body.data).toMatchObject({ debt: 0 });
  });

  it('enveloppe un refus metier sous error, avec le nom du refus en code', async () => {
    await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' });
    const refused = await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(409);

    expect(Object.keys(refused.body)).toEqual(['error']);
    expect(refused.body.error.code).toBe('CopyAlreadyOnLoan');
    expect(typeof refused.body.error.message).toBe('string');
  });

  it('enveloppe une erreur de validation, et nomme les champs a reprendre', async () => {
    const invalid = await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: '' })
      .expect(400);

    expect(Object.keys(invalid.body)).toEqual(['error']);
    expect(invalid.body.error.code).toBe('ValidationFailed');
    expect(invalid.body.error.fields.sort()).toEqual(['copyId', 'memberId']);
  });

  it('LE CRITERE QUI COMPTE : les deux 404 ont la MEME forme et des code differents', async () => {
    const unknownRoute = await request(app.getHttpServer())
      .post('/pas-une-route')
      .send({})
      .expect(404);
    const unknownMember = await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'fantome' })
      .expect(404);

    expect(Object.keys(unknownRoute.body)).toEqual(['error']);
    expect(Object.keys(unknownMember.body)).toEqual(['error']);
    expect(unknownRoute.body.error.code).toBe('RouteNotFound');
    expect(unknownMember.body.error.code).toBe('UnknownParty');
    expect(unknownRoute.body.error.code).not.toBe(
      unknownMember.body.error.code,
    );
  });

  it('n enveloppe PAS le document OpenAPI, dont la forme est normalisee', async () => {
    process.env.OPENAPI = '1';
    const documented = await startCirculationApp(mountOpenApi);
    try {
      const document = await request(documented.getHttpServer() as Server)
        .get('/docs-json')
        .expect(200);
      expect(document.body.data).toBeUndefined();
      expect(document.body.openapi).toBeDefined();
      expect(document.body.paths).toBeDefined();
    } finally {
      await documented.close();
      delete process.env.OPENAPI;
    }
  });
});
