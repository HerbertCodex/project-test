import type { Loan } from '../../domain/loan.js';
import type { LossStore } from '../ports/loss-store.port.js';
import type { LossPolicy } from '../ports/loan-policy.port.js';

/**
 * Ce que la bascule produit.
 */
export interface LossOutcome {
  /** Les prêts basculés en perdu lors de cet appel. */
  declared: Loan[];
}

/**
 * Cesser d'attendre un document qui ne reviendra pas.
 *
 * C'est une opération APPELABLE, et rien d'autre : aucun ordonnanceur n'est
 * livré ici. Le périmètre approuvé dit que cette spec définit les règles et
 * non le déclencheur, et un test lit ces sources pour s'en assurer.
 */
export class DeclareLossUseCase {
  /**
   * @param store - le port de bascule
   * @param policy - le délai au-delà duquel on cesse d'attendre
   */
  constructor(
    private readonly store: LossStore,
    private readonly policy: LossPolicy,
  ) {}

  /**
   * Bascule tous les prêts dont le retard dépasse le délai configuré.
   *
   * @param now - la date à laquelle on juge les retards
   * @returns les prêts déclarés perdus
   */
  async execute(now: Date): Promise<LossOutcome> {
    const declared: Loan[] = [];
    for (const loan of await this.store.openLoans()) {
      if (!loan.isLostAt(now, this.policy.lostAfterDays)) continue;
      const lost = loan.declareLostAt(now);
      await this.store.markLost(lost);
      await this.store.addReplacementDebt(
        lost.memberId,
        await this.store.replacementCostOf(lost.copyId),
      );
      declared.push(lost);
    }
    return { declared };
  }
}
