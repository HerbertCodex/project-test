# Architecture rationale

Une seule application SvelteKit 2 (Svelte 5, TypeScript strict, Vite), gérée avec npm et un `package-lock.json` commité, pour une « librairie + prêt » : un commerce qui vend des livres et propose en plus un service de prêt. L'incrément 1 (prêt) est en place dans `ac9b34f`. Une base SQLite locale (better-sqlite3, migrations versionnées par `PRAGMA user_version`) stocke les comptes, les sessions, les échecs de connexion, les livres et les prêts. Il existe deux rôles. L'emprunteur s'inscrit librement, emprunte depuis le catalogue et consulte « Mes prêts ». Le libraire est créé uniquement par la commande locale `npm run libraire:creer`, ajoute des livres et enregistre les retours. Les mots de passe sont hachés en Argon2id et le jeton de session est stocké sous forme d'empreinte SHA-256. La connexion est bloquée après 5 échecs sur 15 minutes. Le domaine suit des dates calendaires Europe/Paris : prêt de 30 jours de l'exemplaire unique d'un titre, retards signalés dès le lendemain de l'échéance. La logique métier et le SQL vivent dans `src/lib/server/<module>`, et les routes restent minces. La sécurité web repose sur une CSP en mode auto, un hook d'en-têtes, la vérification d'origine par défaut de SvelteKit et le cookie `SameSite=Lax`. Il n'y a encore ni journalisation de sécurité, ni HSTS, ni workflow CI. L'interface suit la direction « Maison d'édition » (Cormorant Garamond et Inter embarquées). La vente, les filtres et le réassort (incrément 2), puis la suppression de compte, la conservation et la journalisation (incrément 3) restent à implémenter : voir « À venir ».

> **Sources d'autorité.** `.agent-pipeline/DECISIONS.json` fait autorité pour les décisions confirmées de l'opérateur. Le code du dépôt fait foi pour l'état réel de l'application. Ce document décrit ce code tel qu'il est au commit `ac9b34f`. En cas d'écart, il faut corriger ce document, pas le code.

Project type: fullstack

## 1. Framework SvelteKit 2 avec Svelte 5, utilisé en full-stack : pages, `load`, form actions et endpoints serveur dans la même application.

**En vigueur.** L'opérateur a explicitement demandé SvelteKit. La variante full-stack est désormais pleinement exploitée : le catalogue, l'emprunt, les retours, l'inscription, la connexion et la déconnexion passent par des `load` et des form actions côté serveur, avec l'accès à la base SQLite dans le même processus. Aucun second service n'a été nécessaire, et les form actions bénéficient de la vérification d'origine intégrée à SvelteKit (voir décision 6).

### Evidence
- Précision de l'opérateur : « je veux ca SvelteKit » (`D-stack-sveltekit`, confirmée dans DECISIONS.json).
- Demande initiale : « Je veux faire une app de gestion de librairie, qui permet d'emprunter » (`D-borrowing-capability`, confirmée). Domaine précisé par l'opérateur : « Librairie + prêt » (Q-domain-librairie).
- `src/routes/+page.server.ts` (catalogue et action `emprunter`), `src/routes/libraire/retours/+page.server.ts` (retours), `src/routes/connexion/+page.server.ts`, `src/routes/inscription/+page.server.ts`, `src/routes/deconnexion/+page.server.ts`, `src/routes/mes-prets/+page.server.ts`, `src/routes/health/+server.ts`.
- `src/hooks.server.ts` charge l'utilisateur de session dans `event.locals.user`, typé dans `src/app.d.ts`.

### Alternatives
- **SvelteKit en SPA statique (adapter-static, ssr=false) avec un backend séparé** — Il faudrait un deuxième service et une API, alors que toutes les opérations actuelles tiennent dans des form actions. On perdrait aussi le rendu serveur et la vérification d'origine des form actions.
- **Squelette Node.js sans dépendance proposé avant le bootstrap** — Contredit la préférence technologique explicite de l'opérateur.
- **Svelte seul avec Vite (sans Kit)** — Ne fournit ni routage ni code serveur.

### Trade-offs
- Chaîne d'approvisionnement npm dès le départ : `package.json` et `package-lock.json` sont des chemins sensibles.
- Interface et serveur sont couplés dans un même déploiement. Aucune API publique versionnée n'existe : seul `/health` est un endpoint `+server.ts`.
- La base SQLite est ouverte dans le processus serveur, ce qui suppose un runtime Node persistant (voir décision 4).

### Reconsider when
- Product exige une API consommée par des clients tiers ou mobiles : extraire une couche API versionnée ou un backend dédié.
- La charge ou l'organisation de l'équipe justifie de déployer séparément le frontend et le backend.

## 2. TypeScript en mode strict, vérifié par `npm run check` (svelte-kit sync et svelte-check).

**En vigueur.** Le modèle de domaine existe désormais : utilisateurs, rôles, sessions, livres et prêts. Il est typé par des types explicites (`AuthUser`, `Role`, `CatalogueEntry`, `BorrowResult`, `ReturnResult`, `BorrowerLoans`…) et par des résultats discriminés `{ ok: true } | { ok: false }` plutôt que par des exceptions pour les échecs attendus. Les types de route générés (`./$types`) couvrent chaque `load` et chaque action.

