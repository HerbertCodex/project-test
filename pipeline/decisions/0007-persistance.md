# 0007 — Drizzle sur SQLite pour la persistance

- **Statut** : décidée, 2026-09-01, par l'opérateur, **contre ma recommandation**.
- **Ne pas redemander.** Une dépendance installée reste ensuite une décision de
  l'opérateur seul.

## Décision

| Paquet | Version | Rôle |
| --- | --- | --- |
| `drizzle-orm` | ^0.45.2 | prod — construction des requêtes et schéma |
| `better-sqlite3` | ^13.0.3 | prod — pilote SQLite synchrone |
| `drizzle-kit` | ^0.31.10 | dev — génération des migrations |
| `@types/better-sqlite3` | ^9.6.0 | dev — types |

## Ce que j'avais recommandé, et pourquoi je ne le maintiens pas

J'avais recommandé PostgreSQL avec un client SQL mince, en avançant qu'un ORM
ajoute une seconde modélisation qui finit par diverger du domaine.

**Cet argument porte mal sur Drizzle**, et le dire est plus honnête que de le
laisser flotter. Drizzle n'est pas un ORM à entités comme TypeORM ou Prisma :
son schéma est une déclaration de TABLES, proche du SQL, sans cycle de vie
d'objet ni chargement paresseux. Le risque que je décrivais — deux modèles du
métier en concurrence — est nettement plus faible ici.

## Ce que le choix de SQLite change réellement

Il change **le mécanisme qui tient le refus fondateur**, pas sa solidité.

Le vrai risque de concurrence dans ce produit n'est pas multi-processus : c'est
l'entrelacement au sein d'un même processus Node. Deux requêtes peuvent lire les
prêts d'un exemplaire, s'interrompre sur un `await`, et insérer chacune leur
prêt. Un verrou de ligne PostgreSQL aurait fermé ça ; SQLite le ferme autrement
et mieux :

> **un index unique partiel sur `copy_id` là où `returned_at IS NULL`.**

La base refuse alors physiquement un second prêt ouvert sur le même exemplaire,
quel que soit l'entrelacement. C'est une garantie de schéma et non de
verrouillage, et elle est plus difficile à contourner par accident.

**Ce que ça coûte quand même** : la démonstration devra être écrite au niveau de
l'application, avec deux appels entrelacés, et non par deux processus. Le test
sera moins spectaculaire, il prouvera la même chose.

## Conséquence sur les gates

`npm audit` reste **vert**. `drizzle-kit` traîne quatre advisories `esbuild`,
toutes **moderate**, et le seuil déclaré est `high`. C'est vérifié et non
supposé : `npm audit --audit-level=high` sort 0, et `--omit=dev` ne trouve rien.
À revisiter si le seuil descend un jour.

Les postinstall d'`esbuild` sont bloqués par npm. Sans effet pour le produit :
`drizzle-kit` ne sert qu'à générer des migrations, hors du chemin d'exécution.
