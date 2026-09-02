import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  openDatabase,
  type Db,
} from '../../src/infrastructure/persistence/repositories/drizzle-stores.js';

const MIGRATIONS = 'src/infrastructure/persistence/migrations';

/**
 * Une base SQLite neuve, migrée, avec les exemplaires et adhérents demandés.
 *
 * Partagée parce que `duplication` a refusé les deux copies : les tests de
 * persistance et ceux de concurrence montaient la même base.
 *
 * Elle applique les migrations RÉELLES plutôt que de créer les tables à la
 * main. Un montage qui recopierait le schéma pourrait diverger de la migration
 * et laisser les tests verts sur une structure que la production n'a pas.
 *
 * @param seed - les exemplaires et adhérents à insérer
 * @returns la poignée Drizzle sur une base prête
 */
export function seededDatabase(seed: {
  copies?: { id: string; titleId: string }[];
  members?: { id: string; expiresAt: string; debt: number }[];
}): Db {
  const file = join(mkdtempSync(join(tmpdir(), 'biblio-')), 'test.db');
  const raw = new Database(file);
  for (const name of readdirSync(MIGRATIONS)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, name), 'utf8'));
  }
  for (const copy of seed.copies ?? []) {
    raw
      .prepare('INSERT INTO copies (id, title_id) VALUES (?, ?)')
      .run(copy.id, copy.titleId);
  }
  for (const member of seed.members ?? []) {
    raw
      .prepare(
        'INSERT INTO members (id, membership_expires_at, outstanding_debt) VALUES (?, ?, ?)',
      )
      .run(member.id, member.expiresAt, member.debt);
  }
  raw.close();
  return openDatabase(file);
}
