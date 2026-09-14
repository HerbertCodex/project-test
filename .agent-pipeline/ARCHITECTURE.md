# Architecture rationale

Une seule application SvelteKit 2 (Svelte 5, TypeScript, Vite), gérée avec npm. L'interface (`src/routes/+page.svelte`) et le code serveur (`src/routes/health/+server.ts` et `src/hooks.server.ts`) sont dans le même projet. Ce choix suit la préférence de l'opérateur et fournit l'état central côté serveur dont les emprunts auront besoin. La sécurité de base passe par une CSP (`kit.csp` en mode auto, avec nonces et hashes générés par SvelteKit) et par un hook `handle` qui ajoute `nosniff`, `Referrer-Policy` et `X-Frame-Options`. Les tests Vitest s'exécutent en environnement node. Aucune base de données, authentification, adaptateur d'hébergement ni modèle de domaine n'est choisi : ils dépendent de réponses Product ou de décisions reportées.

Project type: fullstack

## 1. Framework SvelteKit 2 avec Svelte 5, utilisé en full-stack : pages et endpoints serveur dans la même application.

L'opérateur a explicitement demandé SvelteKit. Nous utilisons la variante full-stack, avec des routes `+server.ts`, des `load` et des form actions côté serveur. La raison : une fonction d'emprunt a besoin d'un état partagé côté serveur, et SvelteKit le fournit sans second service. Les form actions intègrent aussi une vérification d'origine (CSRF) utile aux futures actions « emprunter » et « rendre ».

### Evidence
- Précision de l'opérateur : « je veux ca SvelteKit ».
- Demande initiale : « Je veux faire une app de gestion de librairie, qui permet d'emprunter ». L'emprunt suppose un suivi partagé de qui détient quel livre.
- Le dépôt cible est vide (Glob `**/*` : aucun fichier).

### Alternatives
- **SvelteKit en SPA statique (adapter-static, ssr=false) avec un backend séparé** — Il faudrait un deuxième service et un deuxième choix de stack avant même d'avoir des règles métier. On perdrait aussi le rendu serveur et les form actions protégées contre le CSRF.
- **Conserver le squelette Node.js sans dépendance proposé précédemment** — Il contredit la préférence technologique explicite de l'opérateur.
- **Svelte seul avec Vite (sans Kit)** — L'opérateur a nommé SvelteKit, et Svelte seul ne fournit ni routage ni code serveur.

### Trade-offs
- Dépendances npm et chaîne d'approvisionnement dès le premier commit : `package.json`, puis le futur `package-lock.json`, deviennent des chemins sensibles.
- Le couplage interface/serveur dans un même déploiement est moins adapté si une application mobile doit un jour consommer une API publique.

### Reconsider when
- Product exige une API consommée par des clients tiers ou mobiles : extraire une couche API versionnée ou un backend dédié.
- L'opérateur précise qu'il voulait SvelteKit uniquement pour le frontend, avec un backend séparé.
- La charge ou l'équipe justifie de séparer le déploiement du frontend et du backend.

## 2. TypeScript en mode strict, vérifié par `npm run check` (svelte-kit sync et svelte-check).

Le futur modèle de domaine (livres, exemplaires, emprunteurs, emprunts) profite du typage. SvelteKit génère aussi des types de route (`./$types`) qui rendent `load` et les endpoints plus sûrs. C'est la configuration standard proposée par `sv create`.

### Evidence
- SvelteKit génère `.svelte-kit/tsconfig.json` et les types `$types` pour chaque route.
- L'emprunt implique plusieurs entités liées, où les erreurs de forme de données sont fréquentes.

### Alternatives
- **JavaScript avec JSDoc** — Possible et un peu plus léger, mais les types de domaine sont moins lisibles et c'est moins courant dans l'écosystème SvelteKit actuel.

### Trade-offs
- Deux dépendances de développement de plus (typescript, svelte-check) et une étape `svelte-kit sync` avant la vérification des types.

### Reconsider when
- L'équipe refuse TypeScript ou le projet reste un prototype jetable.

## 3. npm comme gestionnaire de paquets, avec des plages de versions semver dans `package.json` et aucun lockfile fabriqué.

Aucun gestionnaire n'est imposé, et npm est livré avec Node.js. Les consignes interdisent de fabriquer un lockfile : le premier `npm install`, fait après approbation, générera `package-lock.json`, qui devra être commité et utilisé ensuite avec `npm ci`. `.npmrc` active `engine-strict` pour refuser une version de Node incompatible.

### Evidence
- Aucun lockfile ni gestionnaire existant dans le dépôt vide.
- Consigne : « Do not fabricate generated lockfiles ».

### Alternatives
- **pnpm** — Plus rapide et plus strict, mais il faut l'installer ou activer Corepack. Aucune préférence n'a été exprimée.

### Trade-offs
- Les versions exactes ne seront fixées qu'au premier install. Tant que le lockfile n'est pas commité, deux installations peuvent résoudre des versions différentes.

### Reconsider when
- L'opérateur ou la CI impose pnpm, yarn ou bun.
- Le premier `npm install` échoue sur une incompatibilité de peer dependencies entre les plages proposées : ajuster les plages avant de commiter le lockfile.

## 4. Adaptateur `@sveltejs/adapter-auto` tant que l'hébergement n'est pas choisi.

L'hébergement est explicitement une décision reportable. adapter-auto ne fige aucune cible (Node, Vercel, Netlify, Cloudflare) et permet `vite dev` et les tests sans choix d'infrastructure.

