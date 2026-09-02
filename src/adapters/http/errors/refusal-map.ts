/**
 * La correspondance entre un refus métier et son code HTTP.
 *
 * Elle vit dans l'adaptateur et nulle part ailleurs : le domaine ne connaît pas
 * HTTP, et c'est ici qu'un refus exprimé dans le vocabulaire du métier devient
 * un code qu'un client comprend.
 *
 * **Aucune valeur n'est dans la plage 5xx, et c'est la règle qui compte le
 * plus.** Une panne de la technique et un refus du métier ne se ressemblent
 * pas ; les confondre fait chercher un incident là où il y a une règle.
 *
 * L'exhaustivité est tenue par le type `RefusalName` et vérifiée par un test
 * qui lit les sources du domaine et de l'application. Une table qui a seulement
 * l'air complète est une table qui manquera le prochain refus.
 */
export const REFUSAL_STATUS = {
  CopyAlreadyOnLoan: 409,
  CopySetAsideForAnother: 409,
  CopyNotOnLoan: 409,
  NothingToReserve: 409,

  BlockedByDebt: 403,
  BlockedByDebtForHold: 403,
  BlockedByDebtForRenewal: 403,
  MembershipExpired: 403,
  BorrowCeilingReached: 403,
  HoldCeilingReached: 403,
  TitleIsHeldByAnother: 403,
  AlreadyHoldsACopy: 403,

  LoanCannotBeRenewed: 422,
  RenewalLimitReached: 422,

  UnknownParty: 404,
  UnknownMember: 404,
  NothingToRenew: 404,
} as const;

/**
 * Les noms de refus que la table couvre.
 *
 * Ce type est ce qui rend l'exhaustivité vérifiable à la COMPILATION plutôt
 * qu'au démarrage : un refus ajouté au domaine sans entrée ici fait échouer
 * `tsc` chez celui qui l'écrit, et non en production chez celui qui l'appelle.
 */
export type RefusalName = keyof typeof REFUSAL_STATUS;

/**
 * Le code HTTP d'un refus métier.
 *
 * @param refusal - l'erreur levée par le domaine ou un cas d'usage
 * @returns le code correspondant, ou null si le refus n'est pas cartographié
 */
export function statusFor(refusal: Error): number | null {
  const name = refusal.name as RefusalName;
  return name in REFUSAL_STATUS ? REFUSAL_STATUS[name] : null;
}
