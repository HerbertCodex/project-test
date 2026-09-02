# 0008 — Une enveloppe `{data}` / `{error}` sur toutes les routes

- **Statut** : **REMPLACÉE par `0009-problem-details.md`**, le 2026-09-02, le jour
  même où elle avait été prise.
- Décidée le 2026-09-02 par l'opérateur, contre ma recommandation ; **annulée le
  même jour par le même opérateur**, cette fois dans le sens que je
  recommandais. Elle est conservée et non effacée : le constat qui l'a motivée —
  quatre formes de réponse, deux 404 indiscernables — reste vrai et reste la
  raison d'être de 0009.
- Ce qui a changé entre les deux : rien dans les faits, tout dans
  l'information. L'opérateur a demandé ce qu'était RFC 9457 après avoir tranché,
  et a tranché autrement une fois la réponse lue. C'est écrit ici parce qu'une
  décision prise sans une information qu'on n'avait pas encore n'est pas une
  faute — la cacher en serait une.

## Le défaut constaté

Mesuré sur le binaire construit, pas déduit de la lecture : l'application rendait
**quatre formes différentes**.

| Cas | Ce qui sortait |
| --- | --- |
| Succès 201 | `{"copyId":…,"memberId":…,"dueAt":…}` — nu, et différent par route |
| Refus métier 409 | `{"refusal":"CopyAlreadyOnLoan","message":…}` |
| Validation 400 | `{"message":[…],"error":"Bad Request","statusCode":400}` |
| Route inconnue 404 | `{"message":"Cannot POST /nope","error":…,"statusCode":404}` |

Le plus gênant n'est pas la variété : c'est qu'un adhérent inconnu et une URL
inconnue rendent **tous deux un 404, sous deux formes différentes**. Un client ne
peut pas les distinguer sans renifler le corps, et renifler un corps est
exactement ce qu'un contrat existe pour éviter.

## Décision

**Succès** — toutes les routes, tous les statuts 2xx :

```json
{ "data": { "copyId": "c1", "memberId": "m1", "dueAt": "2026-09-25T03:19:34.115Z" } }
```

**Erreur** — toutes les routes, tous les statuts 4xx et 5xx :

```json
{ "error": { "code": "CopyAlreadyOnLoan", "message": "l'exemplaire c1 porte deja un pret ouvert" } }
```

`fields` s'ajoute à `error` pour les seules erreurs de validation, où le client a
besoin de savoir quels champs reprendre.

**`meta` n'est pas posé maintenant.** L'enveloppe laisse la place pour une
pagination future, ce qui est un argument de forme et non un besoin d'aujourd'hui.
Un `meta: {}` systématique serait du bruit dans chaque réponse pour un usage que
personne n'a encore.

**`code` reste croisé avec `REFUSAL_STATUS`.** C'est l'ancien champ `refusal`
sous un autre nom : la garantie d'exhaustivité vérifiée à la compilation
(`REFUSAL_MAP_IS_EXHAUSTIVE`) et le croisement avec la documentation OpenAPI
continuent de porter sur lui.

## Ce que j'avais recommandé, et pourquoi je ne le maintiens pas

J'avais recommandé **Problem Details (RFC 9457)** pour les erreurs seules, en
avançant deux choses : que c'est une norme IETF plutôt qu'un format maison, et
qu'envelopper les succès ajoute un niveau d'imbrication sans contrepartie,
puisque le corps EST déjà la donnée et que le statut HTTP porte déjà l'issue.

**Le premier argument tient toujours, le second porte moins que je ne le disais.**
Une enveloppe uniforme donne au client une seule structure à apprendre, succès
compris, au lieu de deux règles selon le statut. Pour une API dont les refus sont
le cœur du produit — sept sur l'emprunt seul — un client passe son temps à
basculer entre les deux branches, et une forme unique lui épargne cette bascule.
Ça ne fait pas disparaître le coût de l'imbrication ; ça le paie pour quelque
chose.

Ce que je continue de noter, sans en faire un blocage : `application/problem+json`
est reconnu par des outils tiers, `{data}`/`{error}` ne l'est par aucun. Si un
intégrateur extérieur arrive un jour avec un client générique, ça se paiera là.

## Ce que ça engage

- Le contrat de **chaque route change**, y compris celles déjà livrées. Les
  routes qui restent à écrire — prolonger, réserver, expirer, déclarer perdu —
  seront écrites directement sous l'enveloppe, ce qui est la raison pour laquelle
  cette issue passe **avant** elles.
- La documentation OpenAPI doit décrire l'enveloppe, sans quoi elle décrirait un
  corps que l'API ne rend plus — et une documentation fausse est pire qu'absente.
- L'enveloppe ne doit **pas** s'appliquer à la page OpenAPI elle-même, dont le
  document a sa propre forme normalisée. C'est un point à vérifier et non à
  supposer : la façon dont Swagger monte ses routes décide si un intercepteur
  global les traverse.