### Evidence
- securityContext.profile.exposure = "unknown".
- Consigne : ne pas bloquer le bootstrap sur l'hébergement de production.

### Alternatives
- **@sveltejs/adapter-node** — Adapté à un serveur Node auto-hébergé, mais il présume un hébergement qui n'est pas décidé.

### Trade-offs
- `npm run build` signalera qu'aucun environnement de production n'est détecté : le build n'est pas directement déployable tel quel.

### Reconsider when
- Une cible d'hébergement est choisie : installer l'adaptateur correspondant (adapter-node pour un conteneur ou une VM, par exemple).
- Une base de données locale (SQLite) est retenue : il faut un runtime Node persistant, donc adapter-node.

## 5. Aucune persistance, authentification ni modèle de domaine dans le squelette.

Le schéma (livre, exemplaire, adhérent ou client, emprunt) et les règles (durée, limites, retards, réservations) sont des décisions métier non prises. Les coder maintenant reviendrait à inventer des règles d'emprunt.

### Evidence
- La demande ne précise ni qui emprunte, ni les conditions, ni l'existence de comptes.
- Consigne : « Do not invent lending durations, site policies, account-creation rules ».

### Alternatives
- **Ajouter tout de suite Drizzle ou Prisma avec SQLite ou PostgreSQL et un schéma Livre/Emprunt** — On figerait un modèle qui dépend de réponses Product inconnues, avec de nouvelles dépendances, et des secrets dans le cas de PostgreSQL.
- **Ajouter Lucia, Auth.js ou better-auth dès maintenant** — On ne sait pas encore qui se connecte (personnel, emprunteurs, personne).

### Trade-offs
- Le squelette ne montre aucune valeur métier : la première tâche Product devra définir le modèle d'emprunt.

### Reconsider when
- Product a validé les entités et les règles d'emprunt et de retour : ajouter une couche domaine testée dans `src/lib/server`, puis la persistance.
- Des données personnelles d'emprunteurs sont introduites : ajouter authentification, autorisation côté serveur, minimisation des données, modélisation des menaces et tests négatifs.

## 6. Sécurité de base : CSP SvelteKit en mode auto (script-src 'self', object-src 'none', base-uri 'self', form-action 'self') et hook `handle` ajoutant nosniff, Referrer-Policy et X-Frame-Options (DENY). `/health` renvoie `cache-control: no-store`.

L'application sert désormais du HTML. La CSP limite l'impact d'une injection (XSS), et SvelteKit ajoute lui-même nonces et hashes à ses scripts inline. `style-src` et `default-src` ne sont volontairement pas restreints : Vite injecte des styles inline en développement et les transitions Svelte utilisent des `<style>` inline, qu'une restriction casserait. Les en-têtes du hook limitent le reniflage MIME et le clickjacking. En développement, `vite dev` écoute sur localhost par défaut.

### Evidence
- Référentiel OWASP : A03 Injection (XSS) et A05 Security Misconfiguration concernent toute interface web.
- securityContext.profile.exposure = "unknown" : ne rien exposer plus que nécessaire.

### Alternatives
- **Aucune CSP ni en-tête dans le squelette** — Les ajouter plus tard est plus coûteux, car du code inline incompatible s'accumule entre-temps.
- **CSP stricte avec default-src 'self'** — Casse l'injection de styles de Vite en développement et les transitions Svelte, sans gain significatif à ce stade.

### Trade-offs
- Toute ressource tierce (script d'analyse, CDN) exigera de modifier explicitement la CSP.
- `style-src` reste permissif : une injection CSS reste possible.

### Reconsider when
- Des sessions ou cookies d'authentification sont introduits : ajouter Strict-Transport-Security derrière TLS, des cookies Secure, HttpOnly et SameSite, et resserrer la CSP.
- Des ressources tierces ou des iframes légitimes sont nécessaires.
- L'application doit être intégrée dans un autre site (X-Frame-Options et frame-ancestors à revoir).

## 7. Tests unitaires avec Vitest (`npm test` lance `vitest run`), en environnement node, sur les fichiers `src/**/*.{test,spec}.{js,ts}`.

Vitest réutilise la configuration Vite et le plugin SvelteKit, ce qui permet de tester directement les handlers `+server.ts` et les hooks sans démarrer de serveur. C'est l'outil de test intégré par défaut par `sv create`.

### Evidence
- Consigne : au moins un vrai test quand c'est possible.
- `src/routes/health/server.test.ts` et `src/hooks.server.test.ts` appellent le vrai code.

### Alternatives
- **Playwright (tests de bout en bout)** — Il faut télécharger des navigateurs et démarrer un serveur : c'est lourd pour un squelette sans parcours métier.
- **node:test** — Ne sait pas résoudre `$types`, les imports `.svelte` ni les alias SvelteKit sans outillage supplémentaire.

### Trade-offs
- Les tests ne rendent pas encore de composant Svelte ni ne vérifient la CSP dans un vrai navigateur.

### Reconsider when
- Les premiers parcours métier (emprunter, rendre) existent : ajouter Playwright pour les tests de bout en bout et les tests négatifs d'autorisation.
- Des composants interactifs apparaissent : ajouter @testing-library/svelte ou vitest-browser-svelte.

---

This file records bootstrap-time reasoning. Confirmed operator decisions are authoritative in DECISIONS.json; revisit derived architecture choices when their triggers occur.
