import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { applyMigrations } from '../../src/infrastructure/persistence/migrate.js';
import { openDatabase } from '../../src/infrastructure/persistence/repositories/drizzle-stores.js';
import { DEFAULT_POLICY } from '../../src/infrastructure/config/circulation-policy.js';
import { configureApp } from '../../src/adapters/http/configure-app.js';
import {
  CirculationModule,
  DATABASE,
} from '../../src/adapters/http/circulation/circulation.module.js';

/**
 * Le jeu d'essai du guichet.
 *
 * Il vit ici et non dans le module, ce qui était le défaut que l'opérateur a
 * relevé : le produit portait un `forTesting()` et insérait « endette » en
 * dur. Volontairement minuscule — deux exemplaires, trois adhérents dont un
 * bloqué — parce qu'un jeu plus riche rend les tests dépendants de données que
 * personne ne relit.
 *
 * @param file - le fichier de base à préparer
 */
function seed(file: string): void {
  applyMigrations(file);
  const raw = new Database(file);
  const copy = raw.prepare('INSERT INTO copies (id, title_id) VALUES (?, ?)');
  copy.run('c1', 't1');
  copy.run('c2', 't1');
  const member = raw.prepare(
    'INSERT INTO members (id, membership_expires_at, outstanding_debt) VALUES (?, ?, ?)',
  );
  member.run('m1', '2099-01-01T00:00:00.000Z', 0);
  member.run('m2', '2099-01-01T00:00:00.000Z', 0);
  member.run(
    'endette',
    '2099-01-01T00:00:00.000Z',
    DEFAULT_POLICY.debtBlockThreshold + 10,
  );
  raw.close();
}

/**
 * Démarre le guichet sur une base jetable.
 *
 * La base est fournie par `overrideProvider`, l'outil que NestJS donne pour
 * ça. Le module de production ignore que des tests existent.
 *
 * `beforeInit` existe parce que certains montages ne prennent effet qu'avant
 * `init` — la page OpenAPI en est un. Sans ce point d'accroche, le test qui la
 * vérifie devrait recopier la construction de l'application, et vérifierait
 * alors sa copie plutôt que le montage réel.
 *
 * @param beforeInit - ce qu'il faut appliquer avant l'initialisation
 * @returns l'application prête à recevoir des requêtes
 */
export async function startCirculationApp(
  beforeInit?: (app: INestApplication<Server>) => void,
): Promise<INestApplication<Server>> {
  const file = join(mkdtempSync(join(tmpdir(), 'guichet-')), 'test.db');
  seed(file);
  const built = await Test.createTestingModule({ imports: [CirculationModule] })
    .overrideProvider(DATABASE)
    .useValue(openDatabase(file))
    .compile();
  const app = configureApp(
    built.createNestApplication<INestApplication<Server>>(),
  );
  beforeInit?.(app);
  await app.init();
  return app;
}
