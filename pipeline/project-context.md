# Contexte du dépôt

Ce fichier est la source de trois blocs injectés dans l'entrée du harnais par
`apply-profile`. Il s'édite ici, jamais dans la cible générée.

<!-- agent:summary -->
**API métier NestJS.** Un service HTTP qui possède ses propres données et qui
refuse des opérations pour des raisons venant du métier, pas seulement du format
d'entrée. `project_type` : `backend`.

L'architecture est **hexagonale** — `adapters → application → domain`, le domaine
n'important rien du dépôt. Ce n'est pas une préférence : c'est ce que
`node scripts/architecture-check.mjs` refuse, et la décision `pipeline/decisions/0003-architecture.md`
en donne la raison calculée (deux intégrations que l'opérateur compte réellement
remplacer).

L'état du produit à cette date : le dépôt porte encore le scaffold « Hello World »
livré par Nest. Aucune règle métier n'est écrite. Les refus métier existent —
l'opérateur les a déclarés en nombre (domaine mince, 1 à 7) — mais **ne sont pas
encore énumérés**, et les deux intégrations remplaçables ne sont pas encore
nommées. C'est écrit tel quel dans `pipeline/decisions/analysis.json` plutôt
qu'illustré par des exemples inventés.
<!-- /agent -->

<!-- agent:commands -->
Les gates se désignent par leur clé, jamais par leur commande. La table qui fait
foi est `commands` dans `pipeline.config.json` ; ce qui suit est le raccourci du
quotidien.

| Clé | Commande | Ce qu'elle refuse |
| --- | --- | --- |
| `check` | `npx tsc --noEmit -p tsconfig.json` | `any`, `!`, extension `.js` manquante |
| `audit` | `npm audit --audit-level=high` | une dépendance vulnérable |
| `lint` | `npx oxlint --type-aware --deny-warnings src test` | promesse flottante, variable inutilisée, `debugger` |
| `format` | `npx prettier --check "src/**/*.ts" "test/**/*.ts"` | mise en forme |
| `build` | `npm run build` (`nest build`) | ce qui ne compile pas |
| `test_unit` | `npx vitest run` | `**/*.spec.ts` |
| `test_e2e` | `npx vitest run --config ./vitest.config.e2e.ts` | `**/*.e2e-spec.ts` |
| `smoke` | `node scripts/smoke.mjs` | une application qui démarre et refuse tout |
| `architecture` | `node scripts/architecture-check.mjs` | un import à contresens des flèches |
| `design_limits` | `node scripts/design-limits.mjs` | 60 lignes, 4 paramètres, profondeur 3, complexité 10 ; Liskov et ouvert-fermé écrits noir sur blanc |
| `comment_policy` | `node scripts/comment-policy.mjs` | la narration et le code commenté |
| `decisions_lint` | `node scripts/decisions-lint.mjs` | une décision remplacée qui ne le dit pas, ou un remplacement qui n'est lié que d'un côté |
| `commit_subjects` | `node scripts/commit-subjects.mjs` | un commit en avance dont le sujet ne nomme aucune issue et qui ne se déclare pas `direct:` |
| `secrets_scan` | `node scripts/secrets-scan.mjs` | un secret dans les sources |
| `project_map` | `node scripts/project-map.mjs --check` | une carte périmée |
| `map_coverage` | `node agent-pipeline/scripts/map-coverage.mjs` | une carte vide |

Régénérer la carte : `node scripts/project-map.mjs`. C'est l'Orchestrateur qui la
réécrit, et c'est le seul rôle à qui `file_policy` l'autorise.

Le port du smoke se surcharge par `SMOKE_PORT` (3111 par défaut) : le `3000` de
`main.ts` est souvent déjà pris en local.
<!-- /agent -->

<!-- agent:context -->
**Limites acceptées, et il vaut mieux les connaître que les redécouvrir.**

- **Le scaffold Nest n'est pas rangé dans les couches.** `src/app.controller.ts`,
  `src/app.service.ts` et `src/app.controller.spec.ts` sont exemptés nommément
  dans `architecture.unzoned_legacy`. Le gate mord donc sur tout fichier
  **nouveau** dès aujourd'hui, au lieu d'être désactivé en attendant une refonte.
  Retirer ces trois lignes est le travail de la première issue qui touche ces
  fichiers — pas un nettoyage à faire en passant.
- **`mutation` n'est pas configuré.** Aucun outil de mutation n'est installé, et
  en installer un est une décision de l'opérateur. La clé est donc absente plutôt
  que pointée sur un substitut : un gate qui ne mesure pas ce qu'il annonce est
  pire qu'un gate manquant.
- **`coverage` ne porte aucun seuil.** Il produit le rapport ; personne ne l'a
  encore étalonné sur ce code. Poser un chiffre rond avant de mesurer, c'est le
  faire desserrer au premier run — et un seuil desserré une fois se desserre
  encore.
- **`architecture-check` ne lit que les imports relatifs.** Un import de paquet
  ne traverse aucune couche de ce dépôt. Une dépendance interdite introduite via
  un alias de chemin ne serait pas vue ; il n'y a pas d'alias déclaré à ce jour.
- **`comment_policy` juge par forme.** Il refuse un commentaire court qui ne dit
  pas *pourquoi*. Un commentaire long échappe à la règle : la borne est à douze
  mots, et c'est un compromis, pas une vérité.
- **`commit_subjects` ne regarde que ce qui est en avance sur `origin/main`.**
  Un sujet déjà poussé n'est plus corrigeable sans réécrire une branche publiée.
  Le cas s'est présenté une fois et a été réglé par une réécriture d'historique :
  quinze commits ont changé de sha, dont trois enregistrés dans le store, pour un
  mot de sujet. Corrigé avant le push, c'est un `amend` — c'est tout l'écart que
  ce gate existe pour ne plus payer.
- **Les incidents vont sur stderr** (décision 0010), avec l'occurrence rendue au
  client dans `instance`. Vérifié sur le binaire construit, pas déduit. Aucune
  rétention n'est garantie par le dépôt : c'est la plateforme qui collecte.
- **`lint` est type-aware, donc plus lent.** Il charge l'information de types
  pour refuser une promesse flottante (décision 0005). C'est délibéré : sans
  `--type-aware`, oxlint lit la règle et n'applique rien.
- **Ce dépôt n'a plus de commande de déploiement.** `@nestjs/mau` a été retirée
  avec le script `deploy` (décision 0005). En vouloir une de nouveau est une
  décision, pas une réparation.
- **Deux dépendances ont bougé à l'installation, et deux seulement**, toutes
  deux autorisées par l'opérateur et consignées en 0005. Les quatre bornes de
  `design_limits` sont celles d'oxlint, qui les portait déjà. Toute dépendance
  suivante reste une décision de l'opérateur seul.
<!-- /agent -->
