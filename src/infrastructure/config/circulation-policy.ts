/**
 * Les seuils de circulation, et rien d'autre.
 *
 * Ils vivent ici et nulle part ailleurs. Les politiques publiées relevées
 * pendant la rédaction de la spec vont de 5 à 42 jours de prêt et de 5 à 75
 * emprunts simultanés : aucune valeur n'est universelle, alors que chaque
 * refus l'est. Un seuil écrit dans le domaine serait donc le règlement d'une
 * bibliothèque particulière, figé dans le cœur du produit.
 */
export interface CirculationPolicy {
  /** Durée d'un prêt, en jours. */
  loanPeriodDays: number;
  /** Nombre de prolongations autorisées sur un même prêt. */
  renewalLimit: number;
  /** Emprunts simultanés autorisés par adhérent. */
  borrowCeiling: number;
  /** Réservations simultanées autorisées par adhérent. */
  holdCeiling: number;
  /** Retard au-delà duquel un prêt bascule en « perdu », en jours. */
  lostAfterDays: number;
  /** Impayés au-delà desquels les droits sont suspendus. */
  debtBlockThreshold: number;
  /** Délai de retrait d'une réservation mise à disposition, en jours. */
  holdPickupDays: number;
  /** Montant dû par jour de retard. Zéro désactive les amendes. */
  lateFeePerDay: number;
}

/**
 * Les valeurs par défaut, arrêtées par l'opérateur au round 2 de la spec.
 *
 * Chacune est la MOYENNE des seuils relevés sur des politiques publiées, sauf
 * deux qui sont signalées comme telles dans le journal de décisions :
 * `holdCeiling` n'a aucune source et est dérivé de `borrowCeiling`, et
 * `debtBlockThreshold` repose sur une source unique.
 */
export const DEFAULT_POLICY: CirculationPolicy = {
  loanPeriodDays: 23,
  renewalLimit: 5,
  borrowCeiling: 43,
  holdCeiling: 43,
  lostAfterDays: 45,
  debtBlockThreshold: 50,
  holdPickupDays: 8,
  lateFeePerDay: 0.2,
};

/**
 * Refus : deux seuils qui, ensemble, éteignent un refus du domaine.
 */
export class IncoherentPolicy extends Error {
  /**
   * @param reason - ce qui ne tient pas, en nommant les clés en cause
   */
  constructor(reason: string) {
    super(reason);
    this.name = 'IncoherentPolicy';
  }
}

/**
 * Les clés d'environnement, une par seuil.
 */
const ENV_KEYS: Record<keyof CirculationPolicy, string> = {
  loanPeriodDays: 'LOAN_PERIOD_DAYS',
  renewalLimit: 'RENEWAL_LIMIT',
  borrowCeiling: 'BORROW_CEILING',
  holdCeiling: 'HOLD_CEILING',
  lostAfterDays: 'LOST_AFTER_DAYS',
  debtBlockThreshold: 'DEBT_BLOCK_THRESHOLD',
  holdPickupDays: 'HOLD_PICKUP_DAYS',
  lateFeePerDay: 'LATE_FEE_PER_DAY',
};

/**
 * Refuse une combinaison de seuils qui supprime un refus sans le dire.
 *
 * Le cas visé vient de la confrontation de deux décisions de l'opérateur,
 * défendables séparément : les amendes sont calculées, et les seuils sont
 * configurables. Ensemble, un barème réglé à zéro ne produit jamais de dette,
 * le seuil de blocage n'est jamais atteint, et le refus « bloqué pour
 * impayés » cesse d'exister — en silence, ce qui est le pire des deux.
 *
 * Désactiver les amendes reste légitime : il faut le déclarer des deux côtés.
 *
 * @param policy - les seuils à vérifier
 * @throws {IncoherentPolicy} si le barème est nul alors que le blocage ne l'est pas
 */
export function assertCoherent(policy: CirculationPolicy): void {
  if (policy.lateFeePerDay === 0 && policy.debtBlockThreshold > 0) {
    throw new IncoherentPolicy(
      'lateFeePerDay vaut 0 alors que debtBlockThreshold vaut ' +
        `${policy.debtBlockThreshold} : aucune dette ne naitra jamais, ` +
        'donc le refus pour impayes ne se declenchera jamais. ' +
        'Mettez debtBlockThreshold a 0 pour desactiver les amendes explicitement.',
    );
  }
}

/**
 * Lit les seuils depuis l'environnement, et refuse une politique incohérente.
 *
 * L'environnement est passé en argument plutôt que lu de `process.env` : c'est
 * ce qui rend la règle exerçable par un test sans muter l'état du processus.
 *
 * @param env - les variables d'environnement
 * @returns les seuils, défauts appliqués pour ce que l'environnement ne dit pas
 * @throws {IncoherentPolicy} si la combinaison éteint un refus
 */
export function loadPolicy(
  env: Record<string, string | undefined>,
): CirculationPolicy {
  const entries = Object.entries(ENV_KEYS) as [
    keyof CirculationPolicy,
    string,
  ][];
  const policy = { ...DEFAULT_POLICY };
  for (const [field, key] of entries) {
    const raw = env[key];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (Number.isNaN(value))
      throw new IncoherentPolicy(`${key} n'est pas un nombre : ${raw}`);
    policy[field] = value;
  }
  assertCoherent(policy);
  return policy;
}