### Evidence
- `tsconfig.json` : `"strict": true`, étend `.svelte-kit/tsconfig.json`.
- `package.json` : `"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"`.
- `src/lib/server/auth/index.ts`, `src/lib/server/catalogue/index.ts` et `src/lib/server/loans/index.ts` exportent des types de résultat discriminés.
- `scripts/libraire-creer.ts` est exécuté par `node --experimental-strip-types` : les modules qu'il charge (`auth/index.ts`, `auth/cli.ts`, `db/index.ts`) n'utilisent que des `import type` pour les imports relatifs (commentaires de tête de `auth/index.ts` et `auth/cli.ts`, test « garde les modules chargés par Node sans import relatif à l'exécution » dans `auth.test.ts`).

### Alternatives
- **JavaScript avec JSDoc** — Plus léger, mais les types de domaine et les résultats discriminés sont moins lisibles.

### Trade-offs
- Deux dépendances de développement (typescript, svelte-check) et une étape `svelte-kit sync` avant la vérification.
- La suppression de types de Node impose une contrainte d'écriture aux modules partagés avec la commande locale : pas d'alias `$lib` ni d'import relatif à l'exécution.

### Reconsider when
- La commande locale doit importer davantage de modules serveur : envisager un bundling du script plutôt que d'étendre la contrainte « `import type` seulement ».

## 3. npm comme gestionnaire de paquets, `package-lock.json` commité et installation reproductible par `npm ci --ignore-scripts`.

**En vigueur, preuves mises à jour.** Au bootstrap, aucun lockfile n'existait et il ne fallait pas en fabriquer un. Il a depuis été généré par npm et commité (lockfileVersion 3). Le pipeline installe les dépendances avec `npm ci --ignore-scripts`. `.npmrc` active `engine-strict` et `package.json` exige Node `>=22.12`. `.nvmrc` indique 24.

### Evidence
- `package-lock.json` présent dans `ac9b34f`, avec les entrées `node_modules/argon2` et `node_modules/better-sqlite3`.
- `pipeline.v2.json` : étape `setup` = `npm ci --ignore-scripts`.
- `.npmrc` : `engine-strict=true`. `package.json` : `"engines": { "node": ">=22.12" }`. `.nvmrc` : `24`.
- Dépendances d'exécution : `argon2` et `better-sqlite3`, deux modules natifs. Tout le reste est en `devDependencies`.

### Alternatives
- **pnpm** — Plus rapide et plus strict, mais demande Corepack ou une installation. Aucune préférence n'a été exprimée.

### Trade-offs
- Deux modules natifs : leur installation dépend de binaires adaptés à la plateforme et à la version de Node. `--ignore-scripts` n'exécute pas les scripts d'installation des paquets, ce qui réduit la surface d'attaque mais suppose que ces binaires soient utilisables sans script. C'est un point à surveiller lors d'un changement de plateforme ou de Node.
- Les plages semver de `package.json` restent larges : seul le lockfile fige les versions.

### Reconsider when
- L'opérateur ou une future CI impose pnpm, yarn ou bun.
- Un changement de Node ou de plateforme empêche le chargement d'`argon2` ou de `better-sqlite3` après `npm ci --ignore-scripts`.

## 4. Adaptateur `@sveltejs/adapter-auto` tant que l'hébergement n'est pas choisi.

**En vigueur ; déclencheur atteint, décision reportée.** Le déclencheur prévu au bootstrap (« une base SQLite locale est retenue : il faut un runtime Node persistant, donc adapter-node ») est atteint : better-sqlite3 écrit dans `data/librairie.db`. Mais l'hébergement n'a toujours pas été choisi, et le choix d'un adaptateur est hors du périmètre des tâches réalisées. `svelte.config.js` garde donc adapter-auto. Aujourd'hui, l'application tourne en local (`vite dev`, qui écoute sur localhost par défaut).

### Evidence
- `svelte.config.js` : `import adapter from '@sveltejs/adapter-auto'` et commentaire « adapter-auto tant que l'hébergement n'est pas choisi ».
- `src/lib/server/db/index.ts` : `DEFAULT_DATABASE_PATH = 'data/librairie.db'`, connexion better-sqlite3 dans le processus.
- `package.json` : `"dev": "vite dev"` sans `--host` (`D-local-bind-default`).
- `D-adapter-auto` a le statut `deferred` dans DECISIONS.json.

### Alternatives
- **@sveltejs/adapter-node** — Cohérent avec SQLite sur disque, mais il présume un hébergement (VM, conteneur) qui n'est pas décidé.
- **Adaptateur serverless (Vercel, Netlify, Cloudflare)** — Incompatible avec une base SQLite locale persistante et un module natif.

### Trade-offs
- `npm run build` ne produit pas d'artefact directement déployable pour une cible Node.
- adapter-auto pourrait sélectionner une plateforme serverless incompatible avec SQLite sur disque : le déploiement impose de trancher.

### Reconsider when
- Une cible d'hébergement est choisie : installer adapter-node (ou l'adaptateur Node équivalent), fixer `LIBRAIRIE_DB_PATH` sur un volume persistant et prévoir la sauvegarde du fichier et de ses fichiers WAL.
- L'application est exposée au-delà du poste local : réexaminer HSTS et TLS (décision 6).

## 5. ~~Aucune persistance, authentification ni modèle de domaine dans le squelette.~~ — **REMPLACÉE**

