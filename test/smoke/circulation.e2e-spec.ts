import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { applyMigrations } from '../../src/infrastructure/persistence/migrate.js';
import { startFrom } from '../support/app.js';
import { AppModule } from '../../src/app.module.js';

/**
 * Prépare un fichier SQLite réel, comme un exploitant le ferait.
 *
 * Un fichier et non `:memory:` : une base en mémoire ne prouve rien du pilote,
 * du chemin, ni de l'index unique partiel que le schéma pose sur le disque.
 *
 * @param file - le fichier à préparer
 */
function prepare(file: string): void {
  applyMigrations(file);
  const raw = new Database(file);
  raw
    .prepare('INSERT INTO copies (id, title_id) VALUES (?, ?)')
    .run('c1', 't1');
  raw
    .prepare(
      'INSERT INTO members (id, membership_expires_at, outstanding_debt) VALUES (?, ?, ?)',
    )
    .run('m1', '2099-01-01T00:00:00.000Z', 0);
  raw.close();
}

/**
 * Le parcours de fumée : l'application de production, de bout en bout.
 *
 * Elle est construite depuis `AppModule` et non depuis le module du guichet,
 * et RIEN n'est doublé — pas d'`overrideProvider`. C'est la différence entre ce
 * fichier et les tests e2e voisins : ceux-là vérifient des règles, celui-ci
 * vérifie que le produit assemblé répond. Le cœur documente le cas qu'il existe
 * pour attraper — treize gates verts pendant que chaque formulaire répondait
 * 403.
 */
describe('Le parcours de fumée métier', () => {
  let app: INestApplication<Server>;
  let file: string;

  beforeEach(async () => {
    file = join(mkdtempSync(join(tmpdir(), 'fumee-')), 'bibliotheque.db');
    prepare(file);
    process.env.DATABASE_FILE = file;
    app = await startFrom(AppModule);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.DATABASE_FILE;
  });

  it('emprunte, rend, et l exemplaire redevient empruntable', async () => {
    const lent = await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(201);
    expect(lent.body.dueAt).toBeDefined();

    await request(app.getHttpServer())
      .post('/returns')
      .send({ copyId: 'c1' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(201);
  });

  it('refuse le second pret d un exemplaire deja sorti, contre le vrai index', async () => {
    await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(201);

    const refused = await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(409);
    expect(refused.body.type).toBe('/problems/copy-already-on-loan');
  });

  it('ecrit dans le FICHIER, pas dans une base qui disparait', async () => {
    await request(app.getHttpServer())
      .post('/loans')
      .send({ copyId: 'c1', memberId: 'm1' })
      .expect(201);

    const raw = new Database(file, { readonly: true });
    const open = raw
      .prepare('SELECT count(*) as n FROM loans WHERE returned_at IS NULL')
      .get() as { n: number };
    raw.close();
    expect(open.n).toBe(1);
  });
});
