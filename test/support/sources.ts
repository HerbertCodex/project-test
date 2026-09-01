import { readdirSync, statSync } from 'node:fs';
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