**Remplacée par les décisions 8 (persistance SQLite et migrations), 9 (authentification, sessions et blocage), 10 (rôles, contrôle d'accès et commande libraire locale) et 11 (domaine prêt).** Au bootstrap, le schéma et les règles d'emprunt n'étaient pas décidés, et les coder serait revenu à inventer des règles. Les deux déclencheurs prévus se sont produits : Product a validé l'incrément 1 (prêt), et des données d'emprunteurs (e-mail, nom affiché) ont été introduites avec authentification, autorisation côté serveur et tests négatifs. Cette décision n'est plus en vigueur. L'entrée `D-no-persistence-auth-yet` de DECISIONS.json est gérée par le contrôleur.

### Evidence
- `src/lib/server/db/index.ts` (tables `users`, `sessions`, `login_failures`, `books`, `loans`), `src/lib/server/auth/index.ts`, `src/lib/server/catalogue/index.ts`, `src/lib/server/loans/index.ts`.
- Décisions opérateur : « qui permet d'emprunter » (emprunt, retour, retards, « Mes prêts ») ; « Paquets éprouvés » (e-mail + nom affiché, pas de téléphone).

### Alternatives
- **Garder le squelette sans domaine** — Contredirait la fonction d'emprunt désormais livrée.

### Trade-offs
- L'application détient maintenant des données personnelles (e-mail, nom affiché, historique de prêts) et des hachages de mots de passe dans `data/librairie.db`.

### Reconsider when
- Sans objet : la décision est remplacée. Voir les conditions de révision des décisions 8 à 11.

## 6. Sécurité web : CSP SvelteKit en mode auto, hook d'en-têtes, protection CSRF par vérification d'origine et cookie `SameSite=Lax`, SQL paramétré et échappement Svelte.

**En vigueur, étendue depuis le bootstrap.** Voici les contrôles présents dans le code à `ac9b34f`, et seulement eux.

- **CSP** (`kit.csp`, mode `auto`) : `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. SvelteKit ajoute nonces ou hashes à ses propres scripts inline. `style-src` et `default-src` ne sont **volontairement pas restreints** : Vite et les transitions Svelte injectent des styles inline.
- **Hook `handle`** (`src/hooks.server.ts`) : ajoute `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin` et `x-frame-options: DENY`, sans écraser un en-tête déjà défini par la route. `/health` répond avec `cache-control: no-store`.
- **CSRF** : aucun jeton CSRF personnalisé n'existe. La protection repose sur la vérification d'origine par défaut des form actions SvelteKit (`csrf.checkOrigin` n'est pas désactivé et aucune `trustedOrigins` n'est déclarée) et sur le cookie de session `SameSite=Lax`. La déconnexion n'a lieu que sur POST : un GET sur `/deconnexion` redirige vers `/` sans rien supprimer.
- **Injection SQL** : toutes les requêtes passent par des requêtes préparées better-sqlite3 à paramètres liés. La seule interpolation est `PRAGMA user_version = ${Number(nextVersion)}`, un entier interne, car PRAGMA n'accepte pas de paramètre lié.
- **XSS** : échappement par défaut de Svelte. Aucun `{@html}` n'est utilisé dans les composants, et un test le vérifie.
- **Redirections** : destinations fixes après connexion (`/libraire/retours` ou `/`) et inscription (`/connexion?inscription=1`). Aucun paramètre de redirection n'est accepté.
- **Données exposées au navigateur** : `src/routes/+layout.server.ts` ne transmet que `displayName` et `role` (ni id ni e-mail). Le catalogue public ne montre ni emprunteur ni échéance.

**N'existe pas encore :** aucune journalisation de sécurité (aucun événement de connexion, de blocage ou de refus d'accès n'est écrit), aucun en-tête `Strict-Transport-Security` (HSTS), aucun workflow CI (pas de répertoire `.github`), aucune limitation de débit par adresse IP, aucun audit de dépendances automatisé. Ce document n'affirme aucune conformité OWASP.

### Evidence
- `svelte.config.js` : bloc `csp` et commentaire sur `style-src`.
- `src/hooks.server.ts` : constante `SECURITY_HEADERS`.
- `src/security-config.test.ts` : vérification d'origine laissée active, aucune origine générique, directives CSP restrictives, aucune source `*`, `https:`, `data:`, `unsafe-inline` ou `unsafe-eval`, aucun `{@html}` dans `src/**/*.svelte`.
- `src/hooks.server.test.ts` : en-têtes ajoutés sans écraser ceux de la route, directives CSP conservées.
- `src/routes/connexion/page.server.test.ts` : « ne déconnecte pas sur GET ». `src/routes/health/server.test.ts` : réponse non mise en cache.
- Tests « stocke littéralement une charge utile SQL » dans `db.test.ts`, `auth.test.ts`, `page.server.test.ts` et `libraire/livres/nouveau/page.server.test.ts`. Tests « rend un titre et un auteur hostiles comme du texte » et « affiche … un titre hostile comme du texte » dans `src/routes/page.server.test.ts`.

### Alternatives
- **Jeton CSRF synchronisé personnalisé** — Redondant avec la vérification d'origine intégrée pour des form actions de même origine, et source d'erreurs d'implémentation.
- **CSP stricte avec `default-src 'self'` et `style-src` restreint** — Casse l'injection de styles de Vite en développement et les transitions Svelte.
- **ORM ou constructeur de requêtes** — Le volume de SQL est faible, et les requêtes préparées suffisent à lier les paramètres.

### Trade-offs
- `style-src` reste permissif : une injection CSS reste possible si un jour du contenu non échappé était rendu.
- Sans journalisation de sécurité, une attaque par force brute ou un refus d'accès répété ne laisse aucune trace exploitable.
- Le cookie de session est `Secure`, mais sans HSTS rien n'empêche une première requête en HTTP une fois l'application exposée.
- La CSRF dépend du maintien des valeurs par défaut de SvelteKit : `security-config.test.ts` protège contre leur désactivation.

### Reconsider when
- L'application est exposée derrière TLS : ajouter HSTS.
- L'incrément 3 implémente la journalisation de sécurité (format et destination à décider, voir « À venir »).
- Un workflow CI est ajouté : appliquer le moindre privilège aux jetons et ne pas exécuter de code non fiable sur des déclencheurs `pull_request_target`.
- Des ressources tierces, des iframes ou une intégration dans un autre site deviennent nécessaires (CSP, `X-Frame-Options` et `frame-ancestors` à revoir).
- Une API non liée aux form actions (JSON, `+server.ts` qui modifie des données) est ajoutée : la vérification d'origine des form actions ne suffira plus à elle seule.

## 7. Tests Vitest en environnement node sur `src/**/*.{test,spec}.{js,ts}`, vérification de types par `npm run check`, gates du pipeline diff-check, test et check.

**En vigueur, étendue.** Vitest réutilise la configuration Vite et le plugin SvelteKit. Les tests appellent directement les `load`, les actions, le hook et les modules serveur sur une base `:memory:`, sans démarrer de serveur. Certains rendent des composants côté serveur avec `render` de `svelte/server`. Le pipeline installe les dépendances par `npm ci --ignore-scripts`, puis exécute trois gates : `diff-check` (`git diff --check`, obligatoire, sur toutes les voies), `test` (`npm run test`) et `check` (`npm run check`), ces deux derniers sur les voies `standard` et `high`.

Fichiers de test par module :
- `src/lib/server/db/db.test.ts` — migrations, clés étrangères, rejeu, refus d'un schéma plus récent, index unique partiel, contraintes CHECK, absence de cascade vers les prêts, base sur fichier, `resolveDatabasePath`.
- `src/lib/server/dates.test.ts` — date du jour à Paris, J+30 à travers les changements d'heure, retards, validation des dates.
- `src/lib/server/auth/auth.test.ts` — validation, Argon2id, création de comptes, sessions, cookie, blocage, commande `libraire:creer` et son point d'entrée `scripts/libraire-creer.ts`.
- `src/hooks.server.test.ts` — en-têtes, chargement de l'utilisateur, cookie invalide effacé, session expirée ou réutilisée après déconnexion, CSP.
- `src/security-config.test.ts` — CSRF, CSP, absence de `{@html}`.
- `src/routes/page.server.test.ts` — catalogue public, `CatalogueTable`, `parseRecordId`, action `?/emprunter`, `/libraire/retours`, `/mes-prets`.
- `src/routes/connexion/page.server.test.ts` — connexion, blocage, `/deconnexion`.
- `src/routes/inscription/page.server.test.ts` — inscription.
- `src/routes/libraire/livres/nouveau/page.server.test.ts` — garde du layout `/libraire` et ajout de livre.
- `src/routes/health/server.test.ts` — `/health`.

**Tests négatifs d'autorisation existants :** champ `role` ignoré à l'inscription et à l'ajout de livre par un emprunteur ; emprunteur refusé (403) sur le layout `/libraire`, sur l'action d'ajout et sur l'action de retour, même pour son propre prêt ; anonyme redirigé vers `/connexion` sur ces écrans et actions ; libraire refusé (403) sur l'emprunt et sur `/mes-prets` ; rôle revérifié en base à l'emprunt (« une session au rôle périmé n'emprunte pas ») ; champ `userId` envoyé ignoré ; `/mes-prets` ne renvoie que les prêts de l'utilisateur de session, même avec des paramètres d'URL ajoutés ; le catalogue ne révèle pas l'emprunteur.

**Absent :** aucun test de bout en bout (pas de Playwright), aucun test en navigateur réel de la CSP ou de l'accessibilité, aucune mesure de couverture configurée.

### Evidence
- `vite.config.ts` : `include: ['src/**/*.{test,spec}.{js,ts}']`, `environment: 'node'`.
- `package.json` : `"test": "vitest run"`, `"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"`.
- `pipeline.v2.json` : `setup` (`npm ci --ignore-scripts`) et `gates` `diff-check`, `test`, `check`.
- `src/lib/server/db/index.ts` : `resolveDatabasePath` renvoie `:memory:` quand `VITEST` est défini.

### Alternatives
- **Playwright (bout en bout)** — Téléchargement de navigateurs et démarrage d'un serveur. Les parcours existants sont couverts au niveau des `load` et des actions.
- **node:test** — Ne résout ni `$types`, ni les imports `.svelte`, ni les alias SvelteKit sans outillage supplémentaire.

### Trade-offs
- La vérification d'origine CSRF, les en-têtes réels du navigateur, la CSP appliquée et le comportement du cookie ne sont pas testés de bout en bout : seule la configuration l'est.
- Les gates `test` et `check` ne sont pas marquées `mandatory` dans `pipeline.v2.json` ; seule `diff-check` l'est.

### Reconsider when
- Les écrans de vente de l'incrément 2 arrivent : ajouter Playwright pour les parcours critiques et les refus d'accès en navigateur.
- Des composants interactifs côté client apparaissent : ajouter des tests de composants en navigateur.
- Un workflow CI est créé : y reprendre les mêmes commandes que les gates.

## 8. Persistance SQLite locale avec better-sqlite3, migrations ordonnées via `PRAGMA user_version` et tables `STRICT`.

**Nouvelle (incrément 1).** Une base fichier embarquée suffit pour un seul commerce et évite un serveur de base et ses secrets. better-sqlite3 est synchrone, ce qui rend les transactions (emprunt, retour, session) simples à raisonner dans un seul processus.

- `openDatabase(path)` crée le dossier parent si besoin, active `PRAGMA foreign_keys = ON`, passe en `journal_mode = WAL` pour les fichiers (pas pour `:memory:`) puis appelle `migrate`. En cas d'erreur, la connexion est fermée.
- `resolveDatabasePath(env)` renvoie `LIBRAIRIE_DB_PATH` s'il est défini, `:memory:` sous Vitest (`VITEST`), sinon `data/librairie.db` (`DEFAULT_DATABASE_PATH`). `data/` est ignoré par Git.
- `getDb()` ouvre et migre une connexion partagée du processus au premier appel ; `closeDb()` la ferme.
- `migrate(db)` applique chaque migration non appliquée dans sa propre transaction et fixe `user_version`. Il **refuse une base dont `user_version` dépasse `LATEST_SCHEMA_VERSION`** (erreur « Schéma de base en version … plus récent … »). Une seule migration existe à `ac9b34f`.
- Schéma : `users` (e-mail unique normalisé par CHECK, `display_name` non vide, `password_hash`, `role` limité à `borrower`/`bookseller`), `sessions` (`token_hash` en clé primaire, `ON DELETE CASCADE` vers `users`), `login_failures` (par e-mail normalisé), `books` (titre et auteur non vides), `loans` (`ON DELETE RESTRICT` vers `books` et `users`, dates vérifiées par `date(x) IS x`, `due_on >= borrowed_on`, `returned_on` nul ou postérieur). Toutes les tables sont `STRICT`.
- Index : `loans_one_active_per_book` (unique partiel `WHERE returned_on IS NULL`), `loans_user_id`, `loans_active_due_on`, `sessions_user_id`, `sessions_expires_at`.
- Formats : dates de prêt en dates calendaires `AAAA-MM-JJ` (Europe/Paris), instants de session et de blocage en millisecondes epoch.

### Evidence
- `src/lib/server/db/index.ts` : `MIGRATIONS`, `LATEST_SCHEMA_VERSION`, `migrate`, `openDatabase`, `resolveDatabasePath`, `getDb`, commentaire de tête (« Ne jamais modifier une migration publiée : en ajouter une nouvelle à la fin »).
- `src/lib/server/db/db.test.ts` : clés étrangères actives, rejeu sans changement, refus du schéma plus récent, second prêt actif refusé, pas de cascade vers les prêts, base sur fichier rouverte avec ses données, résolution du chemin.
- `.gitignore` : `data/` (« Base SQLite locale (data/librairie.db et fichiers WAL) »).
- `package.json` : `"better-sqlite3": "^13.0.3"`.

### Alternatives
- **PostgreSQL** — Serveur séparé, secrets de connexion et hébergement à choisir, sans besoin de concurrence multi-processus aujourd'hui.
- **ORM (Drizzle, Prisma)** — Génération de code et dépendances supplémentaires pour un schéma de cinq tables. Les contraintes métier critiques (prêt actif unique, dates valides) sont exprimées directement en SQL.
- **Migrations dans des fichiers `.sql` séparés** — Possible, mais le tableau en TypeScript garde l'ordre explicite et se charge aussi sans Vite depuis la commande locale.

### Trade-offs
- Un seul processus écrivain en pratique : une montée en charge horizontale n'est pas possible sans changer de base.
- Aucune migration descendante : un retour arrière de version de l'application est refusé si le schéma a avancé.
- Aucune sauvegarde n'est organisée. Le fichier de base et ses fichiers WAL contiennent des données personnelles et des hachages.
- Aucune suppression en cascade des utilisateurs vers les prêts : la suppression de compte devra anonymiser (incrément 3), pas supprimer.

### Reconsider when
- Plusieurs instances de l'application doivent écrire simultanément, ou l'hébergement choisi n'offre pas de disque persistant : passer à un serveur de base.
- L'incrément 2 ou 3 modifie le schéma : ajouter une migration à la fin de `MIGRATIONS`, sans jamais modifier la première.
- L'application est déployée : définir sauvegarde, restauration et permissions du fichier de base.

## 9. Authentification par e-mail et mot de passe (Argon2id), sessions opaques stockées hachées en base, blocage après 5 échecs sur 15 minutes.

**Nouvelle (incrément 1).** Choix « Paquets éprouvés » de l'opérateur : e-mail et nom affiché, pas de reset par e-mail ni de 2FA en v1. L'implémentation s'appuie sur des primitives maintenues (`argon2`, `node:crypto`) plutôt que sur une bibliothèque d'authentification complète.

- **Validation** (`validateAccount`) : e-mail normalisé (`normalizeEmail` : trim et minuscules), au plus `EMAIL_MAX_LENGTH` = 254 caractères, sans caractère de contrôle ; nom affiché de 1 à `DISPLAY_NAME_MAX_LENGTH` = 80 caractères, sans caractère de contrôle ; mot de passe de `PASSWORD_MIN_LENGTH` = 12 à `PASSWORD_MAX_LENGTH` = 256 caractères, pris tel quel (sans trim).
- **Mots de passe** : `ARGON2_OPTIONS` = Argon2id, `memoryCost` 19 456 KiB, `timeCost` 2, `parallelism` 1. `verifyPassword` refuse un mot de passe vide ou de plus de 256 caractères sans calcul Argon2, et renvoie faux pour un hachage illisible. Pour un e-mail inconnu, une vérification factice (`verifyDummyPassword`) égalise le coût.
- **Création de comptes** : e-mail déjà pris refusé avec `EMAIL_TAKEN_MESSAGE`, y compris en cas de course (violation d'unicité interceptée). Seul le hachage est stocké.
- **Sessions** : jeton de 32 octets CSPRNG (`randomBytes`) en base64url ; seule l'empreinte SHA-256 (`hashSessionToken`) est stockée. Expiration absolue de 7 jours (`SESSION_DURATION_SECONDS`), jamais prolongée par l'usage. Un jeton mal formé, inconnu ou expiré donne un visiteur anonyme, et une session expirée rencontrée est supprimée. `createSession` purge les sessions expirées.
- **Cookie** `session` (`SESSION_COOKIE_OPTIONS`) : `path: '/'`, `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `maxAge` de 7 jours.
- **Connexion** (`login`) : blocage vérifié avant et après la vérification du mot de passe ; message unique `LOGIN_FAILED_MESSAGE` (« E-mail ou mot de passe incorrect. ») pour un e-mail inconnu comme pour un mauvais mot de passe ; en cas de succès, remise à zéro des échecs, suppression de la session précédente du cookie reçu et création d'une nouvelle session.
- **Blocage** : `MAX_LOGIN_FAILURES` = 5 échecs dans `LOGIN_FAILURE_WINDOW_MS` = 15 minutes, par e-mail normalisé, que le compte existe ou non. La fenêtre s'ouvre au premier échec et n'est jamais prolongée. Pendant le blocage, même le bon mot de passe est refusé ; la route répond 429 avec l'heure de fin à Paris.
- **Hook** : `src/hooks.server.ts` lit le cookie, appelle `validateSessionToken` et place l'utilisateur dans `event.locals.user`. Un cookie invalide est effacé (`deleteSessionCookie`).
- **Déconnexion** : action POST de `/deconnexion`, qui supprime la session en base et le cookie.

### Evidence
- `src/lib/server/auth/index.ts` : constantes et fonctions citées.
- `src/lib/server/auth/auth.test.ts` : paramètres Argon2id au moins égaux au minimum OWASP, jeton de 32 octets dont seule l'empreinte est stockée, validité à 7 j − 1 min sans prolongation puis expiration, cookie HttpOnly, Secure, SameSite=Lax, Path=/ de 604800 s, blocage au 5e échec, fenêtre non prolongée, e-mail inexistant bloqué, vérification factice.
- `src/routes/connexion/page.server.test.ts` et `src/hooks.server.test.ts` : message identique, 429 avec heure de Paris, remplacement du cookie préexistant, cookie invalide effacé, jeton refusé après déconnexion.

### Alternatives
- **Lucia, Auth.js ou better-auth** — Plus de surface et de dépendances pour un besoin limité à e-mail et mot de passe sans fournisseur externe.
- **Sessions JWT sans état** — Pas de révocation simple à la déconnexion, et un jeton exposé resterait valide jusqu'à expiration.
- **bcrypt ou scrypt** — Acceptables, mais Argon2id est l'option recommandée en premier pour le stockage de mots de passe.

### Trade-offs
- Le blocage par e-mail permet à un tiers de bloquer temporairement la connexion d'un compte connu en échouant 5 fois. Aucune limitation par adresse IP n'existe.
- Sans reset par e-mail, un mot de passe oublié n'a pas de parcours en libre-service.
- Aucun événement de connexion, d'échec ou de blocage n'est journalisé (voir décision 6).
- `secure: true` suppose HTTPS en production.

### Reconsider when
- L'incrément 3 ajoute la journalisation de sécurité : y inclure connexions, échecs, blocages et refus d'accès, selon le format et la destination à décider.
- Le blocage ciblé d'un compte devient un abus observé : ajouter une limitation par IP ou un délai progressif.
- Product décide d'ajouter reset par e-mail ou 2FA (exclus en v1).

## 10. Deux rôles (`borrower`, `bookseller`), contrôle d'accès côté serveur dans chaque `load` et chaque action, libraire créé uniquement par la commande locale `npm run libraire:creer`.

**Nouvelle (incrément 1).** L'inscription publique ne crée que des emprunteurs. Le compte libraire, qui peut ajouter des livres et enregistrer des retours, n'est jamais créable depuis le web. Il est créé sur le poste par la commande locale, qui refuse tout mot de passe passé en argument.

| Route | Accès | Garde et comportement |
|---|---|---|
| `/` (catalogue) | Public | `load` : `listCatalogue` (id, titre, auteur, statut). Action `?/emprunter` : `requireBorrower` avant toute lecture du formulaire, `parseRecordId`, `borrowBook` ; 400 identifiant mal formé, 404 livre inexistant, 409 déjà emprunté, 403 si le rôle n'est plus emprunteur en base. |
| `/connexion` | Public | `load` : `accountCreated` seulement si `inscription` vaut exactement `1`. Action : `login` ; 400 message générique, 429 blocage ; redirection 303 fixe vers `/libraire/retours` (libraire) ou `/` (emprunteur). |
| `/inscription` | Public | Action : `createBorrower` ; aucun champ `role` n'est lu ; pas de connexion automatique ; redirection vers `/connexion?inscription=1`. |
| `/deconnexion` | Public | `load` (GET) : redirection vers `/` sans déconnexion. Action (POST) : `deleteSession` et `deleteSessionCookie`. |
| `/mes-prets` | Emprunteur | `load` : `requireBorrower`, puis `listBorrowerLoans(db, borrower.id)` ; l'utilisateur vient uniquement de la session. |
| `/libraire/**` | Libraire | `+layout.server.ts` : `requireBookseller` pour le rendu. Les actions ne passant pas par les `load`, chaque action rappelle `requireBookseller`. |
| `/libraire/livres/nouveau` | Libraire | Garde du layout ; action : `requireBookseller`, puis `addBook`. |
| `/libraire/retours` | Libraire | `load` : `requireBookseller` (en plus du layout), `listActiveLoans`. Action : `requireBookseller`, `parseRecordId`, `recordReturn` ; 400, 404 ou 409. |
| `/health` | Public | `GET` : `{ status: 'ok' }`, `cache-control: no-store`. |

- `requireBookseller` (dans `src/lib/server/catalogue/index.ts`) et `requireBorrower` (dans `src/lib/server/loans/index.ts`) redirigent un anonyme vers `/connexion` (303) et répondent 403 avec un message en français à l'autre rôle.
- `borrowBook` revérifie le rôle en base : l'insertion du prêt ne se fait que `FROM users WHERE users.id = ? AND users.role = 'borrower'`.
- `createBookseller` porte le commentaire « Réservé à la commande locale `libraire:creer` : aucune route web ne doit l'appeler ». Aucun fichier de route (`+page.server.ts`, `+layout.server.ts`, `+server.ts`) ne l'importe ; seuls des tests l'utilisent pour préparer un compte libraire.
- Commande `npm run libraire:creer -- --email <e-mail> --nom <nom affiché>` : `scripts/libraire-creer.ts` (point d'entrée) et `src/lib/server/auth/cli.ts` (logique). Tout argument ressemblant à un mot de passe est refusé sans être recopié, avant toute lecture. Le mot de passe est lu en invite masquée deux fois sur un terminal, ou sur la première ligne de l'entrée standard. La base n'est ouverte qu'après la saisie, et ni le mot de passe ni son hachage ne sont écrits en sortie. Codes de sortie : `EXIT_OK` 0, `EXIT_FAILURE` 1, `EXIT_USAGE` 2.

### Evidence
- `src/routes/**/+page.server.ts`, `src/routes/+layout.server.ts`, `src/routes/libraire/+layout.server.ts`, `src/routes/health/+server.ts`.
- `package.json` : `"libraire:creer": "node --experimental-strip-types scripts/libraire-creer.ts"`.
- Tests : `inscription/page.server.test.ts` (« ignore un champ role envoyé avec le formulaire »), `libraire/livres/nouveau/page.server.test.ts` (garde du layout, emprunteur refusé, champ `role` ignoré), `page.server.test.ts` (libraire refusé à l'emprunt, rôle périmé, `userId` ignoré, retour refusé à l'emprunteur propriétaire, `/mes-prets` isolé), `auth.test.ts` (commande et point d'entrée).

### Alternatives
- **Premier compte inscrit promu libraire** — Course à l'inscription sur une instance exposée.
- **Rôle choisi dans le formulaire d'inscription** — Élévation de privilège triviale.
- **Garde uniquement dans `hooks.server.ts` par préfixe d'URL** — Centralisée, mais moins explicite ; les gardes par `load` et action restent visibles et testées là où les données sont lues ou modifiées.

### Trade-offs
- Chaque nouvelle action doit penser à appeler sa garde : un oubli n'est détecté que par les tests de route.
- Un seul rôle libraire, sans gestion des libraires depuis l'interface (ni liste, ni désactivation).
- Le rôle est lu depuis la session à chaque requête ; seul l'emprunt le revérifie explicitement en base au moment de l'écriture.

### Reconsider when
- Le nombre de routes libraire augmente (écrans de vente de l'incrément 2) : envisager une garde supplémentaire par préfixe dans le hook, en plus des gardes par action.
- Plusieurs libraires ou des niveaux de droits distincts sont demandés.
- La commande locale n'est plus accessible (hébergement géré) : définir un parcours d'administration sûr.

## 11. Domaine prêt : catalogue de livres à exemplaire unique, emprunt immédiat de 30 jours, retour enregistré par le libraire, retards calculés en dates calendaires Europe/Paris avec horloge injectable.

**Nouvelle (incrément 1).** La fonction d'emprunt demandée par l'opérateur (« qui permet d'emprunter ») est livrée : emprunt, retour, retards et « Mes prêts ».

- **Dates** (`src/lib/server/dates.ts`) : `LIBRARY_TIME_ZONE = 'Europe/Paris'`. Seule la lecture de « maintenant » dépend du fuseau (`todayInParis(clock)`, `parisDateOf`). L'ajout de jours (`addCalendarDays`) et les comparaisons se font sur des dates `AAAA-MM-JJ` sans heure, donc sans effet des changements d'heure. `isOverdue(dueOn, today)` est vrai si et seulement si `today > dueOn` : le jour de l'échéance n'est pas un retard. `Clock = () => Date`, `systemClock` par défaut, et une horloge injectée dans les tests.
- **Catalogue** (`src/lib/server/catalogue/index.ts`) : `listCatalogue` renvoie tous les livres triés par titre puis auteur (collation française), avec le statut `available` ou `borrowed`, sans emprunteur ni échéance. `addBook` ajoute l'exemplaire unique d'un titre après `validateBook` : titre et auteur sans espaces autour, 1 à `BOOK_TEXT_MAX_LENGTH` = 200 caractères, sans caractère de contrôle.
- **Emprunt** (`borrowBook`) : `LOAN_DURATION_DAYS` = 30, du jour à Paris à J+30. La transaction `immediate` relit le livre et ses prêts actifs, puis insère le prêt en revérifiant le rôle. L'index unique partiel `loans_one_active_per_book` reste l'arbitre final entre deux emprunts concurrents : la violation d'unicité est traduite en `conflict`.
- **Retour** (`recordReturn`) : réservé au libraire (garde chez l'appelant). La transaction `immediate` fixe `returned_on` au jour à Paris, uniquement si le prêt est actif. Le prêt reste dans l'historique et le livre redevient disponible. Un double retour est refusé sans modifier la date enregistrée.
- **Listes** : `listActiveLoans` (comptoir du libraire) trie les prêts en cours par échéance croissante, donc les retards en tête, avec `overdue`. `listBorrowerLoans(db, userId, today)` renvoie les prêts d'un seul utilisateur : en cours par échéance croissante, rendus du plus récent au plus ancien.
- **Identifiants de formulaire** : `parseRecordId` n'accepte qu'un entier strictement positif écrit en chiffres (`/^[1-9][0-9]{0,15}$/`) et sûr, sinon `null`.

### Evidence
- `src/lib/server/dates.ts`, `src/lib/server/catalogue/index.ts`, `src/lib/server/loans/index.ts`.
- `src/lib/server/dates.test.ts` : J+30 à travers les changements d'heure de mars et d'octobre, bascule à minuit heure de Paris, retard dès le lendemain de l'échéance.
- `src/routes/page.server.test.ts` : prêt du jour à Paris jusqu'à J+30, 409 au second emprunt avec exactement un prêt actif, retour du jour à Paris, double retour refusé, badge de retard dès le lendemain.
- `src/lib/server/db/db.test.ts` : « refuse un second prêt actif pour le même livre », « autorise un nouveau prêt une fois le précédent rendu ».

### Alternatives
- **Entités livre et exemplaire séparées** — Non nécessaire tant que chaque titre n'a qu'un exemplaire de prêt ; ce serait une migration à part entière.
- **Horodatages UTC pour les échéances** — Exposés aux décalages de fuseau et aux changements d'heure. Une échéance est une date de calendrier local.
- **Réservation ou file d'attente** — Aucune règle de réservation n'a été décidée.

### Trade-offs
- Un seul exemplaire de prêt par titre : deux exemplaires identiques demandent deux livres au catalogue.
- Pas de prolongation, de limite de prêts par emprunteur ni de pénalité de retard : aucune de ces règles n'est implémentée ni décidée.
- L'historique des prêts rendus est conservé sans limite à `ac9b34f` : la conservation d'un an et la purge sont prévues à l'incrément 3.
- Le catalogue n'est ni paginé ni filtré.

### Reconsider when
- L'incrément 2 ajoute le stock de vente, indépendant de l'exemplaire de prêt unique : ne pas réutiliser `loans_one_active_per_book` pour la vente.
- L'incrément 2 ajoute les filtres serveur (disponibilité à la vente, disponibilité au prêt, recherche titre/auteur) : étendre `listCatalogue`, dont le commentaire prévoit déjà les colonnes de vente.
- L'incrément 3 implémente la purge de l'historique au-delà d'un an.
- Product décide de règles de réservation, de prolongation ou de limites.

## 12. Interface : base CSS partagée dans `src/lib/styles/app.css` et styles scopés par composant ou page, polices Cormorant Garamond et Inter embarquées, direction visuelle « Maison d'édition ».

**Nouvelle ; la direction « Maison d'édition » remplace « Functional high-contrast », qui n'est plus en vigueur.** Choix de l'opérateur : « Maison d'édition », polices « Oui, cette paire » (Cormorant Garamond + Inter). La direction est décrite ici comme en vigueur, sans évolution proposée.

- **Organisation CSS** : `src/lib/styles/app.css`, importé par `src/routes/+layout.svelte`, porte la base partagée : polices, jetons, typographie, en-tête, mise en page, formulaires, boutons, messages, tableaux, signaux de prêt et préférences utilisateur. Les styles propres à un seul composant ou à une seule page restent dans son bloc `<style>` : `src/lib/components/CatalogueTable.svelte`, `src/lib/components/LoanStatus.svelte`, `src/routes/+page.svelte`, `+error.svelte`, `mes-prets/+page.svelte`, `libraire/retours/+page.svelte`, `libraire/livres/nouveau/+page.svelte`. Aucune bibliothèque de composants ni framework CSS n'est utilisé.
- **Polices** : Cormorant Garamond (400, 500, 600, 700 et italiques 400, 500) et Inter (variable, graisses 100 à 900, normal et italique), en woff2 dans `static/fonts`, sous-ensemble latin, avec `OFL-cormorant-garamond.txt`, `OFL-inter.txt` et `README.md` (licence SIL OFL 1.1 et provenance). Les `@font-face` utilisent `font-display: swap` et des URL locales `/fonts/…`. Aucun CDN n'est utilisé, donc rien n'est à ouvrir dans la CSP. Aucun paquet npm de police n'est ajouté aux dépendances.
- **Direction « Maison d'édition »** : papier ivoire (`--ivory` #f8f4ea, `--paper` #f1eadb), encre bleu nuit (`--ink` #14213d, `--ink-2` #4a5068), laiton rare (`--brass` #a8843a, réservé aux filets et ornements, jamais au texte ni à un fond sous du texte ; `--brass-text` #7a5c1e et `--brass-light` #c9a55a pour les cas textuels documentés), états `--danger` #9b2c2c / `--danger-wash` #f6e4df et `--success` #2f5d3a / `--success-wash` #e6eee0. Titres en `--serif` (Cormorant Garamond), texte courant et interface en `--sans` (Inter), `--radius` de 2px, filet laiton sous le `h1`, losange laiton pour les états vides (`.empty`). L'espace libraire se distingue par un bandeau bleu nuit à bordure laiton et étiquette « Espace libraire » en laiton clair (`.site-header--libraire`).
- **Accessibilité inscrite dans le code** : contrastes WCAG des couples texte/fond calculés en commentaire de tête d'`app.css` ; `:focus-visible` (contour `--ink` de 2px décalé de 3px) ; lien d'évitement `.skip-link` vers `#contenu` ; bloc `prefers-reduced-motion: reduce` ; bloc `forced-colors: active` ; tableaux `.data--stack` empilés sous 40rem ; retard signalé par badge bordé, losange et texte (`.badge-overdue`), pas seulement par la couleur ; page active marquée par filet et graisse. États existants : `.empty`, `.notice--error`, `.notice--success`, `.btn[aria-busy]`, `.btn[aria-disabled]`. Mise en page : `--measure` 72rem, `--gutter` `clamp(1rem, 4vw, 2.5rem)`, grille `.auth` à deux colonnes à partir de 52rem. Aucun audit automatisé ni test navigateur d'accessibilité n'existe : aucune conformité WCAG n'est revendiquée.

### Evidence
- `src/lib/styles/app.css` : commentaire de tête (direction, contrastes, règle « base partagée / styles scopés »), `@font-face`, `:root`, sections En-tête, Mise en page, Formulaires, Boutons, Messages, Tables, Signaux de prêt, Préférences.
- `src/routes/+layout.svelte` : `import '$lib/styles/app.css'`, `.skip-link`, classe `site-header--libraire`.
- `static/fonts/README.md`, `static/fonts/OFL-cormorant-garamond.txt`, `static/fonts/OFL-inter.txt` et les huit fichiers `.woff2`.
- `src/security-config.test.ts` : aucune source distante autorisée dans la CSP, cohérent avec des polices locales.

### Alternatives
- **Bibliothèque de composants** — Imposerait une identité générique et des dépendances pour quelques écrans.
- **CSS utilitaire (Tailwind ou équivalent)** — Outillage de build supplémentaire. Les jetons CSS natifs suffisent.
- **Polices via CDN (Google Fonts)** — Exigerait d'ouvrir `style-src` et `font-src` à une origine tierce et exposerait les visiteurs à un tiers.
- **« Functional high-contrast »** — Direction précédente, remplacée par le choix de l'opérateur.

### Trade-offs
- Un seul thème clair (`color-scheme: light`) : pas de thème sombre.
- `style-src` non restreint dans la CSP (décision 6).
- Huit fichiers de police servis par l'application augmentent le poids initial ; `font-display: swap` évite de bloquer le texte.
- Les contrastes sont calculés à la main en commentaire, sans outil qui les revérifie.

### Reconsider when
- Un thème sombre est demandé.
- Les écrans de vente de l'incrément 2 sont conçus : les ajouter dans la même direction, avec une maquette approuvée.
- Des tests de bout en bout ou d'accessibilité automatisés sont ajoutés : vérifier en navigateur les engagements listés ci-dessus.

## Frontières de modules, responsabilités et conventions

**Responsabilités.**

| Module | Responsabilité | Ne fait pas |
|---|---|---|
| `src/lib/server/db/index.ts` | Ouverture de la base, pragmas, migrations, résolution du chemin, connexion partagée (`getDb`). | Aucune règle métier. |
| `src/lib/server/dates.ts` | Dates calendaires Europe/Paris, type `Clock`, `isOverdue`, `formatDateFr`. | Aucun accès à la base. |
| `src/lib/server/auth/index.ts` | Validation des comptes, Argon2id, création de comptes, sessions et cookie, blocage, `login`. | Pas de contrôle de rôle par route. |
| `src/lib/server/auth/cli.ts` | Logique de la commande `libraire:creer` (arguments, lecture du mot de passe, sortie). | N'ouvre pas la base : elle lui est injectée par `scripts/libraire-creer.ts`. |
| `src/lib/server/catalogue/index.ts` | `requireBookseller`, `listCatalogue`, `validateBook`, `addBook`. | Pas d'écriture de prêt. |
| `src/lib/server/loans/index.ts` | `requireBorrower`, `parseRecordId`, `borrowBook`, `recordReturn`, `listActiveLoans`, `listBorrowerLoans`. | Pas de création de compte. |
| `src/hooks.server.ts` | Chargement de `locals.user`, effacement d'un cookie invalide, en-têtes de sécurité. | Pas de garde de rôle. |
| `src/routes/**/+page.server.ts`, `+layout.server.ts` | Lecture du formulaire, appel de la garde et du module serveur, traduction du résultat en `fail`, `redirect` ou données. | Pas de SQL ni de règle métier. |
| `src/lib/components/*.svelte`, `src/routes/**/+page.svelte` | Présentation et styles scopés. | Pas d'accès serveur. |

**Conventions observables dans le code.**
- **La logique métier et le SQL vivent dans `src/lib/server/<module>`.** Les routes importent `$lib/server/...` et ne contiennent aucune requête. Voir `src/routes/libraire/retours/+page.server.ts`.
- **La base et l'horloge sont reçues en paramètre.** Chaque fonction prend `db: Db` en premier argument, et une `clock: Clock` (ou une date `today`) là où le temps compte, avec une valeur par défaut système. Commentaires de tête de `auth/index.ts` et `loans/index.ts`.
- **Le SQL passe exclusivement par des requêtes préparées à paramètres liés** (`db.prepare(...).run/get/all(params)`). Commentaires de tête de `catalogue/index.ts` et `loans/index.ts`. Seule exception documentée : l'entier interne de `PRAGMA user_version` dans `db/index.ts`.
- **Les gardes de rôle sont appelées dans chaque `load` et chaque action**, car les actions ne passent pas par les `load` : commentaire de `requireBookseller`, `src/routes/libraire/+layout.server.ts` et commentaires « Le layout /libraire ne protège pas les actions » dans `libraire/livres/nouveau` et `libraire/retours`. Une garde est appelée avant toute lecture du formulaire.
- **Les routes restent minces** : lecture du formulaire, garde, appel du module, traduction du résultat.
- **Les échecs attendus sont des résultats discriminés** (`{ ok: false, reason }` ou `{ ok: false, errors }`), et les erreurs d'infrastructure sont relancées.
- **Les entrées non fiables sont typées `unknown`** (`AccountInput`, `BookInput`, `LoginInput`) et validées côté serveur. Les identifiants passent par `parseRecordId`. Les valeurs renvoyées au formulaire après erreur n'incluent jamais le mot de passe.
- **Une migration publiée ne se modifie jamais** : on en ajoute une à la fin de `MIGRATIONS` (commentaire de tête de `db/index.ts`).
- **Les modules chargés par la commande locale** (`auth/index.ts`, `auth/cli.ts`, `db/index.ts`) n'utilisent ni alias `$lib` ni import relatif à l'exécution.
- **Les messages destinés aux utilisateurs sont en français** et exportés en constantes quand ils sont testés (`LOGIN_FAILED_MESSAGE`, `BOOKSELLER_ONLY_MESSAGE`, `BORROWER_ONLY_MESSAGE`, `LOAN_NOT_RETURNABLE_MESSAGE`…). Les noms de routes sont en français (`/connexion`, `/mes-prets`, `/libraire`), et les identifiants de code et de schéma en anglais.
- **Les tests sont colocalisés** (`*.test.ts` à côté du module ou de la route), en français, et utilisent une base `:memory:` et une horloge injectée.

## À venir

Cette section fixe ce qui reste à implémenter après l'incrément 1. **Rien de ce qui suit n'existe dans le code à `ac9b34f`.** Les règles marquées DÉCIDÉE ont été tranchées par l'opérateur ; leur source est indiquée. Les points marqués « à décider » ne sont pas tranchés et ne doivent pas être inventés par une implémentation. Découpage : **DÉCIDÉE** — incrément 2 = vente, prix, réassort, filtres ; incrément 3 = suppression de compte, conservation 1 an, journalisation de sécurité (source : « Lending core first (Recommended) »).

### Incrément 2 — vente, prix, réassort, filtres

| Règle | Statut | Source |
|---|---|---|
| Vente incluse en v1 : prix, stock de vente et enregistrement des ventes. | **DÉCIDÉE** | Q-sales-scope : « Inclure la vente en v1 » |
| Vente saisie au comptoir par le libraire, sans achat en ligne ni paiement. | **DÉCIDÉE** | « I approve all 12 » |
| Stock de vente indépendant de l'exemplaire de prêt unique. | **DÉCIDÉE** | « I approve all 12 » |
| Prix en euros stockés en centimes entiers. | **DÉCIDÉE** | « I approve all 12 » |
| Filtres serveur simples : disponibilité à la vente, disponibilité au prêt, recherche texte sur titre et auteur. | **DÉCIDÉE** | « Add filters in v1 » |
| Réassort : inclus dans l'incrément 2. | **DÉCIDÉE** | « Lending core first (Recommended) » |
| TVA. | à décider | — |
| Seuils de réassort. | à décider | — |

### Incrément 3 — suppression de compte, conservation, journalisation

| Règle | Statut | Source |
|---|---|---|
| Suppression de compte refusée tant qu'un prêt est en cours, avec reconfirmation du mot de passe. | **DÉCIDÉE** | « I approve all 12 » |
| Purge de l'historique à l'ouverture de la base et lors des emprunts et retours. | **DÉCIDÉE** | « I approve all 12 » |
| Historique des prêts rendus gardé 1 an. | **DÉCIDÉE** | « Paquets éprouvés » |
| Anonymisation de l'historique à la suppression de compte. | **DÉCIDÉE** | « Paquets éprouvés » |
| Données emprunteur limitées à l'e-mail et au nom affiché, pas de téléphone. | **DÉCIDÉE** | « Paquets éprouvés » |
| Pas de réinitialisation du mot de passe par e-mail ni de 2FA en v1. | **DÉCIDÉE** | « Paquets éprouvés » |
| Journalisation de sécurité : incluse dans l'incrément 3. | **DÉCIDÉE** | « Lending core first (Recommended) » |
| Format et destination des journaux de sécurité. | à décider | — |
| Conservation des comptes inactifs. | à décider | — |

Remarques :
- Les données limitées à l'e-mail et au nom affiché, ainsi que l'absence de reset par e-mail et de 2FA, sont déjà respectées par l'incrément 1 (décision 9). Elles restent des contraintes pour les incréments suivants.
- La base prépare l'anonymisation : aucune suppression en cascade des utilisateurs vers les prêts (`ON DELETE RESTRICT`, commentaire de tête de `db/index.ts`).
- « I approve all 12 » couvre douze précisions. Seules les cinq reprises ci-dessus sont documentées ici ; les sept autres ne sont pas reproduites dans ce document et ne doivent pas en être déduites.
- Toute autre règle (durées, montants, seuils, formats) n'est pas décidée tant qu'elle n'apparaît pas dans DECISIONS.json ou dans une spec approuvée.

---

Ce fichier décrit l'architecture réelle du commit `ac9b34f`, vérifiée dans le code. Les décisions confirmées de l'opérateur font autorité dans `.agent-pipeline/DECISIONS.json`. Si ce fichier et le code divergent, le code fait foi. Les choix d'architecture dérivés sont à réexaminer lorsque leurs déclencheurs se produisent.
