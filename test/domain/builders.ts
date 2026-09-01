import { Loan } from '../../src/domain/loan.js';

/**
 * Les dates de référence des scénarios de prêt.
 *
 * Fixes et partagées, parce qu'un test qui invente ses propres dates rend
 * illisible ce qui distingue deux scénarios.
 */
export const START = new Date('2026-01-01T10:00:00Z');

/**
 * Échéance par défaut : START + 23 jours, la durée de prêt configurée.
 */
export const DUE = new Date('2026-01-24T10:00:00Z');

/**
 * Construit un prêt de test, ouvert par défaut.
 *
 * Ce constructeur existe parce que `duplication` a refusé la répétition du
 * montage à travers les spécifications — six lignes significatives dans trois
 * endroits. C'est la note de réutilisation rendue vérifiable : sans le gate,
 * elle aurait été jugée en revue, c'est-à-dire quand quelqu'un y pense.
 *
 * @param overrides - ce que le scénario veut changer du prêt par défaut
 * @returns un prêt prêt à être exercé
 */
export function aLoan(
  overrides: Partial<ConstructorParameters<typeof Loan>[0]> = {},
): Loan {
  return new Loan({
    copyId: 'c1',
    memberId: 'm1',
    startedAt: START,
    dueAt: DUE,
    ...overrides,
  });
}
