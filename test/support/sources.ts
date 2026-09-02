import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Les fichiers TypeScript sous une racine, récursivement.
 *
 * Partagé parce que `duplication` a refusé les deux copies qui existaient : le
 * même parcours servait au test d'étanchéité des seuils et au test qui
 * interdit NestJS dans le domaine. C'est la note de réutilisation rendue
 * vérifiable.
 *
 * @param root - la racine à parcourir
 * @param found - accumulateur
 * @returns les chemins des sources trouvées
 */
export function sourcesUnder(root: string, found: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) sourcesUnder(path, found);
    else if (path.endsWith('.ts')) found.push(path);
  }
  return found;
}

const BLOCK_COMMENT = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
const LINE_COMMENT = new RegExp('//[^\\n]*', 'g');

/**
 * Le code d'un fichier, commentaires ôtés.
 *
 * Partagé pour la même raison que `sourcesUnder` : deux tests interrogeaient
 * le code source à la lettre, et `duplication` a refusé la seconde copie. Ôter
 * les commentaires est ce qui empêche un test de passer parce qu'une phrase
 * d'explication contient le mot cherché.
 *
 * @param path - le fichier à lire
 * @returns son code seul
 */
export function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(BLOCK_COMMENT, ' ')
    .replace(LINE_COMMENT, ' ');
}
