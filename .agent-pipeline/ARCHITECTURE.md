# Architecture rationale

Une seule application SvelteKit 2 (Svelte 5, TypeScript strict, Vite), gérée avec npm et un `package-lock.json` commité, pour une « librairie + prêt » : un commerce qui vend des livres et propose en plus un service de prêt. L'incrément 1 (prêt), l'incrément 2 (vente au comptoir, prix, réassort, filtres du catalogue) et la spec A de l'incrément 3 (journal de sécurité) sont en place sur la branche `main`. Une base SQLite locale (better-sqlite3, migrations versionnées par `PRAGMA user_version`, schéma en version 3) stocke les comptes (avec la date de dernière connexion), les sessions, les échecs de connexion, les livres (avec prix en centimes et stock de vente), les prêts, les ventes et les événements de sécurité. Il existe deux rôles. L'emprunteur s'inscrit librement, emprunte depuis le catalogue public filtrable et consulte « Mes prêts ». Le libraire est créé uniquement par la commande locale `npm run libraire:creer`, ajoute des livres, enregistre les retours, gère prix, ventes et réassort depuis `/libraire/vente`, et consulte le journal de sécurité en lecture seule sur `/libraire/journal`. Aucun achat en ligne ni paiement n'existe, et le stock de vente chiffré n'est visible que dans l'espace libraire. Les mots de passe sont hachés en Argon2id et le jeton de session est stocké sous forme d'empreinte SHA-256. La connexion est bloquée après 5 échecs sur 15 minutes. Six événements sont journalisés en base (connexion réussie, connexion échouée, début de blocage, tentative pendant un blocage, inscription, refus d'accès 403), avec l'e-mail normalisé tenté ; la fonction de purge au-delà d'un an calendaire de Paris existe mais n'est appelée nulle part. Le domaine suit des dates calendaires Europe/Paris : prêt de 30 jours de l'exemplaire unique d'un titre, retards signalés dès le lendemain de l'échéance. La logique métier et le SQL vivent dans `src/lib/server/<module>`, et les routes restent minces. La sécurité web repose sur une CSP en mode auto, un hook d'en-têtes, la vérification d'origine par défaut de SvelteKit et le cookie `SameSite=Lax`. Il n'y a ni HSTS, ni workflow CI, ni journalisation de l'adresse IP ou de l'agent utilisateur, ni export des journaux. L'interface suit la direction « Maison d'édition » (Cormorant Garamond et Inter embarquées). La suppression de compte, l'anonymisation, les tombstones et les purges automatiques (spec B de l'incrément 3) restent à implémenter, et la TVA comme les seuils de réassort restent à décider : voir « À venir ».

> **Sources d'autorité.** `.agent-pipeline/DECISIONS.json` fait autorité pour les décisions confirmées de l'opérateur. Le code du dépôt fait foi pour l'état réel de l'application. Ce document décrit ce code dans l'état actuel de la branche `main` (fin de la spec A de l'incrément 3). En cas d'écart, il faut corriger ce document, pas le code.

Project type: fullstack

## 1. Framework SvelteKit 2 avec Svelte 5, utilisé en full-stack : pages, `load`, form actions et endpoints serveur dans la même application.

**En vigueur.** L'opérateur a explicitement demandé SvelteKit. La variante full-stack est désormais pleinement exploitée : le catalogue et ses filtres GET, l'emprunt, les retours, la vente au comptoir, le prix, le réassort, l'inscription, la connexion et la déconnexion passent par des `load` et des form actions côté serveur, avec l'accès à la base SQLite dans le même processus. Aucun second service n'a été nécessaire, et les form actions bénéficient de la vérification d'origine intégrée à SvelteKit (voir décision 6).

### Evidence
- Précision de l'opérateur : « je veux ca SvelteKit » (`D-stack-sveltekit`, confirmée dans DECISIONS.json).
- Demande initiale : « Je veux faire une app de gestion de librairie, qui permet d'emprunter » (`D-borrowing-capability`, confirmée). Domaine précisé par l'opérateur : « Librairie + prêt » (Q-domain-librairie).
- `src/routes/+page.server.ts` (catalogue, filtres et action `emprunter`), `src/routes/libraire/retours/+page.server.ts` (retours), `src/routes/libraire/vente/+page.server.ts` (actions `prix`, `vendre`, `reassortir`), `src/routes/connexion/+page.server.ts`, `src/routes/inscription/+page.server.ts`, `src/routes/deconnexion/+page.server.ts`, `src/routes/mes-prets/+page.server.ts`, `src/routes/health/+server.ts`.
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

**En vigueur.** Le modèle de domaine existe désormais : utilisateurs, rôles, sessions, livres, prêts et ventes. Il est typé par des types explicites (`AuthUser`, `Role`, `CatalogueEntry`, `CatalogueFilters`, `BorrowResult`, `ReturnResult`, `BorrowerLoans`, `SaleCounterEntry`, `SaleResult`, `RestockResult`, `PriceResult`…) et par des résultats discriminés `{ ok: true } | { ok: false }` plutôt que par des exceptions pour les échecs attendus. Les types de route générés (`./$types`) couvrent chaque `load` et chaque action.

### Evidence
- `tsconfig.json` : `"strict": true`, étend `.svelte-kit/tsconfig.json`.
- `package.json` : `"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"`.
- `src/lib/server/auth/index.ts`, `src/lib/server/catalogue/index.ts`, `src/lib/server/loans/index.ts` et `src/lib/server/sales/index.ts` exportent des types de résultat discriminés (`SalesFailure<Reason>` pour la vente, le réassort et le prix).
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
- `package-lock.json` présent depuis l'incrément 1 et inchangé par l'incrément 2 dans ses dépendances d'exécution, avec les entrées `node_modules/argon2` et `node_modules/better-sqlite3`.
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

