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

---

## Complément du 2026-09-01 — le produit est nommé

**Une API de gestion de bibliothèque.** Prêt, prolongation, retour, réservation
d'exemplaires. Ce complément clôt ce que cette entrée laissait ouvert.

### Les refus métier sont désormais écrits

Ils ne sont plus « déclarés en nombre » : ils sont énumérés, et **relevés sur des
politiques de circulation publiées** plutôt que déduits. Ils vivent dans la
proposition `pipeline/handoffs/s-6y4w-proposal-round1.json` et dans la page
`pipeline/pages/proposition-s-emprunt.html` — 5 fonctionnalités, 24 règles.

Le résultat utile de cette recherche n'est pas une liste de chiffres, c'est leur
**dispersion** :

| Seuil | Étendue observée |
| --- | --- |
| Durée de prêt | 5 jours (LA Law Library) → 28 (livre, Penn) → 42 (audiovisuel, Penn) |
| Plafond d'emprunts | 5 (State Law Library of Texas) → 50 (DC) → 75 (Harris County) |
| Bascule en « perdu » | 29 jours (Madison) → 60 (Chicago) |
| Blocage pour impayés | 50 $ (Oakland) |
| Retrait d'une réservation | 6 jours (Chicago) → 7 (San Jose, Brooklyn, Boston, Wake) → 13 (San Diego) |

**Aucune valeur n'est universelle, alors que chaque refus l'est.** C'est la ligne
de partage que la spec retient : les refus sont le domaine, les seuils sont de la
politique et se configurent. Un seuil écrit en dur devient un déploiement le jour
où le règlement change.

### Les quatre intégrations remplaçables sont nommées

`NotificationSender`, `PaymentGateway`, `FileStore`, `IdentityProvider`.

`analysis.json` en déclarait deux, non nommées. La correction est inscrite dans
le fichier avec sa raison. **La décision 0003 ne change pas** : le catalogue
recommandait déjà hexagonal à partir de deux adaptateurs réellement remplacés. Il
la recommande maintenant sur quatre — *« 4 intégrations que vous comptez
remplacer : c'est exactement le problème que l'hexagonale résout »*. La conclusion
est la même, son fondement est plus solide.

### Ce qui reste ouvert, et qui t'appartient

Cinq décisions attendent dans la proposition. La première commande les autres :
**les seuils sont-ils de la configuration ou du code ?**

---

## Round 2 du 2026-09-01 — les cinq décisions sont prises, le périmètre est arrêté

| # | Décision | Réponse |
| --- | --- | --- |
| 1 | Seuils : configuration ou code ? | **Configuration**, défauts = moyenne des seuils relevés |
| 2 | Amendes | **Constater la dette, ne jamais encaisser** |
| 3 | Intégrations dans la spec | **Un seul port**, `NotificationSender`, adaptateur de journalisation |
| 4 | Appelants | **Guichet d'abord** ; libre-service adhérent en spec 2 |
| 5 | Réservation | **Exemplaire mis de côté nominativement**, avec expiration |

### Les seuils par défaut, et leur arithmétique

| Seuil | Défaut | Calcul |
| --- | --- | --- |
| Durée de prêt | 23 j | moyenne de 21,21,21,21,21,28,42,5 |
| Prolongations | 5 | moyenne de 10,5,5,4,2,2 |
| Plafond d'emprunts | 43 | moyenne de 5,50,75 |
| Plafond de réservations | 43 | **aucune source**, dérivé du plafond d'emprunts |
| Délai « perdu » | 45 j | moyenne de 29,60 |
| Seuil d'impayés | 50 | **source unique** (Oakland), pas une moyenne |
| Retrait d'une réservation | 8 j | moyenne de 6,7,7,7,7,13 |

Trois réserves écrites plutôt que tues : le **plafond d'emprunts** est le chiffre
le plus distordu par la moyenne (43 contre 63 en ne gardant que les
bibliothèques publiques — le 5 vient d'une bibliothèque de droit) ; le **plafond
de réservations** n'est mesuré nulle part ; le **seuil d'impayés** repose sur une
seule source.

### Deux conflits sortis par la confrontation des réponses

La confrontation est exigée dès qu'un round répond à deux décisions ou plus. Elle
a trouvé ce qu'une relecture séparée n'aurait pas vu.

**Décisions 3 × 4 — arbitré par l'opérateur.** Un seul port sans fournisseur
d'identité, mais du libre-service adhérent — qui exige l'identité pour distinguer
« interdit » de « interdit à VOUS ». Résolu en calendrier et non en destination :
guichet d'abord, libre-service en **spec 2**. Le domaine du prêt sera prouvé
avant qu'on lui ajoute l'autorisation.

**Décisions 1 × 2 — conséquence technique, pas un choix de plus.** Barème de
retard configurable + seuil de blocage à 50 : un barème réglé à **zéro** ne
produit aucune dette, le seuil n'est jamais atteint, et le refus « bloqué pour
impayés » est **éteint en silence**. Chaque réponse est défendable seule.
Ensemble, elles suppriment un refus sans que rien ne le dise.

Le périmètre porte donc une règle de cohérence : **la configuration refuse au
démarrage un barème nul accompagné d'un seuil de blocage non nul.** Un refus
qu'on éteint doit l'être par une déclaration, pas par un chiffre.
