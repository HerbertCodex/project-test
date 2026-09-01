# 0004 — Plusieurs contributeurs écrivent en parallèle

- **Statut** : décidée, 2026-09-01, par l'opérateur. **Ne pas redemander.**

## Décision

`concurrent_workers` = `few` — quelques personnes ou agents, une seule équipe.

## Conséquence

C'est ce qui rend le découpage par couche technique (`layered`) excessif : chaque feature y
traverse les trois dossiers, donc tout le monde édite les mêmes fichiers. Le découpage retenu
(hexagonal, puis un module Nest par capacité à l'intérieur) laisse à chaque travail une zone
réservable sans collision.
