import type {
  HoldAvailableNotice,
  NotificationSender,
} from '../../application/ports/notification-sender.port.js';

/**
 * Ce à quoi on écrit. Une fonction plutôt qu'un objet de journalisation :
 * l'adaptateur n'a besoin de rien de plus, et le test n'a rien à simuler.
 */
export type WriteLine = (line: string) => void;

/**
 * L'adaptateur livré : il écrit dans le journal, et rien d'autre.
 *
 * Aucun fournisseur tiers n'entre dans cette spec — décision 3 de l'opérateur.
 * Le remplacer par un envoi d'e-mails réel est un changement d'adaptateur, pas
 * un changement du domaine, et c'est précisément ce que le port achète.
 */
export class LoggingNotificationSender implements NotificationSender {
  /**
   * @param write - où écrire la ligne
   */
  constructor(private readonly write: WriteLine) {}

  /**
   * Écrit la mise à disposition dans le journal.
   *
   * @param notice - qui prévenir, pour quel titre, et jusqu'à quand
   * @returns une promesse qui aboutit
   */
  holdAvailable(notice: HoldAvailableNotice): Promise<void> {
    this.write(
      `reservation disponible: adherent=${notice.memberId} titre=${notice.titleId} ` +
        `exemplaire=${notice.copyId} retrait_avant=${notice.pickupBy.toISOString()}`,
    );
    return Promise.resolve();
  }
}

/**
 * Enveloppe un expéditeur pour qu'il tienne le contrat « ne lève jamais ».
 *
 * L'échec est tracé, jamais avalé : un envoi perdu sans trace est pire qu'un
 * envoi perdu, parce que personne ne peut le constater. Mais il ne remonte pas
 * à l'appelant, sinon un retour de document échouerait parce qu'un serveur de
 * messagerie est tombé.
 *
 * @param sender - l'expéditeur à protéger
 * @param write - où tracer l'échec
 * @returns un expéditeur qui aboutit toujours
 */
export function forgiving(
  sender: NotificationSender,
  write: WriteLine,
): NotificationSender {
  return {
    holdAvailable: async (notice: HoldAvailableNotice): Promise<void> => {
      try {
        await sender.holdAvailable(notice);
      } catch (error) {
        write(
          `notification perdue pour l adherent ${notice.memberId}: ${String(error)}`,
        );
      }
    },
  };
}
