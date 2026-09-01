/**
 * Un prêt : l'accord daté entre un adhérent et un exemplaire.
 *
 * C'est le prêt qui porte les règles, pas l'exemplaire ni l'adhérent. Un
 * exemplaire ne « sait » pas s'il est sorti : la question se répond en lisant
 * les prêts qui le concernent.
 *
 * Le retard n'est pas un champ. Il se calcule à une date fournie, parce qu'un
 * retard stocké est faux dès que personne ne fait tourner le calcul qui le
 * met à jour.
 */
export class Loan {
  readonly copyId: string;
  readonly memberId: string;
  readonly startedAt: Date;
  readonly dueAt: Date;
  readonly returnedAt: Date | null;

  /**
   * Les cinq champs passent par un objet plutôt que par cinq paramètres.
   *
   * Ce n'est pas une préférence : `design_limits` borne à quatre paramètres, et
   * il a refusé la version positionnelle. La borne approxime la ségrégation
   * d'interface, et sur cinq valeurs dont quatre sont des chaînes ou des dates,
   * elle a raison — un appelant peut inverser deux dates sans que rien ne le
   * dise.
   *
   * @param loan - l'exemplaire, l'adhérent, les dates de sortie et d'échéance, et le retour éventuel
   */
  constructor(loan: {
    copyId: string;
    memberId: string;
    startedAt: Date;
    dueAt: Date;
    returnedAt?: Date | null;
  }) {
    this.copyId = loan.copyId;
    this.memberId = loan.memberId;
    this.startedAt = loan.startedAt;
    this.dueAt = loan.dueAt;
    this.returnedAt = loan.returnedAt ?? null;
  }

  /**
   * Dit si le prêt court encore.
   *
   * @returns true tant que l'exemplaire n'a pas été rendu
   */
  isOpen(): boolean {
    return this.returnedAt === null;
  }

  /**
   * Jours de retard à une date donnée.
   *
   * La date est fournie plutôt que lue de l'horloge : c'est ce qui rend la
   * règle testable sans attendre, et c'est ce qui garde le domaine pur.
   *
   * @param now - la date à laquelle on interroge le retard
   * @returns le nombre de jours entiers de dépassement, zéro si dans les temps
   */
  daysOverdueAt(now: Date): number {
    const milliseconds = now.getTime() - this.dueAt.getTime();
    if (milliseconds <= 0) return 0;
    return Math.floor(milliseconds / 86_400_000);
  }
}
