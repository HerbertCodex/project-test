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

## F1bis — Une boucle de réessai qui relit l'export fabrique des doublons

**Payé le 2026-09-01, en créant les issues de la troisième spec. Erreur de ma
main, née de la combinaison de F1 et F2.**

F1 dit qu'un appel `sudocode` peut abandonner après avoir écrit. Le
contournement écrit était : *« vérifier l'effet plutôt que le code de sortie »*.
Je l'ai appliqué — et j'ai vérifié l'effet **dans le mauvais fichier**.

Sur dix créations, cinq ont abandonné. J'ai écrit une boucle qui comptait les
issues dans `.sudocode/issues.jsonl` et recréait la manquante. Le JSONL est un
export de `cache.db`, et il **retarde** sur la base : mon compte était périmé à
chaque tour. Trois tours, trois doublons.

**Ce que ça apprend, et qui dépasse Sudocode** : un contournement qui dit
« vérifie l'effet » doit dire **où**. F2 avait déjà établi que le JSONL n'est pas
la source ; je l'avais écrit et je ne l'ai pas relié à F1 quand il fallait. Deux
trouvailles justes séparément ne se composent pas toutes seules dans la tête de
celui qui les a écrites.

**Réparation** : `sudocode issue delete <id> --hard`. Sans `--hard`, la commande
**clôt** l'issue au lieu de la supprimer — ce que son nom ne laisse pas deviner,
et ce qui a fait croire à un premier échec.

**Précision constatée le même jour, et elle complique le contournement.** « Le
lecteur qui fait autorité » n'est pas le même selon qui demande :

| Qui lit | Ce qui fait autorité pour lui |
| --- | --- |
| `sudocode issue show` | `cache.db` |
| `readIssueTracker`, donc toute la pipeline | `.sudocode/issues.jsonl` |

Un lien posé peut donc être **présent en base et absent pour la pipeline** tant
que l'export n'a pas tourné — et l'export abandonne lui aussi. Constaté sur
`i-1a3m depends-on i-20xj` : trois `link` abandonnés, `issue show` le montrant
en base, la pipeline ne le voyant pas, et un `sudocode export` réussi suffisant à
réconcilier les deux.

**Le contournement complet est donc :** poser l'écriture, forcer `sudocode
export`, relire par `readIssueTracker`, et ne réessayer l'écriture que si elle
est absente **des deux**.

## F5 — La proposition approuvée vit dans un répertoire que le cadre exige d'ignorer

**Constatée le 2026-09-01, en écrivant le round 2 de la troisième spec.**

Deux exigences du cœur se contredisent.

**La première.** `apply-profile` refuse de rendre tant que `handoffs_dir` n'est
pas ignoré par git — vérifié, c'est ce qui a bloqué l'installation jusqu'à
l'ajout de la ligne. Sa raison est bonne :

> *« un passage de relais committé atterrit dans le diff, où verify-scope le
> signale et où un relecteur le lit comme du travail. »*

**La seconde.** Un `spec_plan` porte `approved_proposal { path, digest_sha256 }`,
et `validate-handoff` **relit le fichier pour recalculer son empreinte**. C'est
le mécanisme qui empêche un plan de dériver d'une proposition modifiée après
approbation — et le document le présente comme le cas qui compte le plus :
« sans lui, on pourrait faire approuver un prêt de quatorze jours et en planifier
trente ».

**Ensemble** : le document dont tout le plan dérive, et dont l'empreinte fait
foi, est rangé là où le cadre interdit de le versionner.

**Mesuré sur ce dépôt** : `pipeline/handoffs/s-6y4w-proposal-round2.json` est
référencé par le plan de la spec la plus importante livrée à ce jour, avec son
digest, et `git ls-files` ne le connaît pas. Sur une machine neuve, un checkout
propre ou un runner de CI, revalider ce plan répondrait
`approved_proposal.path not found`. Personne ne s'en est aperçu parce que la CI
ne valide aucun passage de relais.

**Ce que ça coûte** : la provenance d'une spec livrée est invérifiable après
coup. Le verrou existe, il tient pendant la session qui écrit le plan, et il
disparaît dès qu'on change de machine.

**Contournement retenu pour la suite**, et il ne coûte rien : la proposition
APPROUVÉE est copiée dans `pipeline/decisions/`, qui est versionné, et
`approved_proposal.path` y pointe. Un round intermédiaire reste un passage de
relais ordinaire et reste ignoré ; seule celle que l'opérateur a approuvée
devient une décision, ce qu'elle est de toute façon.

**Ce qui appartient au cœur** : décider si `approved_proposal` doit pointer
ailleurs que dans `handoffs_dir`, ou si le digest doit être conservé dans le
store plutôt que recalculé depuis un fichier. Ce n'est pas au projet de trancher.

## F6 — `comment-policy` juge chaque ligne `//` séparément

