# 0003 — L'architecture est hexagonale (ports et adaptateurs)

- **Statut** : décidée, 2026-09-01, par l'opérateur, sur recommandation argumentée.
- **Ne pas redemander.** `pipeline.config.json` → `architecture` en est la copie exécutable.

## Décision

```json
"architecture": { "id": "hexagonal", "project_type": "backend" }
```

| Couche | Chemins | Peut importer |
| --- | --- | --- |
| `domain` | `src/domain/**` | **rien** |
| `application` | `src/application/**` | `domain` |
| `adapters` | `src/adapters/**`, `src/infrastructure/**` | `application`, `domain` |

Sens de dépendance : `adapters → application → domain`.

## Pourquoi, et sur quelles réponses

La page rendue (`node agent-pipeline/scripts/render-architecture.mjs pipeline/pages/architecture.html backend pipeline/decisions/analysis.json`)
juge hexagonal **recommandé**, et sa raison est celle-ci, calculée et non affirmée :

> « 2 intégrations que vous comptez remplacer : c'est exactement le problème que résout hexagonal. »

C'est le seul axe qui décide du sort d'hexagonal. Si le nombre d'adaptateurs réellement
remplacés retombait à zéro, les ports deviendraient une cérémonie payée à chaque route — et
cette entrée devrait être rouverte, pas contournée.

## Ce qui a été écarté, et pourquoi

| Option | Verdict calculé | Raison |
| --- | --- | --- |
| Un dossier par feature | recommandé aussi | Moins cher, mais n'isole pas le domaine des intégrations qu'on remplacera. |
| Par couche technique | excessif | Plusieurs agents en parallèle éditent tous les mêmes dossiers. |
| Clean / Onion | excessif | Domaine mince (1–7 règles) : un invariant à protéger, pas un domaine à isoler. |

`feature-sliced` apparaît recommandé par l'analyse mais ne s'applique qu'au `frontend` ; la
page le signale comme contradiction entre les deux déclarations, elle ne l'efface pas.

## Conséquences exécutables

- `commands.architecture` → `node scripts/architecture-check.mjs` refuse tout import qui
  remonte le sens des flèches. Une architecture écrite seulement dans un document serait une
  intention, pas une architecture.
- L'invariant correspondant est dans `pipeline/profiles/api-nestjs/invariants.md`, et il
  nomme ce gate.