**Remplacée par les décisions 8 (persistance SQLite et migrations), 9 (authentification, sessions et blocage), 10 (rôles, contrôle d'accès et commande libraire locale), 11 (domaine prêt) et 13 (domaine vente, prix, réassort et filtres).** Au bootstrap, le schéma et les règles d'emprunt n'étaient pas décidés, et les coder serait revenu à inventer des règles. Les deux déclencheurs prévus se sont produits : Product a validé l'incrément 1 (prêt), et des données d'emprunteurs (e-mail, nom affiché) ont été introduites avec authentification, autorisation côté serveur et tests négatifs. Cette décision n'est plus en vigueur. L'entrée `D-no-persistence-auth-yet` de DECISIONS.json est gérée par le contrôleur.

### Evidence
- `src/lib/server/db/index.ts` (tables `users`, `sessions`, `login_failures`, `books`, `loans`, puis `sales` en v2), `src/lib/server/auth/index.ts`, `src/lib/server/catalogue/index.ts`, `src/lib/server/loans/index.ts`, `src/lib/server/sales/index.ts`.
- Décisions opérateur : « qui permet d'emprunter » (emprunt, retour, retards, « Mes prêts ») ; « Paquets éprouvés » (e-mail + nom affiché, pas de téléphone).

### Alternatives
- **Garder le squelette sans domaine** — Contredirait la fonction d'emprunt désormais livrée.

### Trade-offs
- L'application détient maintenant des données personnelles (e-mail, nom affiché, historique de prêts) et des hachages de mots de passe dans `data/librairie.db`.

### Reconsider when
- Sans objet : la décision est remplacée. Voir les conditions de révision des décisions 8 à 11.

## 6. Sécurité web : CSP SvelteKit en mode auto, hook d'en-têtes, protection CSRF par vérification d'origine et cookie `SameSite=Lax`, SQL paramétré et échappement Svelte.

**En vigueur, étendue depuis le bootstrap.** Voici les contrôles présents dans le code actuel de `main`, et seulement eux. L'incrément 2 n'a modifié ni le hook, ni la configuration CSP et CSRF, ni le code du module d'authentification. La spec A de l'incrément 3 a ajouté la journalisation de sécurité décrite ci-dessous ; elle n'a touché ni la configuration CSP et CSRF, ni les en-têtes du hook.

- **CSP** (`kit.csp`, mode `auto`) : `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. SvelteKit ajoute nonces ou hashes à ses propres scripts inline. `style-src` et `default-src` ne sont **volontairement pas restreints** : Vite et les transitions Svelte injectent des styles inline.
- **Hook `handle`** (`src/hooks.server.ts`) : ajoute `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin` et `x-frame-options: DENY`, sans écraser un en-tête déjà défini par la route. `/health` répond avec `cache-control: no-store`.
- **CSRF** : aucun jeton CSRF personnalisé n'existe. La protection repose sur la vérification d'origine par défaut des form actions SvelteKit (`csrf.checkOrigin` n'est pas désactivé et aucune `trustedOrigins` n'est déclarée) et sur le cookie de session `SameSite=Lax`. La déconnexion n'a lieu que sur POST : un GET sur `/deconnexion` redirige vers `/` sans rien supprimer.
- **Injection SQL** : toutes les requêtes passent par des requêtes préparées better-sqlite3 à paramètres liés. La seule interpolation de valeur est `PRAGMA user_version = ${Number(nextVersion)}`, un entier interne, car PRAGMA n'accepte pas de paramètre lié. `listCatalogue` assemble sa clause `WHERE` à partir de fragments SQL constants uniquement ; le terme de recherche passe par des paramètres liés, avec les jokers `%`, `_` et `\` échappés (`LIKE … ESCAPE '\'`).
- **Validation des saisies de vente** : prix, stock et quantités sont validés côté serveur avec des bornes explicites (décision 13) avant toute écriture, et les contraintes `CHECK` du schéma restent l'arbitre final. Le prix d'une vente est toujours lu en base : un prix, un total, un rôle ou un identifiant de libraire envoyés par le formulaire sont ignorés.
- **XSS** : échappement par défaut de Svelte. Aucun `{@html}` n'est utilisé dans les composants, et un test le vérifie.
- **Redirections** : destinations fixes après connexion (`/libraire/retours` ou `/`) et inscription (`/connexion?inscription=1`). Aucun paramètre de redirection n'est accepté.
- **Données exposées au navigateur** : `src/routes/+layout.server.ts` ne transmet que `displayName` et `role` (ni id ni e-mail). Le catalogue public ne montre ni emprunteur, ni échéance, ni stock de vente chiffré : seulement le prix et « En vente » ou « Épuisé » (la requête de `listCatalogue` ne sélectionne pas `sale_stock`). Les filtres renvoyés au navigateur sont les valeurs normalisées, pas les paramètres bruts.

- **Journalisation de sécurité** (spec A de l'incrément 3, `src/lib/server/security-log/index.ts`, table `security_events`) : six événements sont écrits en base — connexion réussie (`login_success`), connexion échouée (`login_failure`), début de blocage (`lockout_started`), tentative reçue pendant un blocage (`lockout_attempt`), inscription réussie (`signup`) et refus d'accès (`access_denied`, réponse 403 à un utilisateur connecté). Le type `account_deleted` figure dans la liste fermée du schéma mais **n'est écrit par aucun code** (spec B). Chaque événement porte son instant en millisecondes epoch, le compte concerné quand il existe et un `subject` court : l'**e-mail normalisé tenté** pour les événements de connexion (y compris quand aucun compte ne correspond, décision de l'opérateur « Garder l'e-mail tenté ») et le chemin demandé pour un refus d'accès. `normalizeSecuritySubject` retire les caractères de contrôle, ôte les espaces de bord et borne le sujet à 254 caractères ; le reste est conservé littéralement, comme donnée. Ni mot de passe, ni hachage, ni jeton de session ne sont journalisés, et un test parcourt toutes les colonnes pour le vérifier. La rétention est d'un an en **date calendaire Europe/Paris** (`securityLogRetentionStart`) ; `purgeSecurityEvents` l'applique mais **n'est appelée nulle part** (spec B).
- **Point d'observation des refus d'accès** : un seul, dans `src/hooks.server.ts` (`logAccessDenied`), sur la réponse de statut 403 quand `event.locals.user` existe. Les signatures de `requireBookseller` et `requireBorrower` et leurs appelants sont inchangés ; un anonyme, redirigé en 303 vers `/connexion`, ne produit aucun événement.
- **Consultation** : `/libraire/journal`, page en lecture seule réservée au libraire (garde du layout `/libraire` et `requireBookseller` dans son `load`). Elle n'exporte aucune action, ne lit rien de l'URL et rend au plus `SECURITY_EVENT_LIST_LIMIT` = 100 événements, échappés par Svelte.

**N'existe pas encore :** aucun enregistrement de l'adresse IP ni de l'agent utilisateur dans le journal (non décidé), aucun export ni filtre ni pagination du journal, aucun appel automatique de la purge, aucun en-tête `Strict-Transport-Security` (HSTS), aucun workflow CI (pas de répertoire `.github`), aucune limitation de débit par adresse IP, aucune alerte ni notification sur les événements journalisés, aucun audit de dépendances automatisé, aucun registre des réassorts ni des changements de prix (seules les ventes sont tracées, dans `sales`). Ni l'incrément 2 ni la spec A n'ont ajouté de dépendance. Ce document n'affirme aucune conformité OWASP.

### Evidence
- `svelte.config.js` : bloc `csp` et commentaire sur `style-src`.
- `src/hooks.server.ts` : constante `SECURITY_HEADERS`.
- `src/security-config.test.ts` : vérification d'origine laissée active, aucune origine générique, directives CSP restrictives, aucune source `*`, `https:`, `data:`, `unsafe-inline` ou `unsafe-eval`, aucun `{@html}` dans `src/**/*.svelte`.
- `src/hooks.server.test.ts` : en-têtes ajoutés sans écraser ceux de la route, directives CSP conservées.
- `src/routes/connexion/page.server.test.ts` : « ne déconnecte pas sur GET ». `src/routes/health/server.test.ts` : réponse non mise en cache.
- Tests « stocke littéralement une charge utile SQL » dans `db.test.ts`, `auth.test.ts`, `page.server.test.ts` et `libraire/livres/nouveau/page.server.test.ts`. Tests « rend un titre et un auteur hostiles comme du texte » et « affiche … un titre hostile comme du texte » dans `src/routes/page.server.test.ts`.
- Spec A de l'incrément 3 : `src/lib/server/security-log/index.ts` (commentaire de tête « la purge … n'est appelée nulle part »), `src/hooks.server.ts` (`logAccessDenied`), `src/routes/libraire/journal/+page.server.ts`. Tests : « n'écrit ni mot de passe, ni hachage, ni jeton dans les colonnes des événements » et « journalise un e-mail inconnu avec son sujet et sans compte » (`auth.test.ts`), « retire les caractères de contrôle du sujet et conserve le reste littéralement » et « refuse un type hors de la liste fermée sans rien écrire » (`security-log.test.ts`), « ne journalise rien pour un visiteur anonyme redirigé vers /connexion » et « journalise la 403 … une seule fois » (`hooks.server.test.ts`), « n'exporte aucune action : la route est en lecture seule », « ignore les paramètres d'URL et n'écrit rien » et « affiche les lignes dans la table .data, sans jamais interpréter le contenu stocké » (`libraire/journal/page.server.test.ts`).
- Incrément 2 : « traite les jokers % et _ littéralement » et « recherche une charge utile SQL littéralement, tables intactes » (`catalogue.test.ts`), « ne sélectionne pas sale_stock parmi les colonnes renvoyées par la requête » (`catalogue.test.ts`), « n'expose ni emprunteur ni stock chiffré… » et « rend un terme de recherche et un titre hostiles comme du texte » (`src/routes/page.server.test.ts`), « ignore le prix, le total, le rôle et l'auteur envoyés par le formulaire de vente » et « injection SQL » (`sales.test.ts`), « rend le stock chiffré… et un titre hostile comme texte » (`libraire/vente/page.server.test.ts`).

### Alternatives
- **Jeton CSRF synchronisé personnalisé** — Redondant avec la vérification d'origine intégrée pour des form actions de même origine, et source d'erreurs d'implémentation.
- **CSP stricte avec `default-src 'self'` et `style-src` restreint** — Casse l'injection de styles de Vite en développement et les transitions Svelte.
- **ORM ou constructeur de requêtes** — Le volume de SQL est faible, et les requêtes préparées suffisent à lier les paramètres.

### Trade-offs
- `style-src` reste permissif : une injection CSS reste possible si un jour du contenu non échappé était rendu.
- Le journal est consultable mais non surveillé : une force brute ou des refus d'accès répétés laissent désormais une trace, sans alerte ni notification, et seulement si le libraire ouvre `/libraire/journal`. Sans adresse IP ni agent utilisateur, une campagne visant plusieurs comptes ne se rattache à aucune origine.
- L'e-mail tenté est conservé un an, y compris pour un e-mail qui ne correspond à aucun compte : le journal contient donc des adresses de personnes n'ayant pas de compte, comme le fait déjà `login_failures`. Aucune purge automatique n'existe à ce jour : sans appel explicite de `purgeSecurityEvents`, le journal croît indéfiniment (spec B).
- La journalisation écrit dans la base pendant la requête : un échec d'écriture du journal remonte à l'appelant, et la journalisation du refus d'accès a lieu après le rendu de la réponse, sans la modifier.
- Le cookie de session est `Secure`, mais sans HSTS rien n'empêche une première requête en HTTP une fois l'application exposée.
- La CSRF dépend du maintien des valeurs par défaut de SvelteKit : `security-config.test.ts` protège contre leur désactivation.

### Reconsider when
- L'application est exposée derrière TLS : ajouter HSTS.
- **Atteint (incrément 3, spec A), traité :** la journalisation de sécurité est implémentée. Format et destination ont été tranchés par l'opérateur (« Table SQLite + page libraire ») : table `security_events` de la base existante et page `/libraire/journal`, sans nouvelle dépendance ni service externe. Restent à venir, en spec B, l'appel automatique de la purge et l'effacement des événements à la suppression d'un compte.
- Le journal doit être exploité hors de l'écran du libraire (export, filtres, pagination, alertes) ou enrichi de l'adresse IP ou de l'agent utilisateur : ces points ne sont pas décidés et rien ne doit être inventé.
- Un workflow CI est ajouté : appliquer le moindre privilège aux jetons et ne pas exécuter de code non fiable sur des déclencheurs `pull_request_target`.
- Des ressources tierces, des iframes ou une intégration dans un autre site deviennent nécessaires (CSP, `X-Frame-Options` et `frame-ancestors` à revoir).
- Une API non liée aux form actions (JSON, `+server.ts` qui modifie des données) est ajoutée : la vérification d'origine des form actions ne suffira plus à elle seule.

## 7. Tests Vitest en environnement node sur `src/**/*.{test,spec}.{js,ts}`, vérification de types par `npm run check`, gates du pipeline diff-check, test et check.

**En vigueur, étendue.** Vitest réutilise la configuration Vite et le plugin SvelteKit. Les tests appellent directement les `load`, les actions, le hook et les modules serveur sur une base `:memory:`, sans démarrer de serveur. Certains rendent des composants côté serveur avec `render` de `svelte/server`. Le pipeline installe les dépendances par `npm ci --ignore-scripts`, puis exécute trois gates : `diff-check` (`git diff --check`, obligatoire, sur toutes les voies), `test` (`npm run test`) et `check` (`npm run check`), ces deux derniers sur les voies `standard` et `high`.

Fichiers de test par module :
- `src/lib/server/db/db.test.ts` — migrations, clés étrangères, rejeu, refus d'un schéma plus récent, index unique partiel, contraintes CHECK (prêts, prix, stock, ventes, types d'événements et longueur du sujet), absence de cascade vers les prêts et les ventes, `ON DELETE SET NULL` de `security_events`, index de `sales` et de `security_events`, colonnes `users.last_login_at` et `users.deleted_at` nulles par défaut, migration d'une base v1 ou v2 existante, base sur fichier, `resolveDatabasePath`.
- `src/lib/server/dates.test.ts` — date du jour à Paris, J+30 à travers les changements d'heure, retards, validation des dates, `subtractCalendarYear` (29 février ramené au 28 février) et `startOfDayInParis` (heure d'été et d'hiver, jours de changement d'heure).
- `src/lib/server/security-log/security-log.test.ts` — `recordSecurityEvent` (liste fermée des types, e-mail tenté sans compte, horloge injectée, sujet borné et nettoyé, refus sans écriture), `listRecentSecurityEvents` (ordre, borne, nom affiché joint, compte supprimé), `securityLogRetentionStart` et `purgeSecurityEvents` (borne calendaire de Paris, 29 février, journal vide).
- `src/lib/server/catalogue/catalogue.test.ts` — forme des lignes du catalogue (sans stock chiffré), filtres (texte, prêt, vente, combinaison, valeurs ignorées, valeurs hostiles), `catalogueFiltersFromSearchParams`, validation et formatage des prix, stock de vente, `validateBook` et `addBook` avec prix et stock initial.
- `src/lib/server/sales/sales.test.ts` — `validateQuantity`, `listSaleCounter`, `recordSale`, `restockBook`, fixation, modification et retrait du prix, indépendance vente / prêt, injection SQL.
- `src/lib/server/auth/auth.test.ts` — validation, Argon2id, création de comptes, sessions, cookie, blocage, journalisation des connexions (succès daté dans `users.last_login_at`, échecs, début de blocage, tentative pendant le blocage, e-mail inconnu), commande `libraire:creer` et son point d'entrée `scripts/libraire-creer.ts`.
- `src/hooks.server.test.ts` — en-têtes, chargement de l'utilisateur, cookie invalide effacé, session expirée ou réutilisée après déconnexion, CSP, journalisation des refus d'accès.
- `src/routes/libraire/journal/page.server.test.ts` — autorisation de `/libraire/journal`, absence d'action, `load` (ordre, heure de Paris, liste vide) et rendu de la page (table `.data`, état vide `.empty`, contenu stocké rendu comme texte), lien « Journal » de la navigation libraire.
- `src/security-config.test.ts` — CSRF, CSP, absence de `{@html}`.
- `src/routes/page.server.test.ts` — catalogue public (colonnes prix et vente, filtres d'URL), `CatalogueTable`, page du catalogue (formulaire GET, états vides), `parseRecordId`, action `?/emprunter`, `/libraire/retours`, `/mes-prets`.
- `src/routes/connexion/page.server.test.ts` — connexion, blocage, `/deconnexion`.
- `src/routes/inscription/page.server.test.ts` — inscription et journalisation de l'inscription réussie.
- `src/routes/libraire/livres/nouveau/page.server.test.ts` — garde du layout `/libraire` et ajout de livre, avec prix et stock initial facultatifs.
- `src/routes/libraire/vente/page.server.test.ts` — autorisation de `/libraire/vente`, `load` et rendu de l'écran, actions `?/vendre`, `?/reassortir` et `?/prix`.
- `src/routes/health/server.test.ts` — `/health`.

**Tests négatifs d'autorisation existants :** champ `role` ignoré à l'inscription et à l'ajout de livre par un emprunteur ; emprunteur refusé (403) sur le layout `/libraire`, sur l'action d'ajout et sur l'action de retour, même pour son propre prêt ; anonyme redirigé vers `/connexion` sur ces écrans et actions ; libraire refusé (403) sur l'emprunt et sur `/mes-prets` ; rôle revérifié en base à l'emprunt (« une session au rôle périmé n'emprunte pas ») ; champ `userId` envoyé ignoré ; `/mes-prets` ne renvoie que les prêts de l'utilisateur de session, même avec des paramètres d'URL ajoutés ; le catalogue ne révèle pas l'emprunteur. Depuis l'incrément 2 : anonyme redirigé et emprunteur refusé (403) au chargement de `/libraire/vente` et sur chaque POST direct (`?/prix`, `?/vendre`, `?/reassortir`) sans rien écrire ; session au rôle périmé refusée (403) à la vente, stock inchangé ; champs `role`, `userId` et `booksellerId` ignorés, la vente étant attribuée au libraire de session ; emprunteur refusé (403) à l'ajout d'un livre avec prix et stock ; un GET avec des paramètres de vente ou de prix ne modifie rien ; le catalogue public n'expose jamais le stock chiffré. Depuis la spec A de l'incrément 3 : anonyme redirigé et emprunteur refusé (403) sur `/libraire/journal`, route qui n'exporte aucune action et ignore les paramètres d'URL sans rien écrire ; refus d'accès journalisé une seule fois par réponse 403, et rien journalisé pour un anonyme redirigé ni pour une 403 sans utilisateur de session ; type d'événement hors liste fermée et identifiant de compte non entier refusés sans écriture, le `CHECK` de la table refusant aussi un type inconnu inséré directement ; sujet hostile (caractères de contrôle, balises, charge utile SQL) stocké et rendu littéralement comme du texte ; ni mot de passe, ni hachage, ni jeton de session dans les colonnes des événements ; un compte supprimé laisse l'événement avec `user_id` nul.

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
- **Atteint (incrément 2), non traité :** les écrans de vente sont arrivés (`/libraire/vente`), mais les tests de bout en bout étaient hors du périmètre de l'incrément. Playwright n'est pas ajouté : les parcours de vente et leurs refus d'accès restent couverts au niveau des `load` et des actions. Ajouter Playwright reste à décider.
- Des composants interactifs côté client apparaissent : ajouter des tests de composants en navigateur.
- Un workflow CI est créé : y reprendre les mêmes commandes que les gates.

## 8. Persistance SQLite locale avec better-sqlite3, migrations ordonnées via `PRAGMA user_version` et tables `STRICT`.

**En vigueur depuis l'incrément 1 ; schéma passé en version 2 à l'incrément 2, puis en version 3 à la spec A de l'incrément 3.** Une base fichier embarquée suffit pour un seul commerce et évite un serveur de base et ses secrets. better-sqlite3 est synchrone, ce qui rend les transactions (emprunt, retour, session) simples à raisonner dans un seul processus.

- `openDatabase(path)` crée le dossier parent si besoin, active `PRAGMA foreign_keys = ON`, passe en `journal_mode = WAL` pour les fichiers (pas pour `:memory:`) puis appelle `migrate`. En cas d'erreur, la connexion est fermée.
- `resolveDatabasePath(env)` renvoie `LIBRAIRIE_DB_PATH` s'il est défini, `:memory:` sous Vitest (`VITEST`), sinon `data/librairie.db` (`DEFAULT_DATABASE_PATH`). `data/` est ignoré par Git.
- `getDb()` ouvre et migre une connexion partagée du processus au premier appel ; `closeDb()` la ferme.
- `migrate(db)` applique chaque migration non appliquée dans sa propre transaction et fixe `user_version`. Il **refuse une base dont `user_version` dépasse `LATEST_SCHEMA_VERSION`** (erreur « Schéma de base en version … plus récent … »). Trois migrations existent à ce jour : `LATEST_SCHEMA_VERSION` vaut 3.
- **Règle « ne jamais modifier une migration publiée » respectée** : la migration 1 (incrément 1) est restée telle quelle, la vente a été ajoutée par une migration 2 placée à la fin de `MIGRATIONS`, et le journal de sécurité par une migration 3 placée après elle. Une base v1 ou v2 existante passe en v3 à l'ouverture sans perdre ses comptes, livres, prêts ni ventes.
- Schéma v1 : `users` (e-mail unique normalisé par CHECK, `display_name` non vide, `password_hash`, `role` limité à `borrower`/`bookseller`), `sessions` (`token_hash` en clé primaire, `ON DELETE CASCADE` vers `users`), `login_failures` (par e-mail normalisé), `books` (titre et auteur non vides), `loans` (`ON DELETE RESTRICT` vers `books` et `users`, dates vérifiées par `date(x) IS x`, `due_on >= borrowed_on`, `returned_on` nul ou postérieur). Toutes les tables sont `STRICT`.
- Schéma v2 (vente au comptoir) :
  - `books` reçoit deux colonnes par `ALTER TABLE … ADD COLUMN`, sans reconstruction de la table : `price_cents INTEGER` (nul par défaut, sinon `CHECK (price_cents > 0)`), ce qui migre les livres existants sans leur inventer de prix, et `sale_stock INTEGER NOT NULL DEFAULT 0 CHECK (sale_stock >= 0)`, indépendant de l'exemplaire de prêt. SQLite vérifie ces `CHECK` sur les lignes existantes.
  - Nouvelle table `sales` (`STRICT`), registre des ventes : `book_id` (`ON DELETE RESTRICT` vers `books`), `bookseller_id` (`ON DELETE RESTRICT` vers `users`), `quantity > 0`, `unit_price_cents > 0` (prix unitaire figé au moment de la vente), `total_cents > 0 AND total_cents = quantity * unit_price_cents`, `sold_on` date calendaire vérifiée par `date(sold_on) IS sold_on`. Aucune donnée d'acheteur n'est stockée.
- Schéma v3 (journal de sécurité) :
  - `users` reçoit deux colonnes par `ALTER TABLE … ADD COLUMN`, toutes deux `INTEGER` nullables en millisecondes epoch, sans valeur inventée pour les comptes existants : `last_login_at`, écrit à chaque connexion réussie (décision 9), et `deleted_at`, **ajoutée pour la spec B et écrite par personne aujourd'hui**, afin que la suppression de compte n'ait ni à modifier une migration publiée ni à en ajouter une.
  - Nouvelle table `security_events` (`STRICT`) : `created_at INTEGER NOT NULL` (millisecondes epoch), `type TEXT NOT NULL` limité par un `CHECK` à une **liste fermée** de sept valeurs (`login_success`, `login_failure`, `lockout_started`, `lockout_attempt`, `signup`, `access_denied`, `account_deleted`, ce dernier n'étant écrit par aucun code à ce jour), `user_id INTEGER` nullable référençant `users` en `ON DELETE SET NULL` — et non le `RESTRICT` des prêts et des ventes — pour que le journal n'empêche jamais une suppression de compte ni ne pointe vers un compte absent, et `subject TEXT` nullable borné à 254 caractères par `CHECK` (longueur d'un e-mail).
  - Index : `security_events_created_at`, qui sert autant la lecture des derniers événements que la purge par borne de rétention.
  - **Rétention d'un an en date calendaire Europe/Paris** (même jour, année précédente ; 29 février ramené au 28 février), calculée par `src/lib/server/dates.ts` et appliquée par `purgeSecurityEvents`. Aucun déclenchement automatique n'existe : le schéma ne connaît pas la rétention, et rien n'appelle la purge (spec B).
- Index : `loans_one_active_per_book` (unique partiel `WHERE returned_on IS NULL`), `loans_user_id`, `loans_active_due_on`, `sessions_user_id`, `sessions_expires_at` ; en v2, `sales_book_id`, `sales_bookseller_id`, `sales_sold_on` ; en v3, `security_events_created_at`. L'index `loans_one_active_per_book` n'est pas utilisé pour la vente.
- Formats : dates de prêt et de vente en dates calendaires `AAAA-MM-JJ` (Europe/Paris), conservées en clair ; montants en centimes entiers d'euros ; instants de session, de blocage, de dernière connexion et d'événement de sécurité en millisecondes epoch.

### Evidence
- `src/lib/server/db/index.ts` : `MIGRATIONS` (trois éléments, commentaires « v2 : vente au comptoir » et « v3 : journal de sécurité » avant les deuxième et troisième), `LATEST_SCHEMA_VERSION`, `migrate`, `openDatabase`, `resolveDatabasePath`, `getDb`, commentaire de tête (« Ne jamais modifier une migration publiée : en ajouter une nouvelle à la fin »).
- `src/lib/server/db/db.test.ts` : clés étrangères actives, rejeu sans changement, refus du schéma plus récent, second prêt actif refusé, pas de cascade vers les prêts, contraintes de prix, de stock et de vente, « ne supprime pas en cascade les ventes d'un livre ou d'un libraire », « crée les index utiles de la table sales », « passe en v2 sans perdre les livres, prêts et comptes existants », « impose les contraintes de vente sur les livres migrés et se rejoue sans effet », base sur fichier rouverte avec ses données, résolution du chemin ; pour la v3 : « laisse last_login_at et deleted_at nuls sur un compte créé sans eux », « accepte des millisecondes epoch dans last_login_at et deleted_at, refuse du texte », contraintes de type et de longueur de sujet de `security_events`, remise à null de `user_id` à la suppression d'un compte, « crée les index utiles » de `security_events`, et migration d'une base existante vers v3 sans perdre ses données ni renseigner les nouvelles colonnes.
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
- Aucune suppression en cascade des utilisateurs vers les prêts ni vers les ventes, ni des livres vers les ventes : la suppression de compte devra anonymiser (spec B), pas supprimer. Un libraire ou un livre ayant des ventes ne peut pas être supprimé. `security_events` fait exception avec `ON DELETE SET NULL` : un événement survit à la disparition de son compte, sans le désigner.
- Les colonnes ajoutées par `ALTER TABLE` apparaissent en fin de table `books` et `users` : l'ordre physique des colonnes ne suit pas l'ordre logique.
- `users.deleted_at` existe sans code qui l'écrive ni qui la lise : une colonne inerte tant que la spec B n'est pas livrée, et une comparaison de lignes `users` entières doit en tenir compte.
- Le journal grandit sans borne tant que `purgeSecurityEvents` n'est appelée par personne ; seule la lecture est bornée, à 100 événements.
- Seules les ventes sont historisées : le stock courant et le prix courant sont écrasés par chaque réassort ou changement de prix, sans registre (décision 13).

### Reconsider when
- Plusieurs instances de l'application doivent écrire simultanément, ou l'hébergement choisi n'offre pas de disque persistant : passer à un serveur de base.
- **Atteint (incrément 2), traité :** le schéma a été modifié par l'ajout de la migration 2 à la fin de `MIGRATIONS`, sans modifier la première.
- **Atteint (incrément 3, spec A), traité :** le déclencheur « l'incrément 3 devra faire de même avec une migration 3 » s'est produit et a été honoré : la migration 3 (colonnes `users.last_login_at` et `users.deleted_at`, table `security_events`, index `security_events_created_at`) a été ajoutée à la fin de `MIGRATIONS`, sans toucher aux migrations 1 et 2. La spec B devra faire de même si elle a besoin du schéma : une migration 4 à la fin, `users.deleted_at` étant déjà en place pour éviter d'en arriver là.
- L'application est déployée : définir sauvegarde, restauration et permissions du fichier de base.

## 9. Authentification par e-mail et mot de passe (Argon2id), sessions opaques stockées hachées en base, blocage après 5 échecs sur 15 minutes.

**Nouvelle (incrément 1).** Choix « Paquets éprouvés » de l'opérateur : e-mail et nom affiché, pas de reset par e-mail ni de 2FA en v1. L'implémentation s'appuie sur des primitives maintenues (`argon2`, `node:crypto`) plutôt que sur une bibliothèque d'authentification complète.

- **Validation** (`validateAccount`) : e-mail normalisé (`normalizeEmail` : trim et minuscules), au plus `EMAIL_MAX_LENGTH` = 254 caractères, sans caractère de contrôle ; nom affiché de 1 à `DISPLAY_NAME_MAX_LENGTH` = 80 caractères, sans caractère de contrôle ; mot de passe de `PASSWORD_MIN_LENGTH` = 12 à `PASSWORD_MAX_LENGTH` = 256 caractères, pris tel quel (sans trim).
- **Mots de passe** : `ARGON2_OPTIONS` = Argon2id, `memoryCost` 19 456 KiB, `timeCost` 2, `parallelism` 1. `verifyPassword` refuse un mot de passe vide ou de plus de 256 caractères sans calcul Argon2, et renvoie faux pour un hachage illisible. Pour un e-mail inconnu, une vérification factice (`verifyDummyPassword`) égalise le coût.
- **Création de comptes** : e-mail déjà pris refusé avec `EMAIL_TAKEN_MESSAGE`, y compris en cas de course (violation d'unicité interceptée). Seul le hachage est stocké.
- **Sessions** : jeton de 32 octets CSPRNG (`randomBytes`) en base64url ; seule l'empreinte SHA-256 (`hashSessionToken`) est stockée. Expiration absolue de 7 jours (`SESSION_DURATION_SECONDS`), jamais prolongée par l'usage. Un jeton mal formé, inconnu ou expiré donne un visiteur anonyme, et une session expirée rencontrée est supprimée. `createSession` purge les sessions expirées.
- **Cookie** `session` (`SESSION_COOKIE_OPTIONS`) : `path: '/'`, `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `maxAge` de 7 jours.
- **Connexion** (`login`) : blocage vérifié avant et après la vérification du mot de passe ; message unique `LOGIN_FAILED_MESSAGE` (« E-mail ou mot de passe incorrect. ») pour un e-mail inconnu comme pour un mauvais mot de passe ; en cas de succès, remise à zéro des échecs, suppression de la session précédente du cookie reçu et création d'une nouvelle session.
- **Dernière connexion** (spec A de l'incrément 3) : `openSession` ouvre la session et écrit `users.last_login_at` dans une seule transaction, à partir d'une horloge lue une fois — un succès laisse les deux traces, ou aucune. La colonne reste nulle pour un compte qui ne s'est jamais connecté, et aucune route ne l'affiche à ce jour.
- **Journalisation des connexions** (spec A de l'incrément 3) : `login` journalise chacune de ses issues — `login_success`, `login_failure`, `lockout_started` (échec qui vient de déclencher le blocage) et `lockout_attempt` (tentative reçue pendant un blocage, jamais comptée comme un échec puisqu'elle n'est pas vérifiée). Le sujet est l'e-mail normalisé tenté, même sans compte correspondant ; le compte visé est rattaché quand il existe, y compris pour une tentative bloquée, le compte étant lu avant la vérification du blocage. Le module de journal est chargé par un `import` dynamique : un import relatif statique rendrait `auth/index.ts` inutilisable par la commande locale, qui ne se connecte pas et ne journalise donc rien. L'inscription est journalisée par la route `/inscription`, après la seule branche qui crée un compte, et non par `createAccount` : `libraire:creer` n'écrit ainsi rien dans le journal.
- **Blocage** : `MAX_LOGIN_FAILURES` = 5 échecs dans `LOGIN_FAILURE_WINDOW_MS` = 15 minutes, par e-mail normalisé, que le compte existe ou non. La fenêtre s'ouvre au premier échec et n'est jamais prolongée. Pendant le blocage, même le bon mot de passe est refusé ; la route répond 429 avec l'heure de fin à Paris.
- **Hook** : `src/hooks.server.ts` lit le cookie, appelle `validateSessionToken` et place l'utilisateur dans `event.locals.user`. Un cookie invalide est effacé (`deleteSessionCookie`).
- **Déconnexion** : action POST de `/deconnexion`, qui supprime la session en base et le cookie.

### Evidence
- `src/lib/server/auth/index.ts` : constantes et fonctions citées.
- `src/lib/server/auth/auth.test.ts` : paramètres Argon2id au moins égaux au minimum OWASP, jeton de 32 octets dont seule l'empreinte est stockée, validité à 7 j − 1 min sans prolongation puis expiration, cookie HttpOnly, Secure, SameSite=Lax, Path=/ de 604800 s, blocage au 5e échec, fenêtre non prolongée, e-mail inexistant bloqué, vérification factice.
- `src/routes/connexion/page.server.test.ts` et `src/hooks.server.test.ts` : message identique, 429 avec heure de Paris, remplacement du cookie préexistant, cookie invalide effacé, jeton refusé après déconnexion.
- `src/lib/server/auth/auth.test.ts`, journalisation : « journalise une connexion réussie et date la dernière connexion à l'instant de l'horloge », « journalise cinq échecs, le début de blocage, puis la tentative pendant le blocage », « journalise un e-mail inconnu avec son sujet et sans compte », « journalise un blocage sur un e-mail inexistant sans jamais l'attacher à un compte », « n'écrit ni mot de passe, ni hachage, ni jeton dans les colonnes des événements ».

### Alternatives
- **Lucia, Auth.js ou better-auth** — Plus de surface et de dépendances pour un besoin limité à e-mail et mot de passe sans fournisseur externe.
- **Sessions JWT sans état** — Pas de révocation simple à la déconnexion, et un jeton exposé resterait valide jusqu'à expiration.
- **bcrypt ou scrypt** — Acceptables, mais Argon2id est l'option recommandée en premier pour le stockage de mots de passe.

### Trade-offs
- Le blocage par e-mail permet à un tiers de bloquer temporairement la connexion d'un compte connu en échouant 5 fois. Aucune limitation par adresse IP n'existe.
- Sans reset par e-mail, un mot de passe oublié n'a pas de parcours en libre-service.
- Le blocage par e-mail reste la seule défense contre la force brute : le journal l'observe sans la freiner.
- L'e-mail tenté est écrit dans le journal à chaque connexion, réussie ou non : `security_events` s'ajoute à `login_failures` comme endroit où figure une adresse (voir décision 6 pour la rétention).
- `secure: true` suppose HTTPS en production.

### Reconsider when
- **Atteint (incrément 3, spec A), traité :** la journalisation de sécurité a été ajoutée et couvre connexions réussies, échecs, débuts de blocage, tentatives pendant un blocage, inscriptions et refus d'accès, dans la table `security_events` consultable sur `/libraire/journal`. `users.last_login_at` est écrit à chaque connexion réussie, et la borne de rétention calendaire vit dans `src/lib/server/dates.ts` (`subtractCalendarYear`, `startOfDayInParis`) plutôt que dans une arithmétique de dates propre au journal.
- Le blocage ciblé d'un compte devient un abus observé : ajouter une limitation par IP ou un délai progressif.
- Product décide d'ajouter reset par e-mail ou 2FA (exclus en v1).

## 10. Deux rôles (`borrower`, `bookseller`), contrôle d'accès côté serveur dans chaque `load` et chaque action, libraire créé uniquement par la commande locale `npm run libraire:creer`.

**Nouvelle (incrément 1).** L'inscription publique ne crée que des emprunteurs. Le compte libraire, qui peut ajouter des livres, enregistrer des retours, gérer les prix, vendre et réassortir, n'est jamais créable depuis le web. Il est créé sur le poste par la commande locale, qui refuse tout mot de passe passé en argument.

| Route | Accès | Garde et comportement |
|---|---|---|
| `/` (catalogue) | Public | `load` : `catalogueFiltersFromSearchParams` (paramètres GET `q`, `pret`, `vente`), puis `listCatalogue` (id, titre, auteur, statut de prêt, prix, état de vente ; jamais le stock chiffré) ; renvoie aussi les filtres normalisés. Action `?/emprunter` : `requireBorrower` avant toute lecture du formulaire, `parseRecordId`, `borrowBook` ; 400 identifiant mal formé, 404 livre inexistant, 409 déjà emprunté, 403 si le rôle n'est plus emprunteur en base. |
| `/connexion` | Public | `load` : `accountCreated` seulement si `inscription` vaut exactement `1`. Action : `login` ; 400 message générique, 429 blocage ; redirection 303 fixe vers `/libraire/retours` (libraire) ou `/` (emprunteur). |
| `/inscription` | Public | Action : `createBorrower` ; aucun champ `role` n'est lu ; pas de connexion automatique ; redirection vers `/connexion?inscription=1`. |
| `/deconnexion` | Public | `load` (GET) : redirection vers `/` sans déconnexion. Action (POST) : `deleteSession` et `deleteSessionCookie`. |
| `/mes-prets` | Emprunteur | `load` : `requireBorrower`, puis `listBorrowerLoans(db, borrower.id)` ; l'utilisateur vient uniquement de la session. |
| `/libraire/**` | Libraire | `+layout.server.ts` : `requireBookseller` pour le rendu. Les actions ne passant pas par les `load`, chaque action rappelle `requireBookseller`. |
| `/libraire/livres/nouveau` | Libraire | Garde du layout ; action : `requireBookseller`, puis `addBook` (titre, auteur, prix et stock de vente initial facultatifs). |
| `/libraire/vente` | Libraire | `load` : `requireBookseller` (en plus du layout), `listSaleCounter` (tous les livres, avec ou sans prix, et leur stock chiffré). Actions, chacune avec `requireBookseller` avant toute lecture du formulaire puis `parseRecordId` : `?/prix` (`intent` = `fixer` → `setBookPrice`, `retirer` → `removeBookPrice`, autre → 400), `?/vendre` (`recordSale`, enregistreur lu de la session), `?/reassortir` (`restockBook`). 400 saisie refusée, 404 livre inexistant, 409 stock insuffisant, livre sans prix ou stock maximal dépassé, 403 si le rôle n'est plus libraire en base à la vente. |
| `/libraire/retours` | Libraire | `load` : `requireBookseller` (en plus du layout), `listActiveLoans`. Action : `requireBookseller`, `parseRecordId`, `recordReturn` ; 400, 404 ou 409. |
| `/libraire/journal` | Libraire | `load` : `requireBookseller` (en plus du layout), puis `listRecentSecurityEvents` (les 100 derniers événements, du plus récent au plus ancien). Page en **lecture seule** : aucune action n'est exportée, donc tout POST est refusé par SvelteKit ; rien n'est lu de l'URL (ni filtre, ni limite, ni identifiant de compte). |
| `/health` | Public | `GET` : `{ status: 'ok' }`, `cache-control: no-store`. |

- `requireBookseller` (dans `src/lib/server/catalogue/index.ts`) et `requireBorrower` (dans `src/lib/server/loans/index.ts`) redirigent un anonyme vers `/connexion` (303) et répondent 403 avec un message en français à l'autre rôle.
- `borrowBook` revérifie le rôle en base : l'insertion du prêt ne se fait que `FROM users WHERE users.id = ? AND users.role = 'borrower'`. De même, `recordSale` vérifie dans sa transaction que l'enregistreur a le rôle `bookseller` en base, sinon la vente est refusée (`forbidden`, traduit en 403) sans rien écrire. Le libraire n'emprunte pas et l'emprunteur ne vend pas.
- `createBookseller` porte le commentaire « Réservé à la commande locale `libraire:creer` : aucune route web ne doit l'appeler ». Aucun fichier de route (`+page.server.ts`, `+layout.server.ts`, `+server.ts`) ne l'importe ; seuls des tests l'utilisent pour préparer un compte libraire.
- Commande `npm run libraire:creer -- --email <e-mail> --nom <nom affiché>` : `scripts/libraire-creer.ts` (point d'entrée) et `src/lib/server/auth/cli.ts` (logique). Tout argument ressemblant à un mot de passe est refusé sans être recopié, avant toute lecture. Le mot de passe est lu en invite masquée deux fois sur un terminal, ou sur la première ligne de l'entrée standard. La base n'est ouverte qu'après la saisie, et ni le mot de passe ni son hachage ne sont écrits en sortie. Codes de sortie : `EXIT_OK` 0, `EXIT_FAILURE` 1, `EXIT_USAGE` 2.

### Evidence
- `src/routes/**/+page.server.ts`, `src/routes/+layout.server.ts`, `src/routes/libraire/+layout.server.ts`, `src/routes/health/+server.ts`.
- `package.json` : `"libraire:creer": "node --experimental-strip-types scripts/libraire-creer.ts"`.
- Tests : `inscription/page.server.test.ts` (« ignore un champ role envoyé avec le formulaire »), `libraire/livres/nouveau/page.server.test.ts` (garde du layout, emprunteur refusé, champ `role` ignoré), `page.server.test.ts` (libraire refusé à l'emprunt, rôle périmé, `userId` ignoré, retour refusé à l'emprunteur propriétaire, `/mes-prets` isolé), `libraire/vente/page.server.test.ts` (« autorisation de /libraire/vente » : chargement et POST directs refusés, rôle périmé, champs `role`, `userId` et `booksellerId` ignorés), `sales.test.ts` (« refuse un enregistreur qui n'est pas libraire en base, sans rien écrire »), `auth.test.ts` (commande et point d'entrée), `libraire/journal/page.server.test.ts` (« autorisation de /libraire/journal » : anonyme redirigé, emprunteur refusé, aucune action exportée, paramètres d'URL ignorés sans écriture).

### Alternatives
- **Premier compte inscrit promu libraire** — Course à l'inscription sur une instance exposée.
- **Rôle choisi dans le formulaire d'inscription** — Élévation de privilège triviale.
- **Garde uniquement dans `hooks.server.ts` par préfixe d'URL** — Centralisée, mais moins explicite ; les gardes par `load` et action restent visibles et testées là où les données sont lues ou modifiées.

### Trade-offs
- Chaque nouvelle action doit penser à appeler sa garde : un oubli n'est détecté que par les tests de route.
- Un seul rôle libraire, sans gestion des libraires depuis l'interface (ni liste, ni désactivation).
- Le rôle est lu depuis la session à chaque requête ; seuls l'emprunt et la vente le revérifient explicitement en base au moment de l'écriture. Le réassort et le changement de prix s'appuient sur la garde de session.
- La connexion d'un libraire redirige toujours vers `/libraire/retours`, et non vers `/libraire/vente`.

### Reconsider when
- **Atteint (incréments 2 et 3), décision reportée :** le nombre de routes libraire a encore augmenté (`/libraire/vente` et ses trois actions, puis `/libraire/journal` en lecture seule). Aucune garde par préfixe n'a été ajoutée dans `src/hooks.server.ts`, hors du périmètre de ces incréments : la protection repose toujours sur le layout et sur l'appel de `requireBookseller` dans chaque `load` et chaque action, vérifié par les tests de route. Le hook observe désormais les réponses 403 pour les journaliser, mais ne décide d'aucun accès. Ajouter une garde par préfixe reste à envisager.
- Plusieurs libraires ou des niveaux de droits distincts sont demandés.
- La commande locale n'est plus accessible (hébergement géré) : définir un parcours d'administration sûr.

## 11. Domaine prêt : catalogue de livres à exemplaire unique, emprunt immédiat de 30 jours, retour enregistré par le libraire, retards calculés en dates calendaires Europe/Paris avec horloge injectable.

**Nouvelle (incrément 1).** La fonction d'emprunt demandée par l'opérateur (« qui permet d'emprunter ») est livrée : emprunt, retour, retards et « Mes prêts ».

- **Dates** (`src/lib/server/dates.ts`) : `LIBRARY_TIME_ZONE = 'Europe/Paris'`. Seule la lecture de « maintenant » dépend du fuseau (`todayInParis(clock)`, `parisDateOf`). L'ajout de jours (`addCalendarDays`) et les comparaisons se font sur des dates `AAAA-MM-JJ` sans heure, donc sans effet des changements d'heure. `isOverdue(dueOn, today)` est vrai si et seulement si `today > dueOn` : le jour de l'échéance n'est pas un retard. `Clock = () => Date`, `systemClock` par défaut, et une horloge injectée dans les tests. La spec A de l'incrément 3 y a ajouté, à côté de ces fonctions plutôt que dans le journal, les deux calculs de la borne de rétention : `subtractCalendarYear(isoDate)` (même jour de l'année précédente, 29 février ramené au 28 février) et `startOfDayInParis(isoDate)` (instant, en millisecondes epoch, où la date commence à Paris, heure d'été ou d'hiver comprise).
- **Catalogue** (`src/lib/server/catalogue/index.ts`) : `listCatalogue` renvoie les livres triés par titre puis auteur (collation française), avec le statut de prêt `available` ou `borrowed`, sans emprunteur ni échéance. Depuis l'incrément 2, chaque ligne porte aussi le prix et l'état de vente, et la liste accepte des filtres (décision 13). `addBook` ajoute l'exemplaire unique d'un titre après `validateBook` : titre et auteur sans espaces autour, 1 à `BOOK_TEXT_MAX_LENGTH` = 200 caractères, sans caractère de contrôle ; prix et stock de vente initial facultatifs (décision 13).
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
- L'historique des prêts rendus est conservé sans limite à ce jour : sa conservation d'un an et sa purge relèvent de la spec B et ne sont pas implémentées. La rétention d'un an calendaire n'est écrite aujourd'hui que pour le journal de sécurité (décisions 6 et 8), et sa fonction n'est appelée par personne.
- Le catalogue est filtrable (décision 13) mais n'est pas paginé, et son tri n'est pas configurable.

### Reconsider when
- **Atteint (incrément 2), traité :** le stock de vente a été ajouté, indépendant de l'exemplaire de prêt unique (colonne `books.sale_stock`). `loans_one_active_per_book` n'est pas réutilisé pour la vente, et vendre ou emprunter n'affecte pas l'autre domaine (tests « indépendance vente / prêt » de `sales.test.ts`). Voir décision 13.
- **Atteint (incrément 2), traité :** les filtres serveur (disponibilité à la vente, disponibilité au prêt, recherche titre/auteur) ont été ajoutés en étendant `listCatalogue`. Voir décision 13.
- Le catalogue devient trop long pour être affiché en une page : ajouter la pagination (hors du périmètre actuel).
- La spec B implémente la purge de l'historique des prêts au-delà d'un an : réutiliser la borne calendaire de `dates.ts` déjà employée par le journal.
- Product décide de règles de réservation, de prolongation ou de limites.

## 12. Interface : base CSS partagée dans `src/lib/styles/app.css` et styles scopés par composant ou page, polices Cormorant Garamond et Inter embarquées, direction visuelle « Maison d'édition ».

**Nouvelle ; la direction « Maison d'édition » remplace « Functional high-contrast », qui n'est plus en vigueur.** Choix de l'opérateur : « Maison d'édition », polices « Oui, cette paire » (Cormorant Garamond + Inter). La direction est décrite ici comme en vigueur, sans évolution proposée.

- **Organisation CSS** : `src/lib/styles/app.css`, importé par `src/routes/+layout.svelte`, porte la base partagée : polices, jetons, typographie, en-tête, mise en page, formulaires, boutons, messages, tableaux, signaux de prêt et préférences utilisateur. L'incrément 2 y a ajouté, sans nouvelle palette, le groupe de champs facultatifs (`.fieldset`), le champ suivi d'une unité (`.field__affix`), les montants (`.money`), la bande de filtres du catalogue (`.filters`) et les cases à cocher (`.check`). Les styles propres à un seul composant ou à une seule page restent dans son bloc `<style>` : `src/lib/components/CatalogueTable.svelte`, `src/lib/components/LoanStatus.svelte`, `src/lib/components/SaleStatus.svelte`, `src/routes/+page.svelte`, `+error.svelte`, `mes-prets/+page.svelte`, `libraire/retours/+page.svelte`, `libraire/livres/nouveau/+page.svelte`, `libraire/vente/+page.svelte`, `libraire/journal/+page.svelte`. La spec A de l'incrément 3 n'a rien ajouté à `app.css` : la page du journal réutilise `.data`, `.data--stack` et `.empty`, et ne définit dans son propre bloc `<style>` que trois règles de page (libellé d'événement en Inter plutôt qu'en serif, horodatage non coupé, colonne de détail secondaire et coupée). Aucune bibliothèque de composants ni framework CSS n'est utilisé.
- **Polices** : Cormorant Garamond (400, 500, 600, 700 et italiques 400, 500) et Inter (variable, graisses 100 à 900, normal et italique), en woff2 dans `static/fonts`, sous-ensemble latin, avec `OFL-cormorant-garamond.txt`, `OFL-inter.txt` et `README.md` (licence SIL OFL 1.1 et provenance). Les `@font-face` utilisent `font-display: swap` et des URL locales `/fonts/…`. Aucun CDN n'est utilisé, donc rien n'est à ouvrir dans la CSP. Aucun paquet npm de police n'est ajouté aux dépendances.
- **Direction « Maison d'édition »** : papier ivoire (`--ivory` #f8f4ea, `--paper` #f1eadb), encre bleu nuit (`--ink` #14213d, `--ink-2` #4a5068), laiton rare (`--brass` #a8843a, réservé aux filets et ornements, jamais au texte ni à un fond sous du texte ; `--brass-text` #7a5c1e et `--brass-light` #c9a55a pour les cas textuels documentés), états `--danger` #9b2c2c / `--danger-wash` #f6e4df et `--success` #2f5d3a / `--success-wash` #e6eee0. Titres en `--serif` (Cormorant Garamond), texte courant et interface en `--sans` (Inter), `--radius` de 2px, filet laiton sous le `h1`, losange laiton pour les états vides (`.empty`). L'espace libraire se distingue par un bandeau bleu nuit à bordure laiton et étiquette « Espace libraire » en laiton clair (`.site-header--libraire`), dont la navigation comprend les entrées « Vente » vers `/libraire/vente` et « Journal » vers `/libraire/journal`. L'état de vente public est rendu par `SaleStatus.svelte` avec le seul texte « En vente » ou « Épuisé ».
- **Accessibilité inscrite dans le code** : contrastes WCAG des couples utilisés vérifiés par le test `src/lib/styles/contrast.test.ts` (au moins 4,5:1 pour le texte, 3:1 pour les bordures, repères et contours de focus) ; `:focus-visible` (contour `--ink` de 2px décalé de 3px) ; lien d'évitement `.skip-link` vers `#contenu` ; bloc `prefers-reduced-motion: reduce` ; bloc `forced-colors: active` ; tableaux `.data--stack` empilés sous 40rem ; retard signalé par badge bordé, losange et texte (`.badge-overdue`), pas seulement par la couleur ; page active marquée par filet et graisse. États existants : `.empty`, `.notice--error`, `.notice--success`, `.btn[aria-busy]`, `.btn[aria-disabled]`. Mise en page : `--measure` 72rem, `--gutter` `clamp(1rem, 4vw, 2.5rem)`, grille `.auth` à deux colonnes à partir de 52rem. Aucun audit automatisé ni test navigateur d'accessibilité n'existe : aucune conformité WCAG n'est revendiquée.

### Evidence
- `src/lib/styles/app.css` : commentaire de tête réduit à l'intention (direction « Maison d'édition » ; `--brass` réservé aux filets et ornements, jamais pour du texte ni comme fond sous du texte ; `--rule` jamais seul porteur d'information ; base partagée dans ce fichier, styles propres à un composant ou à une page dans le bloc `<style>` de ce composant ou de cette page), sans ratio ni valeur de couleur, `@font-face`, `:root`, sections En-tête, Mise en page, Formulaires, Boutons, Messages, Tables, Signaux de prêt, Préférences.
- `src/lib/styles/app.css`, section Formulaires : commentaires « Groupe de champs facultatifs (ajout de livre : vente) », « Montants : chiffres alignés, jamais coupés », « Bande de filtres du catalogue (GET, sans JavaScript) », « Case à cocher : cible de 44 px portée par le libellé ».
- `src/routes/+layout.svelte` : `import '$lib/styles/app.css'`, `.skip-link`, classe `site-header--libraire`, liens « Vente » vers `/libraire/vente` et « Journal » vers `/libraire/journal`.
- `src/lib/components/SaleStatus.svelte`, `src/routes/libraire/vente/+page.svelte`, `<legend>Vente (facultatif)</legend>` dans `src/routes/libraire/livres/nouveau/+page.svelte`.
- `static/fonts/README.md`, `static/fonts/OFL-cormorant-garamond.txt`, `static/fonts/OFL-inter.txt` et les huit fichiers `.woff2`.
- `src/security-config.test.ts` : aucune source distante autorisée dans la CSP, cohérent avec des polices locales.
- `src/lib/styles/contrast.test.ts` : lit les jetons `:root` d'`app.css` et les teintes de couverture littérales de `CatalogueTable.svelte`, calcule les ratios WCAG 2.x des couples texte (seuil 4,5:1) et non textuels (seuil 3:1), échoue en nommant toute variable absente ou non hexadécimale, vérifie que `--brass` sur `--ivory` reste entre 3:1 et 4,5:1 et qu'aucune déclaration `color:` n'utilise `var(--brass)` dans `app.css` ni dans les fichiers `src/**/*.svelte`.

### Alternatives
- **Bibliothèque de composants** — Imposerait une identité générique et des dépendances pour quelques écrans.
- **CSS utilitaire (Tailwind ou équivalent)** — Outillage de build supplémentaire. Les jetons CSS natifs suffisent.
- **Polices via CDN (Google Fonts)** — Exigerait d'ouvrir `style-src` et `font-src` à une origine tierce et exposerait les visiteurs à un tiers.
- **« Functional high-contrast »** — Direction précédente, remplacée par le choix de l'opérateur.

### Trade-offs
- Un seul thème clair (`color-scheme: light`) : pas de thème sombre.
- `style-src` non restreint dans la CSP (décision 6).
- Huit fichiers de police servis par l'application augmentent le poids initial ; `font-display: swap` évite de bloquer le texte.
- **Remplacé :** ~~Les contrastes sont calculés à la main en commentaire, sans outil qui les revérifie.~~ Le test `src/lib/styles/contrast.test.ts` les recalcule à chaque exécution. Il ne couvre que les couples qu'il déclare : un nouveau couple de couleurs doit y être ajouté.

### Reconsider when
- Un thème sombre est demandé.
- **Atteint (incrément 3, spec A), traité :** une page interne s'est ajoutée sans maquette séparée, choix de l'opérateur « Sans maquette » : `/libraire/journal` réutilise les composants et jetons existants de la direction « Maison d'édition », sans nouveau jeton, police ni composant global.
- **Atteint (incrément 2), traité :** les écrans de vente ont été conçus à partir d'une maquette approuvée dans la direction « Maison d'édition » et ajoutés sans la modifier : colonnes Prix et Vente et bande de filtres du catalogue, écran `/libraire/vente`, groupe « Vente (facultatif) » du formulaire d'ajout de livre.
- Des tests de bout en bout ou d'accessibilité automatisés sont ajoutés : vérifier en navigateur les engagements listés ci-dessus.

## 13. Domaine vente : prix en centimes entiers, stock de vente indépendant du prêt, vente au comptoir et réassort par le libraire depuis `/libraire/vente`, filtres serveur du catalogue public en GET.

**Nouvelle (incrément 2).** Décisions de l'opérateur : « Inclure la vente en v1 » (Q-sales-scope), « Add filters in v1 », précisions de « I approve all 12 » (vente au comptoir par le libraire sans achat en ligne ni paiement, stock de vente indépendant de l'exemplaire de prêt, prix en centimes entiers), et réponses à la maquette : le prix de n'importe quel livre se gère depuis `/libraire/vente` (Q-design-prix-existant), et le stock chiffré n'est jamais visible des visiteurs (Q-design-stock-public). La logique vit dans `src/lib/server/sales/index.ts` (vente, réassort, prix) et `src/lib/server/catalogue/index.ts` (validation et formatage des prix, stock initial, filtres).

- **Prix** : stockés en centimes entiers (`price_cents`), jamais en flottant. `validatePrice` accepte « 12 », « 12,50 », « 12.50 » et un « € » final, refuse plus de deux décimales, un nombre négatif ou nul, et borne à `PRICE_MAX_CENTS` = 1 000 000 (10 000,00 €). `formatPrice` affiche au format français (« 12,50 € ») via `Intl.NumberFormat`, en lui passant une chaîne décimale ; `formatPriceInput` préremplit le champ (« 12,50 »). Le prix est facultatif : un livre sans prix (`null`) reste prêtable, n'est pas vendable, et les livres de la v1 migrent sans prix. Aucune TVA ni mention HT/TTC.
- **Modification du prix** : depuis `/libraire/vente`, le libraire fixe, modifie ou retire le prix de **n'importe quel livre** du catalogue, y compris un livre ajouté avant l'incrément 2 (`setBookPrice`, `removeBookPrice`). Un changement de prix ne touche ni le stock, ni les prêts, ni les ventes passées, dont le prix unitaire est figé. Retirer le prix rend le livre « Épuisé » au catalogue public et refuse toute vente. Il n'existe pas d'autre écran d'édition de livre ni d'historique des prix.
- **Stock de vente** : `sale_stock`, entier de 0 à `SALE_STOCK_MAX` = 10 000, strictement indépendant de l'exemplaire de prêt unique : un livre emprunté reste vendable, et vendre tout le stock laisse le livre disponible au prêt. `validateSaleStock` valide le stock initial facultatif du formulaire d'ajout (absent → 0).
- **Stock chiffré réservé au libraire** : `listCatalogue` ne sélectionne pas `sale_stock` et ne renvoie que `saleStatus` (`on-sale` si le livre a un prix et au moins un exemplaire, sinon `sold-out`), affiché « En vente » ou « Épuisé » par `SaleStatus.svelte`. Le stock chiffré n'apparaît que dans `listSaleCounter` (écran `/libraire/vente`) et dans le résultat de `addBook` renvoyé au libraire.
- **Vente au comptoir** (`recordSale`) : quantité de `SALE_QUANTITY_MIN` = 1 à `SALE_QUANTITY_MAX` = 1 000 (`validateQuantity`). Dans une transaction `immediate` : relecture du livre (404 inconnu, 409 sans prix ou stock insuffisant), revérification du rôle libraire en base, décrément conditionnel `sale_stock = sale_stock - ? WHERE sale_stock >= ?`, puis insertion dans `sales` du prix unitaire lu en base, du total `quantité × prix` en centimes et de la date du jour à Paris (`todayInParis`, horloge injectable). La contrainte `CHECK (sale_stock >= 0)` reste l'arbitre final. Un stock insuffisant est rattaché au champ quantité avec le nombre d'exemplaires encore disponibles (`saleInsufficientStockMessage`), visible du seul libraire. Aucun achat en ligne, panier, paiement, encaissement ni ticket n'existe, et aucune donnée d'acheteur n'est collectée.
- **Réassort** (`restockBook`) : ajoute une quantité de 1 à 1 000 au stock de vente, sans dépasser `SALE_STOCK_MAX` (sinon 409, stock inchangé). Un livre sans prix peut être réassorti et reste « Épuisé ». Aucun seuil, aucune alerte de stock bas, aucune commande fournisseur.
- **Filtres du catalogue public** : formulaire GET sans JavaScript, paramètres `CATALOGUE_FILTER_PARAMS` = `q` (texte), `pret` (disponible au prêt), `vente` (en vente), combinés par ET. `normalizeCatalogueFilters` ignore toute valeur absente, vide ou inconnue ; seules `on`, `1` et `true` activent une disponibilité. Le texte est débarrassé des caractères de contrôle, borné à `BOOK_TEXT_MAX_LENGTH` et cherché dans le titre et l'auteur sans tenir compte de la casse, des accents ni des ligatures (fonction SQL `catalogue_fold` déclarée par connexion), avec les jokers `LIKE` échappés. « Disponible au prêt » exclut les livres ayant un prêt actif ; « en vente » exige un prix et du stock. Un état vide propre aux filtres propose de revenir à tout le catalogue.
- **Bornes** : les limites de prix, de stock et de quantité sont des garde-fous techniques choisis par Product, pas des règles commerciales de l'opérateur ; elles peuvent être révisées sans changer l'architecture.
- **Erreurs** : refus discriminés `SalesFailure<Reason>` (`invalid` → 400, `not-found` → 404, `no-price`, `insufficient-stock`, `stock-limit` → 409, `forbidden` → 403), traduits par la route en erreur rattachée à la ligne et au champ, avec la saisie réaffichée.

### Evidence
- `src/lib/server/sales/index.ts` : commentaire de tête (« le stock de vente est indépendant de l'exemplaire de prêt et ne touche jamais à la table loans »), `validateQuantity` (avec `NEGATIVE_NUMBER` et `formatInteger` importés du catalogue), `listSaleCounter` (triée par `compareBooksByTitle`, importé du catalogue), `recordSale`, `restockBook`, `setBookPrice`, `removeBookPrice`.
- `src/lib/server/catalogue/index.ts` : `CatalogueEntry` (« ni stock chiffré »), `CATALOGUE_FILTER_PARAMS`, `normalizeCatalogueFilters`, `catalogueFiltersFromSearchParams`, `listCatalogue` (commentaire « sale_stock sert uniquement à dériver on_sale : sa valeur n'est jamais renvoyée »), `PRICE_MAX_CENTS`, `SALE_STOCK_MAX`, `formatPrice`, `validatePrice`, `validateSaleStock`, `addBook`, et les éléments partagés avec la vente : `compareBooksByTitle` (tri titre / auteur / id), `formatInteger` (entiers au format français), `NEGATIVE_NUMBER` (saisie négative).
- `src/routes/+page.server.ts`, `src/routes/+page.svelte`, `src/lib/components/CatalogueTable.svelte`, `src/lib/components/SaleStatus.svelte`, `src/routes/libraire/vente/+page.server.ts`, `src/routes/libraire/vente/+page.svelte`, `src/routes/libraire/livres/nouveau/+page.server.ts`.
- `src/lib/server/sales/sales.test.ts` : « fixe le prix d'un livre migré depuis la v1 sans prix, qui devient vendable », « modifie le prix sans réécrire les ventes passées ni toucher au stock », « retire le prix : prix nul, « Épuisé », stock et ventes inchangés, vente refusée », « refuse deux ventes successives sur le dernier exemplaire : stock 0, une seule vente », « calcule le total à la borne haute sans perte de précision », « indépendance vente / prêt ».
- `src/lib/server/catalogue/catalogue.test.ts` : « expose id, titre, auteur, prêt, prix et vente, jamais le stock chiffré », « listCatalogue : filtres », « listCatalogue : valeurs hostiles », « prix », « stock de vente ».
- `src/routes/libraire/vente/page.server.test.ts` et `src/routes/page.server.test.ts` : « n'affiche que « En vente » ou « Épuisé » dans la colonne Vente, jamais un stock », « deux ventes successives du dernier exemplaire : la seconde répond 409, stock 0 », « répond 409 au-delà de 10 000 exemplaires en stock, stock inchangé ».

### Alternatives
- **Prix en nombres décimaux (REAL)** — Erreurs d'arrondi ; exclu par la décision de l'opérateur (centimes entiers).
- **Stock de vente dérivé de l'exemplaire de prêt ou d'une table d'exemplaires** — Contredit l'indépendance décidée par l'opérateur et imposerait une migration plus lourde.
- **Écran dédié d'édition du livre ou du prix** — Écarté par l'opérateur : le prix se gère depuis `/libraire/vente`.
- **Afficher le stock chiffré au public** — Écarté par l'opérateur (Q-design-stock-public).
- **Filtres côté client ou recherche plein texte (FTS5)** — Le filtrage serveur en GET fonctionne sans JavaScript et suffit au volume actuel ; FTS5 ajouterait une table virtuelle à synchroniser.
- **Bibliothèque de formatage monétaire** — `Intl`, déjà utilisé pour la collation et les dates, suffit, et aucune dépendance n'est ajoutée.

### Trade-offs
- **Traçabilité partielle, limite assumée** : seules les ventes sont enregistrées (`sales`, conservée par `ON DELETE RESTRICT`). Les réassorts et les changements de prix n'ont volontairement aucun registre à cet incrément : un réassort ou un prix erroné ne peut pas être reconstitué. Le journal de sécurité livré par la spec A de l'incrément 3 ne couvre pas ces mouvements : il enregistre des événements de connexion et d'accès, jamais une opération de vente.
- Aucun retour de vente, remboursement ni remise : une vente erronée ne peut pas être annulée depuis l'interface.
- La recherche plie le texte en JavaScript pour chaque ligne examinée (fonction SQL utilisateur) : coût linéaire, sans index, acceptable sans pagination pour un petit catalogue.
- Les dates de vente sont conservées en clair, associées au libraire enregistreur ; leur conservation et leur anonymisation relèvent de la spec B.
- Le réassort et le changement de prix ne revérifient pas le rôle en base (décision 10).

### Reconsider when
- L'opérateur tranche la TVA : ajouter taux, ventilation ou mention HT/TTC, par une nouvelle migration si nécessaire.
- L'opérateur fixe des seuils de réassort : ajouter seuils et alertes de stock bas.
- Un registre des réassorts ou des changements de prix est demandé : ajouter une table de mouvements par une nouvelle migration.
- Retours, remboursements, remises, achat en ligne ou paiement sont demandés (tous hors v1 actuelle).
- Le catalogue grossit au point que la recherche ou l'affichage ralentissent : pagination, index ou FTS5.
- La spec B implémente suppression de compte, conservation et anonymisation : définir leur effet sur `sales` sans suppression en cascade. La journalisation de sécurité, livrée par la spec A, ne touche pas `sales`.

## Frontières de modules, responsabilités et conventions

**Responsabilités.**

| Module | Responsabilité | Ne fait pas |
|---|---|---|
| `src/lib/server/db/index.ts` | Ouverture de la base, pragmas, migrations, résolution du chemin, connexion partagée (`getDb`). | Aucune règle métier. |
| `src/lib/server/dates.ts` | Dates calendaires Europe/Paris, type `Clock`, `isOverdue`, `formatDateFr`, borne de rétention calendaire (`subtractCalendarYear`, `startOfDayInParis`). | Aucun accès à la base. |
| `src/lib/server/security-log/index.ts` | Liste fermée des types d'événements et leurs libellés, `recordSecurityEvent`, `listRecentSecurityEvents`, `securityLogRetentionStart`, `purgeSecurityEvents`. | Pas de contrôle de rôle ; ne décide d'aucun accès ; n'appelle jamais la purge lui-même ; pas d'arithmétique de dates propre (celle de `dates.ts` est réutilisée). |
| `src/lib/server/auth/index.ts` | Validation des comptes, Argon2id, création de comptes, sessions et cookie, blocage, `login`. | Pas de contrôle de rôle par route. |
| `src/lib/server/auth/cli.ts` | Logique de la commande `libraire:creer` (arguments, lecture du mot de passe, sortie). | N'ouvre pas la base : elle lui est injectée par `scripts/libraire-creer.ts`. |
| `src/lib/server/catalogue/index.ts` | `requireBookseller`, `listCatalogue` et ses filtres, `validateBook`, `addBook`, validation et formatage des prix, validation du stock initial ; exporte pour la vente `compareBooksByTitle`, `formatInteger` et `NEGATIVE_NUMBER`. | Pas d'écriture de prêt ni de vente ; ne renvoie jamais le stock chiffré au catalogue public. |
| `src/lib/server/loans/index.ts` | `requireBorrower`, `parseRecordId`, `borrowBook`, `recordReturn`, `listActiveLoans`, `listBorrowerLoans`. | Pas de création de compte. |
| `src/lib/server/sales/index.ts` | `validateQuantity`, `listSaleCounter`, `recordSale`, `restockBook`, `setBookPrice`, `removeBookPrice` ; réutilise `compareBooksByTitle`, `formatInteger` et `NEGATIVE_NUMBER` du catalogue. | Ne touche jamais à la table `loans` ; pas de contrôle de rôle d'écran (garde chez l'appelant), hormis la revérification en base à la vente. |
| `src/hooks.server.ts` | Chargement de `locals.user`, effacement d'un cookie invalide, en-têtes de sécurité, journalisation des refus d'accès (403 à un utilisateur connecté). | Pas de garde de rôle : il observe le statut de la réponse, sans le décider ni le modifier. |
| `src/routes/**/+page.server.ts`, `+layout.server.ts` | Lecture du formulaire, appel de la garde et du module serveur, traduction du résultat en `fail`, `redirect` ou données. | Pas de SQL ni de règle métier. |
| `src/lib/components/*.svelte`, `src/routes/**/+page.svelte` | Présentation et styles scopés. | Pas d'accès serveur. |

**Conventions observables dans le code.**
- **La logique métier et le SQL vivent dans `src/lib/server/<module>`.** Les routes importent `$lib/server/...` et ne contiennent aucune requête. Voir `src/routes/libraire/retours/+page.server.ts`.
- **La base et l'horloge sont reçues en paramètre.** Chaque fonction prend `db: Db` en premier argument, et une `clock: Clock` (ou une date `today`) là où le temps compte, avec une valeur par défaut système. Commentaires de tête de `auth/index.ts` et `loans/index.ts`.
- **Le SQL passe exclusivement par des requêtes préparées à paramètres liés** (`db.prepare(...).run/get/all(params)`). Commentaires de tête de `catalogue/index.ts`, `loans/index.ts` et `sales/index.ts`. Seule exception documentée : l'entier interne de `PRAGMA user_version` dans `db/index.ts`.
- **Les gardes de rôle sont appelées dans chaque `load` et chaque action**, car les actions ne passent pas par les `load` : commentaire de `requireBookseller`, `src/routes/libraire/+layout.server.ts` et commentaires « Le layout /libraire ne protège pas les actions » dans `libraire/livres/nouveau` et `libraire/retours`. Une garde est appelée avant toute lecture du formulaire.
- **Les routes restent minces** : lecture du formulaire, garde, appel du module, traduction du résultat.
- **Les échecs attendus sont des résultats discriminés** (`{ ok: false, reason }` ou `{ ok: false, errors }`), et les erreurs d'infrastructure sont relancées.
- **Les entrées non fiables sont typées `unknown`** (`AccountInput`, `BookInput`, `LoginInput`, `CatalogueFilterInput`, `SaleInput`, `RestockInput`, `PriceInput`) et validées côté serveur.
- **Les montants sont des centimes entiers** de bout en bout ; seuls `formatPrice` et `formatPriceInput` produisent un texte en euros. Les identifiants passent par `parseRecordId`. Les valeurs renvoyées au formulaire après erreur n'incluent jamais le mot de passe.
- **Une migration publiée ne se modifie jamais** : on en ajoute une à la fin de `MIGRATIONS` (commentaire de tête de `db/index.ts`).
- **Les modules chargés par la commande locale** (`auth/index.ts`, `auth/cli.ts`, `db/index.ts`) n'utilisent ni alias `$lib` ni import relatif à l'exécution.
- **Les messages destinés aux utilisateurs sont en français** et exportés en constantes quand ils sont testés (`LOGIN_FAILED_MESSAGE`, `BOOKSELLER_ONLY_MESSAGE`, `BORROWER_ONLY_MESSAGE`, `LOAN_NOT_RETURNABLE_MESSAGE`…). Les noms de routes sont en français (`/connexion`, `/mes-prets`, `/libraire`), et les identifiants de code et de schéma en anglais.
- **Les tests sont colocalisés** (`*.test.ts` à côté du module ou de la route), en français, et utilisent une base `:memory:` et une horloge injectée.

## À venir

Cette section fixe ce qui reste à implémenter ou à décider après la spec A de l'incrément 3. **Rien des règles de la spec B ci-dessous n'existe à ce jour dans le code.** Les règles marquées DÉCIDÉE ont été tranchées par l'opérateur ; leur source est indiquée. Les points marqués « à décider » ne sont pas tranchés et ne doivent pas être inventés par une implémentation. Découpage : **DÉCIDÉE** — incrément 2 = vente, prix, réassort, filtres (livré, décision 13) ; incrément 3 = suppression de compte, conservation 1 an, journalisation de sécurité (source : « Lending core first (Recommended) »), lui-même découpé en spec A (journal de sécurité, livrée) et spec B (suppression de compte, anonymisation, purges, à venir).

### Points de vente restant à décider

L'incrément 2 est livré (vente au comptoir, prix, stock de vente, réassort, filtres : décisions 8, 11 et 13) et n'est plus à faire. Les points suivants ne sont pas tranchés : le code n'en implémente aucun.

| Règle | Statut | Source |
|---|---|---|
| TVA (taux, ventilation, mention HT/TTC). | à décider | — |
| Seuils de réassort (et alertes de stock bas). | à décider | — |

### Incrément 3, spec A — journal de sécurité : **livrée**

Le socle est en place et n'est plus à faire : migration 3 (`users.last_login_at`, `users.deleted_at`, table `security_events`, index), module `src/lib/server/security-log`, journalisation des six événements retenus avec l'e-mail normalisé tenté, borne de rétention d'un an en date calendaire de Paris dans `dates.ts`, et page en lecture seule `/libraire/journal`. Voir les décisions 6, 8, 9 et 10. Le format et la destination des journaux, autrefois « à décider », ont été tranchés par l'opérateur (« Table SQLite + page libraire », « 1 an », « Date calendaire Paris », « Garder l'e-mail tenté »).

### Incrément 3, spec B — suppression de compte, anonymisation, purges : **à venir**

**Rien de ce tableau n'est implémenté.** `users.deleted_at` et `purgeSecurityEvents` existent déjà, mais personne ne les écrit ni ne les appelle : la fonction de purge du journal est écrite et testée, sans aucun déclenchement automatique.

| Règle | Statut | Source |
|---|---|---|
| Suppression de compte refusée tant qu'un prêt est en cours, avec reconfirmation du mot de passe. | **DÉCIDÉE** | « I approve all 12 » |
| Purge de l'historique à l'ouverture de la base et lors des emprunts et retours. | **DÉCIDÉE** | « I approve all 12 » |
| Historique des prêts rendus gardé 1 an. | **DÉCIDÉE** | « Paquets éprouvés » |
| Anonymisation de l'historique à la suppression de compte, et tombstones. | **DÉCIDÉE** | « Paquets éprouvés » |
| Appel automatique de la purge des journaux de sécurité (au-delà d'un an calendaire). | **DÉCIDÉE** | « 1 an », « Date calendaire Paris » |
| Effacement de l'e-mail tenté des événements à la suppression du compte. | **DÉCIDÉE** | « Garder l'e-mail tenté » |
| Données emprunteur limitées à l'e-mail et au nom affiché, pas de téléphone. | **DÉCIDÉE** | « Paquets éprouvés » |
| Pas de réinitialisation du mot de passe par e-mail ni de 2FA en v1. | **DÉCIDÉE** | « Paquets éprouvés » |
| Conservation des comptes inactifs (3 ans évoqués, non tranché). | à décider | — |
| Journalisation de l'adresse IP ou de l'agent utilisateur, export, filtres et pagination du journal. | à décider (hors périmètre actuel) | — |

Remarques :
- Les données limitées à l'e-mail et au nom affiché, ainsi que l'absence de reset par e-mail et de 2FA, sont déjà respectées par l'incrément 1 (décision 9). Elles restent des contraintes pour les incréments suivants.
- La base prépare l'anonymisation : aucune suppression en cascade des utilisateurs vers les prêts ni vers les ventes (`ON DELETE RESTRICT`, commentaire de tête de `db/index.ts` et commentaire de la migration 2). Les dates de vente sont pour l'instant conservées en clair, sans purge. `security_events` fait exception avec `ON DELETE SET NULL`, pour ne jamais empêcher une suppression de compte.
- Le type d'événement `account_deleted` figure dans la liste fermée du schéma sans qu'aucun code ne l'écrive : c'est à la spec B de le faire, sans avoir besoin d'une migration 4.
- La spec B devra modifier le schéma, le cas échéant, par une nouvelle migration ajoutée à la fin de `MIGRATIONS`.
- « I approve all 12 » couvre douze précisions. Seules celles reprises dans ce document sont documentées ici : vente au comptoir sans paiement, stock indépendant et centimes entiers (décision 13), ainsi que la suppression de compte et la purge (tableau ci-dessus) ; les sept autres ne sont pas reproduites dans ce document et ne doivent pas en être déduites.
- Toute autre règle (durées, montants, seuils, formats) n'est pas décidée tant qu'elle n'apparaît pas dans DECISIONS.json ou dans une spec approuvée.

---

Ce fichier décrit l'architecture réelle de l'état actuel de la branche `main` (fin de la spec A de l'incrément 3), vérifiée dans le code. Les décisions confirmées de l'opérateur font autorité dans `.agent-pipeline/DECISIONS.json`. Si ce fichier et le code divergent, le code fait foi. Les choix d'architecture dérivés sont à réexaminer lorsque leurs déclencheurs se produisent.
