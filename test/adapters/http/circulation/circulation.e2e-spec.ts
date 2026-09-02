import { readFileSync } from 'node:fs';
import request from 'supertest';
import { sourcesUnder } from '../../../support/sources.js';
import { runningApp } from '../../../support/circulation-app.js';

/**
 * Construit depuis une chaîne parce que le littéral `/@nestjs\//` contient un
 * `//` que `comment-policy` lit comme un commentaire — c'est la trouvaille F4,
 * rencontrée pour la troisième fois.
 */
const NESTJS_IMPORT = new RegExp('@nestjs/');

describe('Emprunter et rendre par HTTP', () => {
  const app = runningApp();

  it('un emprunt nominal rend le pret cree, pas un accuse vide', async () => {
    const response = await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(201);

    expect(response.body.data).toMatchObject({ copyId: 'c1', memberId: 'm1' });
    expect(response.body.data.dueAt).toBeDefined();
  });

  it('un retour rend la dette constatee', async () => {
    await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' });
    const response = await request(app().getHttpServer())
      .post('/returns')
      .send({ copyId: 'c1' })
      .expect(200);

    expect(response.body.data).toHaveProperty('debt');
    expect(response.body.data).toHaveProperty('setAsideFor');
  });

  it('un exemplaire deja sorti ressort en 409, pas en 500', async () => {
    await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' });
    await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm2' })
      .expect(409);
  });

  it('un adherent bloque pour impayes ressort en 403', async () => {
    await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'endette' })
      .expect(403);
  });

  it('un exemplaire inconnu ressort en 404', async () => {
    await request(app().getHttpServer())
      .post('/loans')
      .send({ copyId: 'inconnu', memberId: 'm1' })
      .expect(404);
  });

  it('une saisie mal formee est refusee AVANT le cas d usage, en nommant le champ', async () => {
    const response = await request(app().getHttpServer())
      .post('/loans')
      .send({ memberId: 'm1' })
      .expect(400);

    expect(JSON.stringify(response.body)).toContain('copyId');
  });

  it('rendre un exemplaire qui n est pas en pret ressort en 409', async () => {
    await request(app().getHttpServer())
      .post('/returns')
      .send({ copyId: 'c1' })
      .expect(409);
  });

  it('ni le domaine ni l application n importent NestJS, hors scaffold', () => {
    const offenders = ['src/domain', 'src/application']
      .flatMap((root) => sourcesUnder(root))
      .filter((path) => NESTJS_IMPORT.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual(['src/application/app.service.ts']);
  });
});
