# 0009 — Problem Details (RFC 9457) pour les erreurs, corps nu pour les succès

- **Statut** : décidée, 2026-09-02, par l'opérateur. **Remplace `0008`.**
- **Ne pas redemander.** La forme des réponses est arrêtée.

## Décision

**Erreurs** — tous les statuts 4xx et 5xx, en `application/problem+json` :

```json
{
  "type": "/problems/copy-already-on-loan",
  "title": "CopyAlreadyOnLoan",
  "status": 409,
  "detail": "l'exemplaire c1 porte deja un pret ouvert",
  "instance": "/loans"
}
```

**Succès** — corps nu, comme avant l'enveloppe :

```json
{ "copyId": "c1", "memberId": "m1", "dueAt": "2026-09-25T03:19:34.115Z" }
```

`fields` s'ajoute en *extension member* pour les seules erreurs de saisie.

## Ce que ça annule

L'intercepteur `EnvelopeInterceptor` **disparaît**. Le `{data}` posé par `i-7iw7`
a vécu une journée. Ce n'est pas du travail perdu : les tests qui le
garantissaient sont réécrits sur la forme nouvelle, et les deux propriétés qui
comptaient — *toutes les erreurs ont la même forme*, *deux 404 se distinguent par
un champ et non par une structure* — sont exactement celles que 9457 tient.

## Pourquoi la norme plutôt que le format maison

`application/problem+json` est **reconnu par des outils tiers** : générateurs de
clients, passerelles, bibliothèques. `{data}`/`{error}` n'est reconnu par rien —
il faut lire la documentation pour le découvrir. C'était le seul argument que
j'avais maintenu en 0008 après avoir concédé l'autre.

**Ce que ça coûte, et il faut le dire** : le client a désormais **deux formes**
selon le statut, là où 0008 lui en donnait une. Pour une API dont les refus sont
le cœur — sept sur le seul emprunt — c'est un vrai coût, et c'était le meilleur
argument de 0008. Il est payé en échange de l'interopérabilité.

## Les champs, et comment ils sont remplis

| Champ | D'où il vient |
| --- | --- |
| `type` | dérivé du nom du refus, jamais écrit à la main |
| `title` | le nom du refus |
| `status` | `REFUSAL_STATUS`, inchangé |
| `detail` | le message du refus, propre à cette requête |
| `instance` | le chemin appelé |

**`title` porte le nom du refus et non un libellé français**, et c'est délibéré.
Un libellé lisible serait une SECONDE table à tenir en accord avec
`REFUSAL_STATUS`, donc un endroit de plus où diverger, pour un gain nul tant que
`detail` est déjà en français et déjà propre à l'occurrence. À revisiter le jour
où quelqu'un affiche ces messages à un lecteur final.

## Ce que ça ne change pas

- `REFUSAL_STATUS` reste la seule source des statuts, et
  `REFUSAL_MAP_IS_EXHAUSTIVE` continue de le vérifier à la compilation.
- Le défaut fondateur de 0008 reste fermé : URL inconnue et adhérent inconnu
  gardent la même forme et se distinguent par `type`.
- Le document OpenAPI n'est toujours pas enveloppé, et décrit désormais Problem
  Details sur les erreurs et le corps nu sur les succès.
