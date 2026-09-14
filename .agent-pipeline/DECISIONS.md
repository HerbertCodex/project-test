# Decision Ledger

Ledger hash: 8e78ff0a0b97a04b22fd3fecc8ccd17a2ce821d722ddb0c1fe1072ac5c24a08e

## D-domain-librairie — Nature du lieu ou de la collection gérée (« librairie »)

Value: Non résolu : on sait seulement qu'il s'agit de gérer des livres avec une fonction d'emprunt. Le type d'établissement reste à clarifier.
Status: ambiguous
Enforcement: product
Source: operator
Source quote: Je veux faire une app de gestion de librairie
Clarification: Par « librairie », voulez-vous dire une bibliothèque (prêt de livres à des adhérents), une librairie commerciale qui propose aussi le prêt, ou la gestion d'une collection personnelle ou associative prêtée à des proches ?

Plausible interpretations:
- Bibliothèque (anglicisme de « library ») : catalogue, adhérents, prêts et retours, sans vente.
- Librairie commerciale (vente de livres) qui propose en plus un service de prêt.
- Collection personnelle ou associative dont on suit les livres prêtés à des proches.

En français, « librairie » désigne un commerce qui vend des livres. Associé à « emprunter », le mot peut aussi être un anglicisme (library = bibliothèque) ou viser une collection personnelle ou associative. Le modèle métier diffère beaucoup. Le squelette reste neutre (page d'accueil générique et endpoint de santé), donc cela ne bloque pas le bootstrap.

## D-borrowing-capability — Fonction d'emprunt

Value: L'application doit permettre d'emprunter (des livres). Qui emprunte, les conditions et le suivi des retours restent à définir par Product.
Status: confirmed
Enforcement: product
Source: operator
Source quote: qui permet d'emprunter

L'existence de la fonction d'emprunt n'a qu'une interprétation matérielle. Ses règles (durée, limites, retards, réservations, exemplaires) sont des décisions Product et ne sont pas inventées ici.

## D-stack-sveltekit — Framework applicatif

Value: SvelteKit.
Status: confirmed
Enforcement: bootstrap
Source: operator
Source quote: je veux ca SvelteKit

Préférence technologique explicite de l'opérateur, qui remplace le socle Node.js sans dépendance et la forme « backend d'abord » proposés auparavant.

## D-sveltekit-fullstack-variant — Variante d'utilisation de SvelteKit

Value: SvelteKit full-stack : pages et code serveur (endpoints, hooks, futurs load et form actions) dans une seule application.
Status: proposed
Enforcement: bootstrap
Source: derived

L'emprunt demande un état central côté serveur. La variante full-stack le fournit sans second service. Si l'opérateur ne voulait SvelteKit que pour le frontend, on pourra ajouter un backend séparé plus tard sans jeter ce squelette.

## D-typescript — Langage

Value: TypeScript strict, vérifié par svelte-check.
Status: proposed
Enforcement: bootstrap
Source: derived

Configuration standard de SvelteKit, utile pour le futur modèle de domaine et les types de route générés.

## D-package-manager-npm — Gestionnaire de paquets et lockfile

Value: npm. Aucun lockfile fabriqué : `package-lock.json` sera généré par le premier `npm install` après approbation, puis commité.
Status: proposed
Enforcement: bootstrap
Source: derived

Livré avec Node.js, aucune préférence exprimée. Les consignes interdisent de fabriquer un lockfile.

## D-adapter-auto — Adaptateur de déploiement

Value: @sveltejs/adapter-auto jusqu'au choix de l'hébergement.
Status: deferred
Enforcement: deferred
Source: derived

L'hébergement de production est reportable et ne doit pas bloquer le bootstrap.

## D-no-persistence-auth-yet — Persistance, comptes et authentification

Value: Aucune base de données, aucun compte et aucune authentification dans le squelette. À décider après le modèle métier.
Status: deferred
Enforcement: deferred
Source: derived

Ces choix dépendent des réponses Product (qui emprunte, données collectées, volume) et peuvent être ajoutés sans risque après le squelette.

## D-local-bind-default — Exposition réseau par défaut

Value: En développement, le serveur écoute sur localhost (comportement par défaut de `vite dev`, sans option `--host`).
Status: proposed
Enforcement: bootstrap
Source: derived

L'exposition est inconnue (securityContext) : on n'expose rien sur le réseau par défaut.

## D-baseline-web-security — Sécurité web de base

Value: CSP SvelteKit en mode auto (script-src, object-src, base-uri et form-action restreints) et hook serveur ajoutant nosniff, Referrer-Policy et X-Frame-Options.
Status: proposed
Enforcement: bootstrap
Source: derived

Le squelette sert désormais une interface web. Ces protections sont bien moins coûteuses dès le départ qu'ajoutées après coup.

## D-tests-vitest — Outil de test

Value: Vitest (`npm test` lance `vitest run`), en environnement node.
Status: proposed
Enforcement: bootstrap
Source: derived

Réutilise la configuration Vite et SvelteKit, et permet de tester les handlers serveur sans démarrer de serveur.

