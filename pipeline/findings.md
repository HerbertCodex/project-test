# Trouvailles sur l'outillage, hors backlog produit

Ce fichier est `findings_path`. Il reçoit ce qui concerne la pipeline et ses
outils, précisément pour que le backlog du produit ne le porte pas. Le cœur a
mesuré ailleurs ce que coûte l'inverse : 32 trouvailles pour 3 issues closes.

## F1 — `sudocode` plante au démontage du processus, après avoir écrit

**Constaté le 2026-09-01, sudocode 0.2.0, Node v24.20.0.**

Sur 13 appels à `sudocode link`, **8 se sont terminés par un abandon** :

```
node[...]: void node::RemoveEnvironmentCleanupHook(v8::Isolate*, CleanupHook, void*)
           at ../src/api/hooks.cc:142
Assertion failed: (env) != nullptr
Aborted (core dumped)
```

`sudocode status` l'a produit aussi. Ce n'est donc pas propre à `link`.

**Les données ne sont pas perdues.** L'assertion tombe au démontage de
l'environnement Node, une fois l'écriture faite : les 13 relations étaient
présentes à la relecture, et les réessais ont réussi proprement. C'est
intermittent.

**Ce que ça coûte quand même :** un code de sortie non nul sur une commande qui a
réussi. Un script qui teste `$?` conclut à l'échec et réessaie — et un réessai
sur `link` crée un **doublon**, pas une erreur (constaté : `link i-30ip i-19ba`
posé deux fois répond « ✓ Created relationship » les deux fois).

**Contournement :** vérifier l'effet plutôt que le code de sortie. Relire le
graphe avec `readIssueTracker` et compter, ce qui est ce que la pipeline fait de
toute façon.

## F2 — `sudocode link` n'a pas d'inverse, et le JSONL n'est pas la source

**Corrigée le 2026-09-01. Une première rédaction affirmait que le lien avait été
retiré par édition du JSONL. C'était faux, et c'est la pipeline qui l'a dit, pas
moi en relisant.**

Aucune commande ne retire une relation : `issue update` ne touche ni aux
relations ni aux liens, il n'existe pas d'`unlink`, et `issue delete` supprime
l'issue entière.

**Ce qui a été payé le 2026-09-01.** Un lien posé pour tester la reproductibilité
de F1 — `i-6k29 depends-on i-65bu` — a été créé sur des données réelles. Il
affirme une dépendance que le périmètre approuvé ne justifie pas : basculer un
prêt en « perdu » n'envoie aucune notification.

Trois tentatives de retrait, et ce qu'elles ont appris :

1. **Édition directe de `.sudocode/issues.jsonl`** → le lien est revenu. Le JSONL
   est un **export** de `cache.db`, pas la source. La prochaine écriture de
   Sudocode — ici l'appel CLI de `tracker-sync --apply` — l'a réécrit depuis la
   base, et l'édition a disparu sans un mot.
2. **`sudocode import` puis `export`** → le lien est revenu aussi. L'import
   ajoute et met à jour ; il ne supprime pas ce que le JSONL ne porte plus.
3. **Conclusion** : avec l'outillage disponible, une relation posée est
   définitive. Seule la suppression puis recréation de l'issue l'effacerait, au
   prix d'un nouvel identifiant.

**C'est la pipeline qui a attrapé l'illusion**, et par un mécanisme qui ne
cherchait pas ça : la révision liée de `i-6k29` ne correspondait plus à la
révision vivante, donc `store-verify` et `tracker-sync` ont refusé avec
`tracker binding scope`. Une correction qui se croyait faite a été démentie par
un hachage. C'est exactement ce que la liaison optimiste existe pour faire.

La liaison a ensuite été rebranchée par `refresh_tracker`, et l'écart est
conservé dans `tracker_scope_changes` — l'historique garde la trace des deux
révisions au lieu de l'effacer.

**Deux leçons, et la seconde est la vraie :**

- On ne teste pas la reproductibilité d'un plantage sur des données réelles quand
  l'écriture n'a pas d'annulation. Un identifiant jetable aurait coûté zéro.
