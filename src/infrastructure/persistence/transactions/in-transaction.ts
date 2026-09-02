import { sql } from 'drizzle-orm';
import type { Db } from '../repositories/drizzle-stores.js';

/**
 * Exécute un travail dans une transaction, ou n'écrit rien.
 *
 * L'enjeu est une règle du métier et non une commodité technique : un prêt
 * fermé sans la dette qu'il produit laisse un adhérent devoir une somme que
 * personne ne peut lui expliquer, et une dette qu'on ne peut pas expliquer
 * finit annulée.
 *
 * **Elle vit dans l'adaptateur, et c'est structurel.** Le domaine et
 * l'application ignorent qu'une base existe — l'architecture hexagonale
 * retenue l'exige, et un test lit leurs sources pour refuser les mots
 * `transaction` et `db`. Le cas d'usage appelle deux fois le port ; c'est ici
 * qu'on décide que ces deux appels n'en font qu'un.
 *
 * L'erreur d'origine est relancée telle quelle après le retour arrière. La
 * remplacer par celle du `rollback` transformerait une séance de débogage en
 * devinette.
 *
 * Les trois ordres ne sont pas attendus : le pilote better-sqlite3 est
 * SYNCHRONE, et le lint type-aware l'a signalé sur une première version qui
 * les attendait. Un `await` sur une valeur qui n'est pas une promesse ne
 * suspend rien — il donnait une fausse impression de séquencement là où
 * l'exécution était déjà immédiate.
 *
 * @param db - la poignée de base
 * @param work - le travail à exécuter d'un bloc
 * @returns ce que le travail rend
 * @throws l'erreur du travail, après retour arrière
 */
export async function inTransaction<Result>(
  db: Db,
  work: () => Promise<Result>,
): Promise<Result> {
  db.run(sql`begin`);
  try {
    const outcome = await work();
    db.run(sql`commit`);
    return outcome;
  } catch (error) {
    db.run(sql`rollback`);
    throw error;
  }
}
