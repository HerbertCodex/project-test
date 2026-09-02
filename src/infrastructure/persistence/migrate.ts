import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const MIGRATIONS = 'src/infrastructure/persistence/migrations';

/**
 * Applique toutes les migrations à un fichier de base.
 *
 * Vit du côté production plutôt que dans les utilitaires de test, et c'est
 * délibéré : appliquer les migrations est une opération du produit, pas un
 * échafaudage. `duplication` a refusé les deux copies qui existaient — une
 * dans le câblage du module, une dans le montage des tests — et laisser la
 * version de référence dans les tests aurait fait dépendre le produit de son
 * banc d'essai.
 *
 * Elles sont lues depuis le répertoire versionné plutôt que rejouées de
 * mémoire : un montage qui recréerait les tables à la main pourrait diverger
 * de la migration et laisser les tests verts sur une structure que la
 * production n'a pas.
 *
 * @param file - le chemin du fichier SQLite à migrer
 */
export function applyMigrations(file: string): void {
  const db = new Database(file);
  try {
    for (const name of readdirSync(MIGRATIONS)
      .filter((entry) => entry.endsWith('.sql'))
      .sort()) {
      db.exec(readFileSync(join(MIGRATIONS, name), 'utf8'));
    }
  } finally {
    db.close();
  }
}
