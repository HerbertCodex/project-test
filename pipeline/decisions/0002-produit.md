# 0002 — Ce que nous construisons, et ce qu'il refuse

- **Statut** : décidée, 2026-09-01, par l'opérateur.
- **Ne pas redemander.** Toute précision se fait en éditant ce fichier, pas en reposant la question.

## Décision

Une **API métier** : un service HTTP qui possède ses propres données et qui **refuse** des
opérations pour des raisons venant du métier, pas seulement du format d'entrée.

`project_type` = **backend**. Ce qui tranche entre `backend` et `frontend` n'est pas la
présence d'écrans mais la propriété des données : ce dépôt possède et écrit les siennes.

## Contraintes déclarées

1. **Base de données propre au service.** Le produit possède ses données.
2. **Authentification et données personnelles.** D'où `human_review_paths` : ces chemins ne
   seront jamais approuvés par une machine seule.
3. **Au moins deux intégrations externes réellement remplaçables.**
4. **Domaine mince** : entre 1 et 7 refus métier réels, déclarés en nombre et non énumérés.

## Ce qui reste ouvert, et qui est honnête de dire

Les refus métier ne sont **pas encore énumérés**, et les deux intégrations remplaçables ne
sont **pas encore nommées**. `pipeline/decisions/analysis.json` porte ce fait tel quel plutôt
que des exemples inventés : un domaine de fiction ferait juger l'architecture sur une fiction.
Le premier rôle Produit qui les apprend les écrit ici — il ne redemande pas si elles existent.
