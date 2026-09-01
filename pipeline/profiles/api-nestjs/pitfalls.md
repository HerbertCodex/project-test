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
