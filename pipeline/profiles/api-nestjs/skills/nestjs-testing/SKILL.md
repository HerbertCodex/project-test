---
name: nestjs-testing
description: Écrire des tests dans ce dépôt — Vitest en ESM, harnais NestJS, et ce qu'on ne mocke pas.
applies_to: backend
---

# Tester dans ce dépôt

Ce que le cœur de la pipeline dit du TDD reste vrai partout et vit dans
`skills/tdd`. Ce fichier ne porte que ce qui serait faux dans un projet d'une
autre stack.

## Deux suites, deux configurations, et elles ne se croisent pas

| Suite | Fichiers | Configuration | Gate |
| --- | --- | --- | --- |
| Unitaire | `**/*.spec.ts` | `vitest.config.ts` | `test_unit` |
| Bout en bout | `**/*.e2e-spec.ts` | `vitest.config.e2e.ts` | `test_e2e` |

Les deux déclarent `globals: true` : `describe`, `it` et `expect` sont
disponibles sans import, et `tsconfig.json` les type via `types: ["vitest/globals"]`.
Ajouter `import { describe } from 'vitest'` n'est pas faux, mais crée deux
conventions dans le même dépôt.

**Un fichier prouvé seulement en e2e ne doit pas compter comme non couvert.**
`coverage` mesure ce que `vitest run --coverage` exécute ; si un jour la
couverture est mesurée sans la suite e2e, elle mesure autre chose que ce
qu'elle annonce.

## Le harnais NestJS, et pourquoi il ne se recopie pas

`Test.createTestingModule({...}).compile()` construit un module d'injection
réel. C'est ce qui rend le test crédible : les mêmes providers, les mêmes
décorateurs, la même résolution.

C'est aussi ce qui se recopie le plus vite. Le cœur de la pipeline a mesuré
exactement ce cas ailleurs : le bootstrap e2e complet copié dans trois suites,
pendant que la carte du projet annonçait neuf harnais réutilisables. Avant
d'écrire un `createTestingModule`, cherche dans `docs/project-map.md` : les
harnais y figurent sous `test harness`.

`duplication` refuse six lignes significatives répétées. Un bootstrap e2e en
fait plus que six.

## Ce qu'on ne mocke pas

- **Le module Nest lui-même.** Mocker `AppModule` teste le mock.
- **Le domaine.** `src/domain/**` n'a aucune dépendance sortante — c'est la
  raison d'être de l'architecture hexagonale retenue (décision 0003). Un test
  de domaine n'a donc rien à mocker : s'il en a besoin, c'est le domaine qui a
  dérivé, et `architecture` le refusera.
- **Ce qu'on veut prouver.** Le port se mocke ; la règle qui l'utilise, jamais.

## `app.close()` n'est pas optionnel

Une application e2e non fermée laisse un handle ouvert et Vitest attend.
`test:debug` existe pour ce cas (`--inspect-brk --no-file-parallelism`), mais le
`afterEach(async () => { await app.close(); })` reste la règle.
