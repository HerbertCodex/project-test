import { expect, test } from '@playwright/test';
import { addBook } from '../src/lib/server/catalogue';
import { openDatabase } from '../src/lib/server/db';

// Même chemin que `webServer.env.LIBRAIRIE_DB_PATH` dans playwright.config.ts.
const CATALOGUE_DB_PATH = 'data/e2e.db';
const CATALOGUE_PAGE_SIZE = 25;

/**
 * Parcours public minimal : ce que voit un visiteur avant toute donnée. Il vérifie que les pages
 * se rendent réellement dans un navigateur, ce qu'aucun test serveur ne peut affirmer.
 */
test('le catalogue se rend et invite à se connecter', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Catalogue', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Se connecter' }).first()).toBeVisible();
});

test('le formulaire de connexion expose ses champs étiquetés', async ({ page }) => {
  await page.goto('/connexion');
  await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
});

test("l'inscription crée un compte et renvoie vers la connexion", async ({ page }) => {
  const email = `visiteur-${Date.now()}@exemple.test`;
  await page.goto('/inscription');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Nom affiché').fill('Visiteur');
  await page.getByLabel('Mot de passe').fill('Librairie2026!Test');
  await page.getByRole('button', { name: /Créer/ }).click();
  await expect(page).toHaveURL(/\/connexion/);
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});

/**
 * Une saisie faite avant l'hydratation doit survivre. Le serveur rend les champs préremplis par
 * une soumission refusée ; si le client réappliquait cette valeur au démarrage, il effacerait ce
 * qu'un gestionnaire de mots de passe ou un visiteur rapide vient de taper, et le formulaire
 * partirait vide. Le test retient le JavaScript de l'application pour rendre la course certaine.
 */
test("une saisie faite avant l'hydratation n'est pas effacée", async ({ page }) => {
  const email = `pressé-${Date.now()}@exemple.test`;
  let releaseScripts = () => {};
  const hydrated = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route('**/_app/immutable/entry/*.js', async (route) => {
    await hydrated;
    await route.continue();
  });

  await page.goto('/inscription');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Nom affiché').fill('Visiteur pressé');
  releaseScripts();
  await page.waitForLoadState('networkidle');

  await expect(page.getByLabel('Adresse e-mail')).toHaveValue(email);
  await expect(page.getByLabel('Nom affiché')).toHaveValue('Visiteur pressé');
});

test('la pagination du catalogue public mène à la page suivante', async ({ page }) => {
  const db = openDatabase(CATALOGUE_DB_PATH);
  try {
    for (let index = 1; index <= CATALOGUE_PAGE_SIZE + 1; index += 1) {
      const created = addBook(db, {
        title: `Pagination essai ${String(index).padStart(2, '0')}`,
        author: 'Auteur de test'
      });
      if (!created.ok) throw new Error('Livre de test non créé.');
    }
  } finally {
    db.close();
  }

  await page.goto('/');
  const firstPageTitle = await page.locator('.book__title').first().innerText();
  await expect(page.locator('.pagination__position')).toContainText(/1–25 sur \d+/);

  const nextLink = page.getByRole('link', { name: 'Suivant' });
  await expect(nextLink).toBeVisible();
  await nextLink.click();

  await expect(page).toHaveURL(/\?page=2/);
  const secondPageTitle = await page.locator('.book__title').first().innerText();
  expect(secondPageTitle).not.toBe(firstPageTitle);
  await expect(page.locator('.pagination__position')).toContainText(/26–\d+ sur \d+/);
});
