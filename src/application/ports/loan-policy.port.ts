/**
 * Les seuils dont les cas d'usage ont besoin, déclarés par eux.
 *
 * C'est la couche interne qui énonce ce qu'elle attend ; l'extérieur s'y plie.
 * L'inverse — importer le type depuis `src/infrastructure/config` — a été
 * écrit puis refusé par deux gardes à la fois : `architecture-check` pour la
 * flèche prise à contresens, et le test d'étanchéité de i-3q8a pour la fuite
 * de la politique dans l'application. Les deux avaient raison.
 *
 * `CirculationPolicy` satisfait cette interface structurellement, sans que
 * personne n'ait à le déclarer : rien ne pointe de l'application vers
 * l'infrastructure.
 */
export interface LoanPolicy {
  /** Durée d'un prêt, en jours. */
  readonly loanPeriodDays: number;
  /** Emprunts simultanés autorisés par adhérent. */
  readonly borrowCeiling: number;
  /** Impayés au-delà desquels les droits sont suspendus. */
  readonly debtBlockThreshold: number;
  /** Montant dû par jour de retard. Zéro désactive les amendes. */
  readonly lateFeePerDay: number;
}

/**
 * Les seuils dont la réservation a besoin.
 *
 * Séparé de `LoanPolicy` pour la même raison que les magasins sont séparés :
 * un cas d'usage déclare ce qu'il lit, et rien d'autre.
 */
export interface HoldPolicy {
  /** Réservations simultanées autorisées par adhérent. */
  readonly holdCeiling: number;
  /** Impayés au-delà desquels les droits sont suspendus. */
  readonly debtBlockThreshold: number;
  /** Délai de retrait d'une réservation mise à disposition, en jours. */
  readonly holdPickupDays: number;
}