- **Une correction qu'on n'a pas vérifiée n'est pas une correction.** J'ai écrit
  « retiré », prouvé par une relecture immédiate du JSONL, et j'avais tort :
  je lisais un fichier que la base allait écraser. La preuve doit passer par le
  lecteur qui fait autorité, pas par le fichier le plus proche.

## F3 — `closure_gates` n'a aucun effet sur la CI générée

**Constaté le 2026-09-01, sur le premier push d'une branche de spec.**

La configuration déclare :

```json
"closure_gates": ["coverage","test_e2e","smoke","audit","duplication","dead_code","map_coverage"]
```

Le document d'installation présente cette clé comme « les gates exécutés une
fois sur la pull request plutôt qu'à chaque push — ce qui est trop lent à
rejouer par commit ».

**Or la CI les exécute quand même à chaque push.** `deferredGates` est codé en
dur dans `lib.mjs` :

```js
return new Set(["project_map", "map_coverage"].filter(...))
```

et c'est cette fonction seule qui pose le `if: github.event_name == 'pull_request'`
sur une étape. `closure_gates` ne pilote que `perIssueGates` et `gatesForIssue` —
donc ce qu'une issue DOIT, pas ce que la CI FAIT.

**Conséquence mesurée, deux fois dans le même push :**

1. `duplication` est rouge. C'était un vrai défaut — le montage de `Loan`
   recopié dans trois endroits — mais QA avait clos `i-ne4e` sur la batterie par
   issue, qui ne contient pas `duplication`. **Une issue peut donc se clore
   verte et la branche partir rouge.**
2. `dead_code` est rouge, et là ce n'est PAS un défaut : les exports du domaine
   sont consommés par leurs tests et par les issues `i-699g` et suivantes, qui
   sont planifiées et déclarées mais pas encore écrites. Le gate n'a de sens
   qu'en fin de spec, exactement comme `closure_gates` l'annonce.

**Ce que ça coûte :** une branche rouge pendant toute la durée de la spec, pour
un gate dont l'opérateur a déclaré qu'il ne devait pas tourner là. Et le cœur
l'écrit lui-même à propos des gates différés : *« un job rouge par construction
est un job que les gens cessent de lire »*.

**Ce n'est pas contournable côté projet.** `deferredGates` appartient au cœur,
qu'on ne modifie pas. Les deux seules issues sont dans `pipeline.config.json`,
donc chez l'opérateur : élargir la portée d'un gate, ou accepter le rouge.

## F4 — `scripts/comment-policy.mjs` lit un littéral d'expression régulière comme un commentaire

**Constaté le 2026-09-01, sur du code que le gate a refusé à tort.**

Ce code, parfaitement légitime, a été refusé :

```ts
.replace(/\/\*[\s\S]*?\*\//g, ' ')
```

Le gate a rapporté `narration — « g, ' ') »`. Il lit le `/*` du littéral comme
l'ouverture d'un commentaire de bloc.

**La cause.** `scripts/comment-policy.mjs` parcourt les jetons avec
`ts.createScanner`, et le scanner de TypeScript ne distingue pas seul une
division d'un littéral d'expression régulière : il faut le lui demander par
`reScanSlashToken()` selon le contexte. Sans ça, tout `/` ouvre potentiellement
un commentaire.

**Ce que ça coûte.** Un faux positif sur du code juste. Et c'est la catégorie de
défaut la plus chère pour un gate : quelqu'un finit par contourner en réécrivant
un code correct pour plaire à l'outil, ce que j'ai failli faire.

**Contournement employé ici**, et il se défend tout seul :

```ts
const BLOCK_COMMENT = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
```

**Le vrai correctif appartient à l'opérateur** : `scripts/` est refusé à
l'implémenteur par `file_policy`, et à raison — c'est l'outillage qui juge le
code, pas l'inverse. Il consiste à traiter le jeton `SlashToken` avec
`reScanSlashToken` quand le contexte autorise une expression régulière.

**Ce que ce gate a quand même bien fait le même jour** : refuser trois vraies
narrations dans les issues précédentes. Un outil qui a un faux positif n'est pas
un outil inutile — il est un outil dont on connaît la limite, et c'est pour ça
qu'elle est écrite ici.
