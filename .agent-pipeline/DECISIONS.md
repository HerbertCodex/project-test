# Decision Ledger

Ledger hash: 45168ae15fbcc1fe44c86cca9b4545f3b426381889d214001bb4c08e90d64853

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

## D-domain-librairie-resolved — Nature du lieu ou de la collection gérée (« librairie »)

Value: Librairie commerciale qui vend des livres et propose en plus un service de prêt.
Status: confirmed
Enforcement: product
Source: operator
Source quote: Librairie + prêt

Réponse de l'opérateur à la question de clarification enregistrée pour D-domain-librairie (spec 0eda2681), reprise dans les specs 3ffac906, 36b93132, 91fcb206 et f287f99d.

## D-persistence-auth — Persistance, comptes et authentification

Value: SQLite via better-sqlite3 ; comptes par e-mail et mot de passe d'au moins 12 caractères haché en Argon2id (paquet argon2) ; sessions serveur à expiration absolue de 7 jours ; blocage de 15 minutes après 5 échecs ; pas de réinitialisation par e-mail ni de 2FA en v1.
Status: confirmed
Enforcement: bootstrap
Source: operator
Source quote: Paquets éprouvés

Choix de l'opérateur pour l'authentification, les données et la persistance (spec 0eda2681, révision 2), implémenté dans l'incrément 1 (spec 3ffac906). Remplace le report initial.

## D-visual-direction — Direction visuelle et typographie

Value: « Maison d'édition » : fond ivoire, texte bleu nuit, accent laiton rare ; titres en Cormorant Garamond et texte en Inter, polices OFL auto-hébergées dans static/fonts.
Status: confirmed
Enforcement: bootstrap
Source: operator
Source quote: Maison d'édition

Choisie par l'opérateur après avoir refusé « Functional high-contrast » ; paire de polices validée (« Oui, cette paire »). Implémentée par la spec 91fcb206.

