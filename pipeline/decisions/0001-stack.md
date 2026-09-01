# 0001 — La stack est NestJS + TypeScript ESM, et elle est imposée

- **Statut** : décidée, 2026-09-01, par l'opérateur.
- **Ne pas redemander.** Cette entrée existe pour que la question ne remonte jamais.

## Décision

Le produit se construit sur la stack déjà présente dans le dépôt, déclarée imposée par
l'opérateur :

| Rôle | Outil | Preuve dans le dépôt |
| --- | --- | --- |
| Framework | NestJS 12 | `package.json` → `@nestjs/core`, `nest-cli.json` |
| Langage | TypeScript 6, ESM natif | `tsconfig.json` → `module: nodenext`, `package.json` → `"type": "module"` |
| Tests | Vitest 4 (+ `@vitest/coverage-v8`) | `vitest.config.ts`, `vitest.config.e2e.ts` |
| Tests HTTP | supertest | `test/app.e2e-spec.ts` |
| Lint | oxlint | `oxlint.json` |
| Format | Prettier | `.prettierrc` |

## Pourquoi

Les manifests la prouvent. Aucune commande n'a été reprise d'un autre projet : chaque
gate a été écrit contre l'outil que ce dépôt possède déjà.

## Conséquences

- Les extensions d'import restent en `.js` dans les sources `.ts` (`nodenext` l'exige) ;
  c'est un invariant du profil, refusé par `check`.
- Aucune dépendance nouvelle n'a été nécessaire pour installer la pipeline. En ajouter une
  reste une décision de l'opérateur seul.
