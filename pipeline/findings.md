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
