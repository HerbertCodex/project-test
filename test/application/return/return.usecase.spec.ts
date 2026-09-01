import { readFileSync } from 'node:fs';
import { Loan } from '../../../src/domain/loan.js';
import { availabilityOf } from '../../../src/domain/availability.js';
import { DEFAULT_POLICY } from '../../../src/infrastructure/config/circulation-policy.js';
import { sourcesUnder } from '../../support/sources.js';
import type { ReturnStore } from '../../../src/application/ports/return-store.port.js';
import {
  ReturnUseCase,
  CopyNotOnLoan,
  type ReturnRequest,
  type ReturnOutcome,
} from '../../../src/application/return/return.usecase.js';

const OUT = new Date('2026-03-01T10:00:00Z');
const DUE = new Date('2026-03-24T10:00:00Z');
const request: ReturnRequest = {
  copyId: 'c1',
  now: new Date('2026-03-20T10:00:00Z'),
};

/**
 * Un magasin en mémoire qui garde ce qu'on lui écrit.
 */
function storeWith(overrides: Partial<ReturnStore> = {}): {
  store: ReturnStore;
  closed: Loan[];
  debts: { memberId: string; amount: number }[];
} {
  const closed: Loan[] = [];
  const debts: { memberId: string; amount: number }[] = [];
  const store = {
    openLoanOfCopy: () =>
      Promise.resolve(
        new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE }),
      ),
    closeLoan: (loan: Loan) => {
      closed.push(loan);
      return Promise.resolve();
    },
    addDebt: (memberId: string, amount: number) => {
      debts.push({ memberId, amount });
      return Promise.resolve();
    },
    ...overrides,
  } as ReturnStore;
  return { store, closed, debts };
}

describe('Rendre un exemplaire', () => {
  it('ferme le pret et rend l exemplaire empruntable, par la disponibilite DERIVEE', async () => {
    const { store, closed } = storeWith();
    const outcome: ReturnOutcome = await new ReturnUseCase(
      store,
      DEFAULT_POLICY,
    ).execute(request);

    expect(closed).toHaveLength(1);
    expect(closed[0].isOpen()).toBe(false);
    expect(availabilityOf('c1', closed)).toBe('available');
    expect(outcome.debt).toBe(0);
  });

  it('REFUS : l exemplaire n est pas en pret', async () => {
    const { store } = storeWith({
      openLoanOfCopy: () => Promise.resolve(null),
    });
    await expect(
      new ReturnUseCase(store, DEFAULT_POLICY).execute(request),
    ).rejects.toThrow(CopyNotOnLoan);
  });

  it('constate une dette egale aux jours de retard fois le bareme', async () => {
    const { store, debts } = storeWith();
    const late = { copyId: 'c1', now: new Date('2026-03-29T10:00:00Z') };
    const outcome = await new ReturnUseCase(store, DEFAULT_POLICY).execute(
      late,
    );

    expect(outcome.debt).toBeCloseTo(5 * DEFAULT_POLICY.lateFeePerDay);
    expect(debts).toEqual([{ memberId: 'm1', amount: outcome.debt }]);
  });

  it('produit une dette nulle avec un bareme nul, sans echouer', async () => {
    const { store, debts } = storeWith();
    const noFines = {
      ...DEFAULT_POLICY,
      lateFeePerDay: 0,
      debtBlockThreshold: 0,
    };
    const late = { copyId: 'c1', now: new Date('2026-03-29T10:00:00Z') };
    const outcome = await new ReturnUseCase(store, noFines).execute(late);

    expect(outcome.debt).toBe(0);
    expect(debts).toEqual([]);
  });

  it('n expose aucun moyen de paiement', () => {
    const offenders = ['src/application/return']
      .flatMap((root) => sourcesUnder(root))
      .filter((path) =>
        /pay|charge|refund|PaymentGateway|stripe/i.test(
          readFileSync(path, 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
