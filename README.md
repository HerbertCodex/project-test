# Gestion de livres et emprunts

Squelette initial SvelteKit d'une application de gestion de livres permettant l'emprunt.

À ce stade, le projet contient une page d'accueil, un endpoint `GET /health`, un hook serveur qui ajoute des en-têtes de sécurité, et leurs tests. Aucune règle métier n'est encore implémentée.

## Prérequis

- Node.js 22.12 ou plus récent (voir `.nvmrc`)
- npm

## Installation

```sh
npm install   # génère package-lock.json, à commiter ensuite
```

Une fois le lockfile commité, préférer `npm ci` pour des installations reproductibles.

## Commandes

```sh
npm run dev     # serveur de développement sur http://localhost:5173
npm test        # tests unitaires (Vitest)
npm run check   # vérification des types (svelte-check)
npm run build   # build de production (adapter-auto : cible d'hébergement à choisir)
```

## Structure

```
src/app.html                     gabarit HTML
src/hooks.server.ts              en-têtes de sécurité ajoutés à chaque réponse
src/routes/+page.svelte          page d'accueil
src/routes/health/+server.ts     endpoint de santé
svelte.config.js                 adaptateur et Content-Security-Policy
vite.config.ts                   Vite et Vitest
```

## Prochaines étapes (à définir avec Product)

1. Préciser le contexte : bibliothèque, librairie avec service de prêt, ou collection personnelle ou associative.
2. Spécifier la fonction d'emprunt : qui emprunte, conditions, retours, retards, réservations, exemplaires multiples.
3. Décider des comptes et rôles (personnel, emprunteurs), puis de l'authentification.
4. Choisir la persistance et l'hébergement (et donc l'adaptateur SvelteKit).

Dès que des données d'emprunteurs seront stockées, il faudra ajouter une modélisation des menaces, un contrôle d'accès côté serveur et des tests négatifs.
