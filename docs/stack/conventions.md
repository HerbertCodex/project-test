# Conventions de ce dépôt

Relues par QA. Ce qui est ici est ce qu'aucun gate ne peut refuser tout seul :
dès qu'une règle devient mécanisable, elle quitte ce fichier pour
`pipeline/profiles/api-nestjs/invariants.md`, qui nomme le gate qui la refuse.

## Où va un fichier

L'architecture est hexagonale (décision `pipeline/decisions/0003-architecture.md`),
et `architecture` refuse un import à contresens.

| Ce que tu écris | Où | Ce qu'il peut importer |
| --- | --- | --- |
| Une règle métier, un refus, une entité | `src/domain/` | **rien de ce dépôt** |
| Un cas d'usage, une orchestration | `src/application/` | `domain` |
| Un contrôleur HTTP, un dépôt, un client tiers | `src/adapters/` | `application`, `domain` |
| Le câblage technique, la configuration | `src/infrastructure/` | `application`, `domain` |

**La question qui tranche** : est-ce que ce code changerait si on remplaçait la
base de données ou un fournisseur externe ? Si oui, il est dans `adapters` ou
`infrastructure`. Si non, il est dans `domain` ou `application`.

Un fichier sous `src/` qui n'est dans aucune couche est refusé. C'est voulu :
c'est ce qui empêche `src/utils/` de naître.

## Nommer

Le suffixe dit la nature, et la carte du projet le lit :

- `*.controller.ts` — un adaptateur HTTP entrant. Ne contient aucune règle.
- `*.service.ts` — un `@Injectable`. En `application`, c'est un cas d'usage.
- `*.repository.ts` — un adaptateur sortant vers le stockage.
- `*.module.ts` — un assemblage Nest.
- `*.spec.ts` / `*.e2e-spec.ts` — les deux suites, jamais mélangées.

Un port — l'interface que le domaine déclare et qu'un adaptateur implémente —
vit avec le code qui s'en sert, dans `application` ou `domain`, jamais à côté de
son implémentation. Un port rangé près de son adaptateur est un port qui a déjà
cessé d'en être un.

## Le refus métier est une valeur, pas un code HTTP

Le domaine ne connaît pas HTTP. Un refus s'exprime dans son vocabulaire — une
exception de domaine, un résultat typé — et c'est **l'adaptateur** qui le traduit
en 409, 403 ou 422.

Lever une `HttpException` depuis `src/domain/` ou `src/application/` importerait
`@nestjs/common` dans le cœur. `architecture` ne l'attrape pas — il ne lit que
les imports relatifs — donc c'est ici que la règle vit, et c'est en revue qu'elle
se tient.

## Écrire un commentaire

`comment_policy` refuse un commentaire court qui ne dit pas *pourquoi*. Ce n'est
pas une chasse au commentaire : c'est une chasse au commentaire qui redit le
code, parce que celui-là périme sans que rien ne le signale.

- Sur un export : un bloc `/** */` qui énonce le **contrat**. Toujours accepté.
- Dans un corps : la **raison**, le piège, la décision. Jamais le déroulé.
- Du code commenté : supprimé. Git garde ce qui a été effacé.

## Avant d'ajouter quoi que ce soit

Lis `docs/project-map.md`. C'est la seule réponse à « est-ce que ça existe
déjà ? », et la note de réutilisation due par tout ajout est jugée contre elle.
Elle cite les harnais de test sous `test harness` — c'est là que les bootstraps
e2e se recopient le plus vite.

Régénérer : `node scripts/project-map.mjs`.

## Ce que ce dépôt ne fait pas encore

- Aucune règle métier n'est écrite. Le scaffold `AppController` / `AppService`
  est antérieur à la décision d'architecture et exempté nommément.
- `src/domain/`, `src/application/`, `src/adapters/` et `src/infrastructure/`
  n'existent pas encore. Le premier travail qui en a besoin les crée.
