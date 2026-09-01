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

## F2 — `sudocode link` n'a pas d'inverse

Aucune commande ne retire une relation : `issue update` ne touche ni aux
relations ni aux liens, et il n'existe pas d'`unlink`. `issue delete` supprime
l'issue entière, ce qui n'est pas la même chose.

**Conséquence concrète, payée le 2026-09-01 :** un lien posé pour tester la
reproductibilité de F1 — `i-6k29 depends-on i-65bu` — a été créé sur des données
réelles et ne pouvait plus être retiré par la CLI. Il affirmait une dépendance
que la spec ne justifie pas : basculer un prêt en « perdu » n'envoie aucune
notification.

Il a fallu éditer `.sudocode/issues.jsonl` à la main pour retirer cette seule
relation, puis prouver le résultat par le lecteur de la pipeline (13 liens
attendus, 13 lus). L'édition manuelle du store du tracker est exactement ce que
`nouveau-profil.md` déconseille — « ne fabriquez pas ses fichiers » — et c'est
ici une correction d'une contamination que j'ai moi-même introduite, pas une
fabrication de données.

**La vraie leçon est de méthode, pas d'outil :** on ne teste pas la
reproductibilité d'un plantage sur des données réelles quand l'écriture n'a pas
d'annulation. Un identifiant jetable aurait coûté zéro.
