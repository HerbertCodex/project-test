# 0005 — Les deux seules dépendances touchées à l'installation

- **Statut** : décidées, 2026-09-01, par l'opérateur. **Ne pas redemander.**
- Installer une dépendance reste, après cette entrée, une décision de
  l'opérateur seul.

## `@nestjs/mau` retirée

`audit` était rouge : deux advisories **high** (`tmp`, `undici`). Les
dépendances de production étaient saines — `npm audit --omit=dev` sortait
« 0 vulnerabilities ». Les deux advisories arrivaient toutes par
`@nestjs/mau`, une devDependency qui ne servait qu'au script `deploy`
(`nest deploy`). Rien dans `src/`, `test/` ni `scripts/` ne l'importait ; ça a
été vérifié avant de la retirer, pas supposé.

`npm audit fix --force` l'aurait rétrogradée 0.2.6 → 0.0.6, un changement
cassant, pour garder un outil inutilisé.

Le script `deploy` de `package.json` a été retiré avec elle : un script dont
l'outil n'est plus installé est un script qui échoue au premier appel.

**Résultat prouvé** : `npm audit --audit-level=high` → `found 0 vulnerabilities`,
exit 0.

**Ce que ça implique** : ce dépôt n'a plus de commande de déploiement. Le jour
où il en faut une, c'est une décision à prendre, pas un oubli à réparer.

## `oxlint-tsgolint` installée

`oxlint.json` déclarait `@typescript-eslint/no-floating-promises` depuis le
scaffold, et **oxlint n'en faisait rien** : la règle est type-aware et exige ce
paquet. C'était donc une règle écrite que rien n'appliquait — exactement la
forme que cette pipeline existe pour refuser.

Ça a été **mesuré, pas déduit** : une promesse non attendue (`this.later()`)
écrite exprès dans `AppService`, et `lint` sortait 0.

`commands.lint` porte désormais `--type-aware`. La même casse délibérée sort
maintenant 1 :

```
src/app.service.ts:8:5: warning typescript(no-floating-promises):
Promises must be awaited, add void operator to ignore.
```

L'invariant « pas de promesse flottante » est donc repassé du côté
« refusé par un gate » de `invariants.md`. Il y était faux jusqu'ici.

**Ce que ça coûte** : `lint` charge désormais l'information de types, donc il
est plus lent qu'un lint syntaxique. C'est le prix de la seule classe de bug qui
laisse une requête répondre 200 sur du travail qui a échoué.
