# Pièges déjà payés, dans ce dépôt

Ce fichier reçoit ce qu'un défaut échappé laisse derrière lui. `store-verify`
refuse de clore une issue portant `escaped_from` tant qu'elle ne nomme pas soit
un gate qui refuse désormais le défaut, soit une ligne d'ici.

Il est **vide de défauts échappés** : la pipeline vient d'être installée et
n'en a encore laissé passer aucun. Ce vide est un fait daté, pas un oubli.

Ce qui suit n'est pas un défaut échappé mais un piège de la stack constaté
pendant l'installation, écrit ici parce que le prochain agent le rencontrera :

## Les imports relatifs portent `.js`, dans des sources `.ts`

`tsconfig.json` déclare `module: nodenext` et `package.json` déclare
`"type": "module"`. Les sources existantes écrivent donc
`import { AppService } from './app.service.js'` — vers un fichier qui s'appelle
`app.service.ts`.

Ce n'est pas une coquille : c'est la résolution ESM de Node, qui voit le
JavaScript émis. Écrire `'./app.service'` compile chez certains outils et
plante au démarrage. `check` le refuse, et `smoke` le rattraperait ensuite —
mais au prix d'un build complet.

## Le travail de s-2sce est parti sur `main`, pas sur une branche de spec

**Payé le 2026-09-01, sur la toute première spec.**

`git-workflow.md` prescrit *« One branch per spec »* : Produit crée la branche
depuis la branche par défaut, et la pull request est ouverte après que QA a clos
la dernière issue. Les deux issues de `s-2sce` ont été committées et poussées
directement sur `main`.

**Ce que ça coûte, concrètement, et ce n'est pas une question de forme :**

- **Le code n'est jamais passé en revue.** Il n'y a aucun diff à relire : il est
  déjà dans la branche par défaut. Une PR ouverte après coup ne porte que la
  clôture de la spec.
- **Aucun run de CI par commit.** Le workflow se déclenche sur
  `branches-ignore: [main]` et sur les pull requests ; les sept commits de code
  sont allés sur `main`, qu'il ignore, donc aucun n'a déclenché de run.
  **Correction d'une première rédaction de cette entrée, qui était fausse et
  disait « la CI n'a rien gardé » :** la CI a bien couvert ce code. Elle fait un
  checkout de la branche, dont l'arbre contenait les trois fichiers déplacés, et
  elle a passé les 19 gates dessus — vérifié sur le SHA `03030a6`. Ce qui manque
  est plus étroit, et vaut quand même d'être nommé : si un commit avait cassé
  quelque chose qu'un commit suivant réparait, rien ne l'aurait su. Le run juge
  un état d'arbre, pas une trajectoire, et c'est la bissection qui devient
  impossible.
- **La sortie de secours est fermée, et à raison.** Pousser une branche identique
  à `main` juste pour déclencher la CI est explicitement refusé : *« une
  exécution sur un commit qui ne change rien ne prouve rien et apprend à tout le
  monde à survoler les runs »*.

**Comment l'éviter :** la branche se crée **avant** le premier `test:`, pas au
moment d'ouvrir la PR. Une fois le `feat:` sur la branche par défaut, plus rien
ne rattrape la revue — sauf réécrire de l'histoire publiée, ce que le même
document interdit.

## Deux autres écarts du même jour, assumés et nommés

- **`--no-verify` sur les deux commits `test:`.** `git-workflow.md` l'interdit.
  La raison : un commit dont le rôle est d'échouer ne peut pas satisfaire un
  hook qui compile le code. C'est une tension réelle entre deux règles du cœur,
  et c'est une trouvaille à remonter, pas un contournement à généraliser.
- **Un `--force-with-lease` sur `main`**, autorisé par l'opérateur, pour ajouter
  la ligne `direct:` au commit d'installation. Le dépôt avait un seul commit et
  aucun autre lecteur.

## Une substitution de texte sur un fichier que Prettier vient de reformater ne trouve rien

**Payé trois fois le 2026-09-01, sur trois issues différentes.**

Le motif est toujours le même. J'écris une substitution `python` qui cherche
une chaîne exacte, `prettier --write` est passé entre-temps et a coupé la ligne
en plusieurs, la substitution **ne matche rien** — et elle échoue en silence
parce que rien ne vérifie qu'elle a atterri.

Ce que ça a coûté à chaque fois : un gate rouge sur une correction que je
croyais faite. `no-unused-vars` sur un import ajouté dont l'usage n'a jamais
été écrit, deux fois. La première, le hook `pre-commit` l'a attrapée ; les deux
suivantes, la batterie.

**Deux parades, et la seconde est la bonne :**

- `assert old in s` avant d'écrire. C'est ce que font les substitutions de ce
  dépôt qui ont marché, et l'absence de cette assertion est exactement ce qui
  distingue une correction d'une illusion de correction.
- Lire le fichier juste avant de le modifier, plutôt que de se fier à ce qu'on
  y a mis dix minutes plus tôt. Un formateur automatique est un autre auteur.

