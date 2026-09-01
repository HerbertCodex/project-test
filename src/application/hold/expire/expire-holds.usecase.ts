import { firstWaiting, type Hold } from '../../../domain/hold.js';
import type { ExpireHoldStore } from '../../ports/expire-hold-store.port.js';
import type { HoldPolicy } from '../../ports/loan-policy.port.js';
import type { NotificationSender } from '../../ports/notification-sender.port.js';
import { QueueServer } from '../serve-next.js';

/**
 * Ce que l'expiration produit.
 */
export interface ExpiryOutcome {
  /** Les réservations expirées lors de cet appel. */
  expired: Hold[];
}

/**
 * Expirer les réservations que personne n'est venu retirer.
 *
 * Sans cette règle, un seul adhérent injoignable gèle un titre pour tous ceux
 * qui attendent derrière lui — ce que le périmètre approuvé disait vouloir
 * éviter, et ce qui restait vrai tant que cette issue n'existait pas.
 *
 * C'est une opération APPELABLE : aucun ordonnanceur n'est livré ici, et un
 * test lit ces sources pour s'en assurer.
 */
export class ExpireHoldsUseCase {
  private readonly queue: QueueServer;

  /**
   * @param store - le port d'expiration
   * @param policy - le délai de retrait
   * @param notifier - le port par lequel on prévient le suivant
   */
  constructor(
    private readonly store: ExpireHoldStore,
    private readonly policy: HoldPolicy,
    private readonly notifier: NotificationSender,
  ) {
    this.queue = new QueueServer(store, notifier, policy.holdPickupDays);
  }

  /**
   * Expire toutes les réservations dont le délai de retrait est dépassé.
   *
   * @param now - la date à laquelle on juge les délais
   * @returns les réservations expirées
   */
  async execute(now: Date): Promise<ExpiryOutcome> {
    const expired: Hold[] = [];
    for (const hold of await this.store.readyHolds()) {
      if (!hold.isUncollectedAt(now)) continue;
      await this.store.markExpired(hold);
      expired.push(hold);
      await this.passOn(hold, now);
    }
    return { expired };
  }

  /**
   * Passe l'exemplaire au suivant, ou le libère faute de suivant.
   *
   * Les deux issues sont distinctes et le restent : un exemplaire laissé de
   * côté pour une réservation qui n'existe plus serait invisible et
   * inempruntable.
   *
   * @param hold - la réservation qui vient d'expirer
   * @param now - la date d'expiration, d'où court le nouveau délai
   */
  private async passOn(hold: Hold, now: Date): Promise<void> {
    const copyId = hold.setAsideCopyId;
    if (copyId === null) return;

    const next = firstWaiting(
      hold.titleId,
      await this.store.waitingHolds(hold.titleId),
    );
    if (next === null) {
      await this.store.releaseCopy(copyId);
      return;
    }

    await this.queue.serve(next, copyId, now);
  }
}
