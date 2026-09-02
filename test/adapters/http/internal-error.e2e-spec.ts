import { Controller, Logger, Module, Post } from '@nestjs/common';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { startFrom } from '../../support/app.js';

const MARQUEUR = 'chaine-reconnaissable-qui-ne-doit-jamais-sortir';

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
    throw new Error(MARQUEUR);
  }
}

@Module({ controllers: [FaultyRoute] })
class FaultyModule {}

/**
 * Exécute un appel en captant ce que le journal reçoit.
 *
 * Partagé parce que `duplication` a refusé la troisième copie de l'espion. Le
 * `finally` compte : un test qui échoue laisserait sinon l'espion en place et
 * ferait mentir le suivant.
 *
 * @param work - l'appel à faire
 * @returns son résultat et ce qui a été journalisé
 */
async function whileCapturingErrors<Result>(
  work: () => Promise<Result>,
): Promise<[Result, string]> {
  const logged: string[] = [];
  const spy = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(' '));
    });
  try {
    return [await work(), logged.join('\n')];
  } finally {
    spy.mockRestore();
  }
}

describe('Une panne interne', () => {
  let app: INestApplication<Server>;

  beforeEach(async () => {
    app = await startFrom(FaultyModule);
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * Provoque la panne, l'espion en place.
   *
   * @returns la réponse et ce qui a été journalisé
   */
  const fail = async (): Promise<[request.Response, string]> =>
    whileCapturingErrors(() =>
      request(app.getHttpServer()).post('/panne').expect(500),
    );

  it('sort en 500 sous la forme d un probleme, comme tout le reste', async () => {
    const [failed] = await fail();

    expect(failed.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(failed.body.type).toBe('/problems/internal-error');
    expect(failed.body.title).toBe('InternalError');
    expect(failed.body.status).toBe(500);
    expect(failed.body.detail).toBe('erreur interne');
  });

  it('ne laisse RIEN filtrer du message interne, nulle part dans la reponse', async () => {
    const [failed] = await fail();
    expect(JSON.stringify(failed.body)).not.toContain(MARQUEUR);
    expect(JSON.stringify(failed.headers)).not.toContain(MARQUEUR);
  });

  it('JOURNALISE l erreur reelle, qui disparaissait sans trace', async () => {
    const [, logged] = await fail();
    expect(logged).toContain(MARQUEUR);
  });

  it('partage un identifiant d occurrence entre le journal et instance', async () => {
    const [failed, logged] = await fail();
    const occurrence = String(failed.body.instance).split('#')[1];
    expect(occurrence).toBeTruthy();
    expect(logged).toContain(occurrence);
  });

  it('donne deux instance DIFFERENTS a deux pannes, sinon rien n est retrouvable', async () => {
    const [first] = await fail();
    const [second] = await fail();
    expect(first.body.instance).not.toBe(second.body.instance);
  });
});
