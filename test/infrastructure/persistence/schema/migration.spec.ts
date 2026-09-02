import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const MIGRATIONS = 'src/infrastructure/persistence/migrations';

/**
 * Applique toutes les migrations à une base neuve.
 */
function freshDatabase(): Database.Database {
  const file = join(mkdtempSync(join(tmpdir(), 'biblio-')), 'test.db');
  const db = new Database(file);
  for (const name of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(join(MIGRATIONS, name), 'utf8'));
  }
  return db;
}

describe('Le schema et sa migration', () => {
  it('la configuration Drizzle vit sous src, pas a la racine', () => {
    expect(existsSync('src/infrastructure/persistence/drizzle.config.ts')).toBe(
      true,
    );
    expect(existsSync('drizzle.config.ts')).toBe(false);
  });

  it('une migration versionnee existe', () => {
    expect(
      readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).length,
    ).toBeGreaterThan(0);
  });

  it('appliquee a une base neuve, elle cree les quatre tables', () => {
    const db = freshDatabase();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    for (const table of ['copies', 'members', 'loans', 'holds']) {
      expect(names).toContain(table);
    }
    db.close();
  });

  it('REFUSE un second pret ouvert sur le meme exemplaire', () => {
    const db = freshDatabase();
    const insert = db.prepare(
      'INSERT INTO loans (copy_id, member_id, started_at, due_at, returned_at, lost_at, renewals) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('c1', 'm1', '2026-03-01', '2026-03-24', null, null, 0);
    expect(() =>
      insert.run('c1', 'm2', '2026-03-02', '2026-03-25', null, null, 0),
    ).toThrow();
    db.close();
  });

  it('mais ACCEPTE un second pret quand le premier est rendu', () => {
    const db = freshDatabase();
    const insert = db.prepare(
      'INSERT INTO loans (copy_id, member_id, started_at, due_at, returned_at, lost_at, renewals) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('c1', 'm1', '2026-03-01', '2026-03-24', '2026-03-10', null, 0);
    expect(() =>
      insert.run('c1', 'm2', '2026-03-11', '2026-04-03', null, null, 0),
    ).not.toThrow();
    db.close();
  });
});
