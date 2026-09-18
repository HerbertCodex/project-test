import { expect, test } from '@playwright/test';

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
