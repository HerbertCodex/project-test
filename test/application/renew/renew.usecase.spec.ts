import { Hold } from '../../../src/domain/hold.js';
import { Loan } from '../../../src/domain/loan.js';
import { Member } from '../../../src/domain/member.js';
import { DEFAULT_POLICY } from '../../../src/infrastructure/config/circulation-policy.js';
import type { RenewStore } from '../../../src/application/ports/renew-store.port.js';
import {
  RenewUseCase,
  TitleIsHeldByAnother,
  RenewalLimitReached,
  LoanCannotBeRenewed,
  BlockedByDebtForRenewal,
  type RenewRequest,
} from '../../../src/application/renew/renew.usecase.js';

const OUT = new Date('2026-03-01T10:00:00Z');
const DUE = new Date('2026-03-24T10:00:00Z');
const LATE = new Date('2026-04-10T10:00:00Z');
const request: RenewRequest = { copyId: 'c1', memberId: 'm1', now: LATE };

function storeWith(overrides: Partial<RenewStore> = {}): { store: RenewStore; saved: Loan[] } {
  const saved: Loan[] = [];
  const store = {
    openLoanOfCopy: () =>
      Promise.resolve(new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE })),
    memberById: () => Promise.resolve(new Member('m1', new Date('2027-01-01T00:00:00Z'), 0)),
    titleOfCopy: () => Promise.resolve('t1'),
    waitingHolds: () => Promise.resolve([]),
    save: (loan: Loan) => {
      saved.push(loan);
      return Promise.resolve();
    },
    ...overrides,
  } as RenewStore;
  return { store, saved };
}

describe('Prolonger un pret', () => {
  const renew = (store: RenewStore): RenewUseCase => new RenewUseCase(store, DEFAULT_POLICY);

  it('repousse l echeance depuis AUJOURD HUI, pas depuis l ancienne echeance', async () => {
    const { store } = storeWith();
    const renewed = await renew(store).execute(request);

    expect(renewed.dueAt).toEqual(new Date('2026-05-03T10:00:00Z'));
    expect(renewed.dueAt.getTime()).toBeGreaterThan(DUE.getTime() + 23 * 86_400_000);
  });

  it('REFUS : un autre adherent a reserve le titre', async () => {
    const { store } = storeWith({
      waitingHolds: () =>
        Promise.resolve([new Hold({ titleId: 't1', memberId: 'm2', placedAt: OUT })]),
    });
    await expect(renew(store).execute(request)).rejects.toThrow(TitleIsHeldByAnother);
  });

  it('mais accepte quand la seule reservation est celle de l emprunteur', async () => {
    const { store } = storeWith({
      waitingHolds: () =>
        Promise.resolve([new Hold({ titleId: 't1', memberId: 'm1', placedAt: OUT })]),
    });
    await expect(renew(store).execute(request)).resolves.toBeInstanceOf(Loan);
  });

  it('REFUS : le plafond de prolongations est atteint', async () => {
    const { store } = storeWith({
      openLoanOfCopy: () =>
        Promise.resolve(
          new Loan({
            copyId: 'c1',
            memberId: 'm1',
            startedAt: OUT,
            dueAt: DUE,
            renewals: DEFAULT_POLICY.renewalLimit,
          }),
        ),
    });
    await expect(renew(store).execute(request)).rejects.toThrow(RenewalLimitReached);
  });

  it('REFUS : le pret a bascule en perdu', async () => {
    const { store } = storeWith({
      openLoanOfCopy: () =>
        Promise.resolve(
          new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE, lostAt: LATE }),
        ),
    });
    await expect(renew(store).execute(request)).rejects.toThrow(LoanCannotBeRenewed);
  });

  it('REFUS : l adherent est bloque pour impayes', async () => {
    const { store } = storeWith({
      memberById: () => Promise.resolve(new Member('m1', new Date('2027-01-01T00:00:00Z'), 60)),
    });
    await expect(renew(store).execute(request)).rejects.toThrow(BlockedByDebtForRenewal);
  });

  it('le compteur avance et ne peut pas etre remis a zero par une prolongation', async () => {
    const { store, saved } = storeWith({
      openLoanOfCopy: () =>
        Promise.resolve(
          new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE, renewals: 2 }),
        ),
    });
    await renew(store).execute(request);
    expect(saved[0].renewals).toBe(3);
  });
});
