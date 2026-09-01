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
  readonly lostAt: Date | null;
  readonly renewals: number;

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
    lostAt?: Date | null;
    renewals?: number;
  }) {
    this.copyId = loan.copyId;
    this.memberId = loan.memberId;
    this.startedAt = loan.startedAt;
    this.dueAt = loan.dueAt;
    this.returnedAt = loan.returnedAt ?? null;
    this.lostAt = loan.lostAt ?? null;
    this.renewals = loan.renewals ?? 0;
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

  /**
   * Dit si le retard dépasse le délai au-delà duquel on cesse d'attendre.
   *
   * Le délai est passé en argument : c'est du règlement, pas du domaine.
   *
   * @param now - la date à laquelle on juge
   * @param lostAfterDays - le délai configuré
   * @returns true si le prêt devrait basculer en perdu
   */
  isLostAt(now: Date, lostAfterDays: number): boolean {
    return this.isOpen() && this.daysOverdueAt(now) > lostAfterDays;
  }

  /**
   * @returns true si le prêt a été déclaré perdu
   */
  isLost(): boolean {
    return this.lostAt !== null;
  }

  /**
   * Déclare le prêt perdu, sans effacer ce qui précède.
   *
   * L'échéance et la date de sortie sont conservées : une dette qu'on ne peut
   * pas expliquer à l'adhérent est une dette qu'on finit par annuler.
   *
   * @param at - la date de la bascule
   * @returns le prêt, désormais perdu
   */
  declareLostAt(at: Date): Loan {
    return new Loan({
      copyId: this.copyId,
      memberId: this.memberId,
      startedAt: this.startedAt,
      dueAt: this.dueAt,
      returnedAt: this.returnedAt,
      lostAt: at,
      renewals: this.renewals,
    });
  }

  /**
   * Dit si ce prêt peut encore être prolongé.
   *
   * Le prédicat vit ici plutôt que dans le cas d'usage de prolongation, parce
   * que deux issues le référencent — celle de la perte et celle de la
   * prolongation — et qu'une règle énoncée à deux endroits finit par diverger.
   *
   * Ce qu'il ne dit PAS : si le titre est réservé par quelqu'un d'autre. Cette
   * condition-là dépend de la file, que le prêt ne connaît pas, et elle reste
   * au cas d'usage.
   *
   * @returns true si ni rendu ni perdu
   */
  canBeRenewed(): boolean {
    return this.isOpen() && !this.isLost();
  }

  /**
   * Prolonge le prêt à partir d'aujourd'hui.
   *
   * L'échéance repart de la date du jour et NON de l'ancienne échéance : sur
   * un prêt déjà en retard, repartir de l'échéance dépassée ne rendrait rien
   * à l'adhérent.
   *
   * Le compteur avance, il ne se remet jamais à zéro — sinon un adhérent
   * garderait un titre indéfiniment en prolongeant sans fin.
   *
   * @param now - la date de la prolongation
   * @param loanPeriodDays - la durée de prêt configurée
   * @returns le prêt prolongé
   */
  renewFrom(now: Date, loanPeriodDays: number): Loan {
    return new Loan({
      copyId: this.copyId,
      memberId: this.memberId,
      startedAt: this.startedAt,
      dueAt: new Date(now.getTime() + loanPeriodDays * 86_400_000),
      returnedAt: this.returnedAt,
      lostAt: this.lostAt,
      renewals: this.renewals + 1,
    });
  }
}
