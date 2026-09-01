# 0006 — Le cœur `agent-pipeline/` est vendoré, pas un sous-module

- **Statut** : décidée, 2026-09-01, par l'opérateur, au moment de publier.
- **Ne pas redemander**, et surtout : **ne pas « réparer » en le transformant
  en sous-module.**

## Provenance exacte du cœur

| | |
| --- | --- |
| Amont | `https://github.com/HerbertCodex/agent-pipeline.git` |
| Commit | `2a2103a575920b95841b91af552b2b4c30f547f2` |
| Sujet | fix(pipeline): converge reliably after real-world runs |
| Date | 2026-08-31T23:17:28+02:00 |

C'est ce qui rend la suppression du `.git` imbriqué rattrapable : le cœur se
réobtient par `git clone` puis `git checkout 2a2103a575920b95841b91af552b2b4c30f547f2`.

## Décision

`agent-pipeline/.git` a été supprimé. Le contenu du cœur n'a **pas** été
modifié — seul son dépôt imbriqué l'a été — et il est désormais versionné comme
des fichiers ordinaires du projet.

## Pourquoi, et ce que l'autre option coûtait

Laissé tel quel, `git add -A` enregistrait `agent-pipeline` en mode
`160000` : un gitlink. Un clone du dépôt aurait reçu un répertoire **vide**,
et la CI générée aurait échoué sur chacune de ses étapes cœur —
`core-tests`, `briefs-sync`, `profile-sync`, `store-invariants` — plus
tous les gates qui appellent `agent-pipeline/scripts/`.

Un vrai sous-module aurait préservé le lien amont, mais pas fait tourner la CI :
`ci.template.yml` appartient au cœur, il fixe `actions/checkout` sans
`submodules: true`, et le modifier est interdit. L'option qui marche sans
toucher au cœur est donc celle-ci.

C'est aussi ce que le guide d'installation suppose : « il assume que
`agent-pipeline/` vient d'être **copié** à la racine du projet ».

## Conséquence

Mettre à jour le cœur devient un acte délibéré : recloner l'amont, remplacer le
répertoire, relancer `apply-profile` et `sync-briefs`, puis rejouer les
gates. Ce n'est plus un `git pull` silencieux — et vu que le cœur porte les
règles que tout le monde suit, c'est plutôt une bonne nouvelle.
