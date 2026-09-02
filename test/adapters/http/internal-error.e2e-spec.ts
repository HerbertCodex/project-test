import { Controller, Logger, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { configureApp } from '../../../src/adapters/http/configure-app.js';

const SECRET = 'chaine-reconnaissable-qui-ne-doit-jamais-sortir';

/**
 * Une route qui tombe en panne pour de bon.
 *
 * Déclarée dans le test et non dans le produit : provoquer une panne demande un
 * chemin qui échoue, et ouvrir un tel chemin dans `src/` serait une porte que
 * rien ne referme. Ce qui est mesuré reste le vrai filtre, posé par le vrai
 * `configureApp` — c'est-à-dire exactement ce que `main.ts` construit.
 */
@Controller()
class FaultyRoute {
  /** @returns rien : elle lève toujours */
  @Post('panne')
  fail(): void {
    throw new Error(SECRET);
  }
}

@Module({ controllers: [FaultyRoute] })
class FaultyModule {}

describe('Une panne interne', () => {
  let app: INestApplication<Server>;

  beforeEach(async () => {
    const built = await Test.createTestingModule({
      imports: [FaultyModule],
    }).compile();
    app = configureApp(built.createNestApplication<INestApplication<Server>>());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sort en 500 sous la forme d un probleme, comme tout le reste', async () => {
    const failed = await request(app.getHttpServer())
      .post('/panne')
      .expect(500);

    expect(failed.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(failed.body.type).toBe('/problems/internal-error');
    expect(failed.body.title).toBe('InternalError');
    expect(failed.body.status).toBe(500);
    expect(failed.body.detail).toBe('erreur interne');
    expect(failed.body.instance).toBeDefined();
  });

  it('ne laisse RIEN filtrer du message interne, nulle part dans la reponse', async () => {
    const failed = await request(app.getHttpServer())
      .post('/panne')
      .expect(500);
    expect(JSON.stringify(failed.body)).not.toContain(SECRET);
    expect(JSON.stringify(failed.headers)).not.toContain(SECRET);
  });

  it('JOURNALISE l erreur reelle, qui aujourd hui disparait sans trace', async () => {
    const logged: string[] = [];
    const spy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => String(arg)).join(' '));
      });

    await request(app.getHttpServer()).post('/panne').expect(500);
    spy.mockRestore();

    expect(logged.join('\n')).toContain(SECRET);
  });

  it('partage un identifiant d occurrence entre le journal et instance', async () => {
    const logged: string[] = [];
    const spy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => String(arg)).join(' '));
      });

    const failed = await request(app.getHttpServer())
      .post('/panne')
      .expect(500);
    spy.mockRestore();

    const occurrence = String(failed.body.instance).split('#')[1];
    expect(occurrence).toBeTruthy();
    expect(logged.join('\n')).toContain(occurrence);
  });

  it('donne deux instance DIFFERENTS a deux pannes, sinon rien n est retrouvable', async () => {
    const spy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const first = await request(app.getHttpServer()).post('/panne').expect(500);
    const second = await request(app.getHttpServer())
      .post('/panne')
      .expect(500);
    spy.mockRestore();

    expect(first.body.instance).not.toBe(second.body.instance);
  });
});
