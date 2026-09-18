import { defineConfig } from '@playwright/test';

/**
 * Contrôle navigateur du dépôt, exécuté par le runner de la pipeline dans un worktree neuf.
 * Le serveur est celui du build de production, sur une base vide créée à la volée : ces essais
 * décrivent le rendu réel des pages publiques, pas un jeu de données.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180_000,
    env: { LIBRAIRIE_DB_PATH: 'data/e2e.db' }
  }
});