**Constatée le 2026-09-02, sur un commentaire d'explication parfaitement
légitime.**

Une explication sur trois lignes `//` a été refusée sur deux d'entre elles :

```
narration — « La ref de base est cherchee parmi plusieurs candidats : `main` n'existe »
narration — « local en echouant sur le runner. »
```

La ligne du milieu contenait un marqueur d'intention, les deux autres non. Le
gate lit chaque ligne comme un commentaire indépendant, alors qu'un bloc `//`
consécutif est **un seul** commentaire pour un lecteur humain.

**Ce que ça coûte** : la même chose que F4 — un faux positif sur du code juste
pousse à réécrire du bon code pour plaire à l'outil. La sortie de secours
documentée existe (un bloc `/** */` n'est jamais refusé) et elle a été employée
ici, mais elle oblige à un style de commentaire inhabituel dans un corps de
fonction.

**Le correctif appartient à l'opérateur** : `scripts/` est refusé à
l'implémenteur. Il consiste à regrouper les `SingleLineCommentTrivia`
consécutifs avant de les juger, et à n'appliquer la borne des douze mots qu'au
bloc entier.

**Deuxième leçon, de méthode et pas d'outil** : ce défaut a été poussé parce que
je n'ai pas rejoué la batterie complète après ma dernière édition. Les hooks ne
couvrent que `lint`, `secrets_scan`, `check` et les cibles générées — pas
`comment_policy`. Une modification après la dernière batterie verte n'est pas
couverte, et c'est exactement là que ce défaut est passé.

## F7 — `store-update.mjs` annonce « written » pour une clé qu'il ignore

**Constaté** en voulant ordonner `i-7iw7` avant les trois issues de routes. J'ai
envoyé une requête portant `issue_fields: { depends_on: [...] }`. Le script a
répondu :

```
written: pipeline/store/issues.jsonl record i-7el4 (1 line remplacee)
```

La ligne a bien été réécrite. **`depends_on` n'a pas bougé.** `issue_fields`
n'existe pas — la surface documentée est `pipeline_state`,
`acceptance_criteria`, `criteria_ledger`, `discoveries_declared`, `spec_state`,
`spec_fields`, `append_context`, `set_status`, `create_record` — et une clé
inconnue est ignorée sans un mot. Le même silence frappe `depends_on` passé dans
`create_record` : il est écrasé par la projection du tracker, ce qui est correct
sur le fond mais muet sur la forme.

**Ce que ça coûte.** Le message de succès dit qu'une écriture a eu lieu, et une
écriture a bien eu lieu — mais pas celle qui était demandée. Un appelant qui fait
confiance à la sortie repart avec une modification qu'il croit appliquée. C'est
plus dangereux qu'un refus : un refus se voit.

**Ce qui m'a sauvé** : avoir relu l'enregistrement au lieu de croire la ligne de
succès. Le contrôle n'était pas dans le processus, il était dans une habitude —
ce qui, selon la règle du dépôt, revient à dire qu'il n'existe pas.

**Le correctif appartient à l'opérateur** (cœur vendoré, non modifiable ici) :
refuser toute clé de requête absente de la surface connue, plutôt que de
l'ignorer. Une clé inconnue est presque toujours une faute de frappe ou une API
imaginée.

**La bonne voie, pour mémoire** : `depends_on` est une PROJECTION des relations
Sudocode. On l'écrit avec `sudocode link <from> <to> -t depends-on`, puis on
rafraîchit l'enregistrement avec `refresh_tracker: true`. C'est ce qui a été fait,
et `next-step` désigne désormais `i-7iw7` de lui-même au lieu de `i-20xj`.
