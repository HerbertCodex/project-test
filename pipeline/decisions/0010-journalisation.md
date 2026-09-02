# 0010 — Les incidents vont sur stderr, la plateforme les collecte

- **Statut** : décidée, 2026-09-02, par l'opérateur, **après correction d'un
  constat que j'avais mal formulé**.

## Le constat était faux, et c'est le point de départ

`i-73em` a clos en déclarant : « le journal n'a aucune destination configurée
dans ce dépôt ». Répété tel quel dans la PR #3. **C'est inexact.**

Mesuré sur le binaire construit, en faisant tomber l'application sur une base
non migrée :

```
$ curl -X POST /loans -d '{"copyId":"c1","memberId":"m1"}'
{"type":"/problems/internal-error","title":"InternalError","status":500,
 "detail":"erreur interne","instance":"/loans#b7e0e5e0-83e3-4b9f-8b61-d99f9c4ba7b6"}

# stderr du processus :
[Nest] ERROR [RefusalFilter] incident b7e0e5e0-83e3-4b9f-8b61-d99f9c4ba7b6
SqliteError: no such table: copies
    at Database.prepare (…/better-sqlite3/lib/methods/wrappers.js:5:21)
```

L'occurrence rendue au client se retrouve mot pour mot sur **stderr**, suivie de
la pile réelle. La destination existait ; ce qui manquait, c'était de l'avoir
vérifiée et décidée. J'ai déclaré une absence là où il y avait une ignorance.

## Décision

**Le logger par défaut de NestJS, vers stdout/stderr. Aucune dépendance.**

C'est le contrat de la douzième règle des *twelve-factor apps* : l'application
écrit un flux, elle ne choisit ni fichier, ni rotation, ni rétention. Le
collecteur est le problème de qui exécute le processus — `docker logs`,
`journald`, un agent — et le dépôt n'a pas à en décider à sa place.

Ce que ça évite : une dépendance de journalisation, un chemin de fichier codé
dans le produit, et une rotation à maintenir. Ce que ça coûte : rien tant que le
processus tourne sous un superviseur ; tout si quelqu'un le lance dans un
terminal et ferme la fenêtre.

## Ce qui reste vrai et n'est pas résolu ici

- **Aucune rétention n'est garantie par le dépôt.** Retrouver un incident vieux
  d'une semaine dépend entièrement de la plateforme d'exécution.
- **L'occurrence est un uuid v4, sans horodatage.** La chercher suppose de
  balayer tout le journal plutôt qu'une fenêtre. Suffisant tant que le volume
  est faible ; un identifiant ordonnable serait meilleur si le journal grossit.
- **Un refus métier n'est pas journalisé, délibérément.** C'est une issue
  prévue, pas un incident ; les journaliser noierait les vraies pannes sous le
  bruit des règles qui font leur travail.

## La leçon, qui dépasse le sujet

**Un constat déclaré n'est pas un constat vérifié.** Celui-ci a été reporté par
deux issues, écrit dans le store, puis publié dans une PR — et il était faux.
Personne ne l'avait mesuré, moi le premier. Déclarer une limite sans la mesurer
coûte la même chose que la taire : dans les deux cas, on agit sur autre chose que
la réalité.
