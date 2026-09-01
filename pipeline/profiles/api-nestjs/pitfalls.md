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