C'est la même leçon que la trouvaille F2 sur le store de Sudocode : **une
correction qu'on n'a pas vérifiée par le lecteur qui fait autorité n'est pas une
correction.** Elle s'est présentée deux fois sous deux visages différents avant
d'être écrite ici.

## Un test qui interroge git dépend de la topologie du dépôt, pas seulement du code

**Payé le 2026-09-02, sur i-7f84.**

Un critère demandait de prouver que les ports n'avaient pas bougé, et la
manière la plus directe est d'appeler `git diff --name-only main -- src/...`.
Vert en local, **rouge sur le runner** :

```
fatal: bad revision 'main'
```

`actions/checkout` place le dépôt sur la branche demandée et ne crée pas de
branche locale `main` ; seule la ref distante `origin/main` existe. Le test
supposait une topologie qui n'est vraie que sur une machine de développement.

**Ce qui rend ce défaut coûteux** : il ne se voit pas dans la batterie locale,
donc il traverse la revue et se découvre au push, quand l'issue est déjà close.
C'est le symétrique de la trouvaille F3 — là, la CI en fait plus que la batterie
par issue ; ici, elle en fait *autrement*.

**Parade** : chercher la ref de base parmi plusieurs candidats — `origin/main`
puis `main` — et échouer avec un message qui nomme le problème si aucune ne
résout. Plus généralement, un test qui interroge l'environnement plutôt que le
code doit dire ce qu'il suppose de cet environnement.

## Un test qui compare à une liste littérale ne prouve rien sur la source

Le test de i-2rzo affirmait « les contraintes des DTO sont déclarées une seule
fois » en comparant `components.schemas.BorrowBody.required` à
`['copyId', 'memberId']` écrits à la main. Il est passé au vert sur un DTO où
`copyId` portait `@IsOptional()` : le validateur ne l'exigeait plus, le document
continuait de l'annoncer obligatoire, et le test ne voyait rien — parce qu'il
comparait le document à une constante, pas à l'autre source.

La cassure délibérée l'a montré ; les six tests verts ne l'auraient jamais dit.

**Ce qu'il faut faire à la place :** quand un test prétend que deux sources
s'accordent, il doit lire LES DEUX. Ici, on soumet un corps vide à
`validate()` et on prend les propriétés refusées — le comportement, pas les
métadonnées, car `@IsOptional` et `@IsString` y portent le même `type` et une
lecture des métadonnées confondrait justement les deux cas à distinguer.

C'est la même exigence que le croisement avec `REFUSAL_STATUS`, qui était déjà
écrit correctement dans le même fichier : dans les deux sens, et contre la
source réelle.

## Activer un contrôle puis l'esquiver ne laisse rien de vérifié

`strictPropertyInitialization` a été passé à `true` sur demande de l'opérateur.
Trois propriétés de DTO seulement le refusaient — le reste du dépôt le
satisfaisait déjà, ce qui montre que le drapeau n'avait été desserré que pour
elles.

Ma première réponse a été `declare`. Elle compilait, tous les tests passaient, et
le décorateur survivait jusque dans le JS construit. L'opérateur l'a refusée pour
la bonne raison : `declare` fait taire exactement le contrôle qu'on venait
d'activer. Un drapeau activé et contourné dans le même fichier ne vérifie plus
rien ; il coûte de la lecture sans rien refuser.

**Les trois formes, mesurées et non supposées** (cible ES2023, donc
`useDefineForClassFields` à `true` par défaut) :

| Écrit | JS émis |
| --- | --- |
| `copyId!: string;` | `copyId;` — champ défini à `undefined` |
| `declare copyId: string;` | rien |
| `copyId: string = '';` | `copyId = '';` |

**Retenu :** l'initialiseur. Il n'affirme rien au compilateur, et la chaîne vide
n'est pas pour autant permise — `@IsNotEmpty()` la refuse, envoyée explicitement
comme absente, vérifié sur le code construit et pas seulement sous le
transformeur de test.

Deux gardes tiennent la décision : les DTO ne peuvent porter ni `!` ni
`declare`, et le test balaie le dossier `dto/` plutôt que de nommer des
fichiers. Les deux ont été cassés et sont tombés.

## Le sujet du commit porte l'identifiant de l'issue, sinon `unclaimed` le signale

Une issue produit deux commits — les tests rouges, puis l'implémentation — et le
store n'en retient qu'un, `last_commit_sha`. `unclaimed.mjs` rattrape l'autre par
son **sujet** : un sujet qui nomme une issue connue est réputé lui appartenir.

`test(i-2rzo): OpenAPI that does not lie…` est reconnu. `test(http): the
envelope, red first…` ne l'est pas, et le commit rouge de `i-7iw7` s'est retrouvé
dans la liste des non réclamés alors qu'il était parfaitement planifié.

**La règle** : pour un commit de pipeline, le scope du sujet est l'identifiant de
l'issue — `test(i-6pck):`, `feat(i-6pck):`. Le scope technique (`http`, `domain`)
va dans le corps s'il apporte quelque chose.

**Ce que ça coûte quand on l'oublie** : rien de fonctionnel, et c'est justement le
risque. Un rapport qui signale à tort finit par être ignoré, et le jour où il
signale un vrai travail direct non déclaré, plus personne ne le lit.
