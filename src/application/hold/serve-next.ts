import type { Hold } from '../../domain/hold.js';
import type { NotificationSender } from '../ports/notification-sender.port.js';

/**
 * La seule chose dont servir la file a besoin d'un magasin.
 *
 * Déclarée ici plutôt qu'importée d'un port existant : le retour et
 * l'expiration ont chacun le leur, et cette capacité est ce qu'ils partagent.
 * Un port qui les couvrirait tous les deux serait un port gras.
 */
export interface HoldServing {
  /**
   * @param hold - la réservation servie
   * @param copyId - l'exemplaire qui lui est affecté
   * @param pickupBy - la date limite de retrait
   */
  setAsideForHold(hold: Hold, copyId: string, pickupBy: Date): Promise<void>;
}

/**
 * Mettre un exemplaire de côté pour une réservation, et prévenir l'adhérent.
 *
 * Extrait parce que `duplication` a trouvé ce bloc dans le retour ET dans
 * l'expiration. Ce n'est pas une répétition de forme : c'est la même règle
 * métier écrite deux fois, et une règle énoncée à deux endroits finit par
 * diverger — exactement la raison qui avait fait poser `canBeRenewed` dans le
 * domaine plutôt que dans deux cas d'usage.
 *
 * C'est une classe et non une fonction, et ce n'est pas un goût : passée en
 * fonction, elle demandait six arguments à chaque appel, `design_limits` en
 * borne quatre, et les deux sites d'appel redevenaient identiques au point que
 * `duplication` les refusait à nouveau. Construite une fois par cas d'usage,
 * elle laisse un appel d'une ligne.
 */
export class QueueServer {
  /**
   * @param store - le magasin qui sait mettre de côté
   * @param notifier - le port de notification
   * @param pickupDays - le délai de retrait configuré
   */
  constructor(
    private readonly store: HoldServing,
    private readonly notifier: NotificationSender,
    private readonly pickupDays: number,
  ) {}

  /**
   * Sert une réservation avec l'exemplaire disponible.
   *
   * La notification part APRÈS la mise de côté : dans l'ordre inverse, un
   * adhérent pourrait être prévenu d'un exemplaire qui ne lui est pas encore
   * affecté, et se le voir refuser au guichet.
   *
   * @param next - la réservation à servir
   * @param copyId - l'exemplaire disponible
   * @param now - la date de mise à disposition, d'où court le délai
   * @returns l'adhérent servi
   */
  async serve(next: Hold, copyId: string, now: Date): Promise<string> {
    const pickupBy = new Date(now.getTime() + this.pickupDays * 86_400_000);
    await this.store.setAsideForHold(next, copyId, pickupBy);
    await this.notifier.holdAvailable({
      memberId: next.memberId,
      titleId: next.titleId,
      copyId,
      pickupBy,
    });
    return next.memberId;
  }
}
