import { readFileSync } from 'node:fs';
import { sourcesUnder } from '../../support/sources.js';
import { Copy } from '../../../src/domain/copy.js';
import { Loan } from '../../../src/domain/loan.js';
import { Member } from '../../../src/domain/member.js';
import { CopyAlreadyOnLoan } from '../../../src/domain/availability.js';
import { DEFAULT_POLICY } from '../../../src/infrastructure/config/circulation-policy.js';
import type { CirculationStore } from '../../../src/application/ports/circulation-store.port.js';
import {
  BorrowUseCase,
  UnknownParty,
  type BorrowRequest,
  MembershipExpired,
  BorrowCeilingReached,
  BlockedByDebt,
  CopySetAsideForAnother,
} from '../../../src/application/borrow/borrow.usecase.js';

const NOW = new Date('2026-03-01T10:00:00Z');
const request: BorrowRequest = { copyId: 'c1', memberId: 'm1', now: NOW };

/**
 * Un magasin en mémoire, réglable par scénario.
 */
function storeWith(
  overrides: Partial<CirculationStore> = {},
): CirculationStore {
  return {
    copyById: () => Promise.resolve(new Copy('c1', 't1')),
    memberById: () =>
      Promise.resolve(new Member('m1', new Date('2027-01-01T00:00:00Z'), 0)),
    openLoansOfCopy: () => Promise.resolve([]),
    openLoansOfMember: () => Promise.resolve([]),
    setAsideFor: () => Promise.resolve(null),
    save: () => Promise.resolve(),
    ...overrides,
  };
}

describe('Emprunter un exemplaire', () => {
  const borrow = (store: CirculationStore): BorrowUseCase =>
    new BorrowUseCase(store, DEFAULT_POLICY);

  it('cree un pret dont l echeance est la date du jour plus la duree configuree', async () => {
    const saved: Loan[] = [];
    const loan = await borrow(
      storeWith({
        save: (created) => {
          saved.push(created);
          return Promise.resolve();
        },
      }),
    ).execute(request);

    expect(loan.dueAt).toEqual(new Date('2026-03-24T10:00:00Z'));
    expect(saved).toHaveLength(1);
  });

  it('REFUS 1 : l exemplaire est deja sorti', async () => {
    const store = storeWith({
      openLoansOfCopy: () =>
        Promise.resolve([
          new Loan({
            copyId: 'c1',
            memberId: 'autre',
            startedAt: NOW,
            dueAt: NOW,
          }),
        ]),
    });
    await expect(borrow(store).execute(request)).rejects.toThrow(
      CopyAlreadyOnLoan,
    );
  });

  it('REFUS 2 : l adhesion est expiree', async () => {
    const store = storeWith({
      memberById: () =>
        Promise.resolve(new Member('m1', new Date('2026-01-01T00:00:00Z'), 0)),
    });
    await expect(borrow(store).execute(request)).rejects.toThrow(
      MembershipExpired,
    );
  });

  it('REFUS 3 : le plafond d emprunts est atteint', async () => {
    const held = Array.from(
      { length: DEFAULT_POLICY.borrowCeiling },
      (_, index) =>
        new Loan({
          copyId: `c${index}`,
          memberId: 'm1',
          startedAt: NOW,
          dueAt: NOW,
        }),
    );
    const store = storeWith({ openLoansOfMember: () => Promise.resolve(held) });
    await expect(borrow(store).execute(request)).rejects.toThrow(
      BorrowCeilingReached,
    );
  });

  it('REFUS 4 : les impayes depassent le seuil', async () => {
    const store = storeWith({
      memberById: () =>
        Promise.resolve(new Member('m1', new Date('2027-01-01T00:00:00Z'), 60)),
    });
    await expect(borrow(store).execute(request)).rejects.toThrow(BlockedByDebt);
  });

  it('REFUS 5 : l exemplaire est mis de cote pour un autre adherent', async () => {
    const store = storeWith({ setAsideFor: () => Promise.resolve('autre') });
    await expect(borrow(store).execute(request)).rejects.toThrow(
      CopySetAsideForAnother,
    );
  });

  it('mais accepte quand l exemplaire est mis de cote pour CET adherent', async () => {
    const store = storeWith({ setAsideFor: () => Promise.resolve('m1') });
    await expect(borrow(store).execute(request)).resolves.toBeInstanceOf(Loan);
  });

  it('REFUS 6 : l exemplaire n existe pas', async () => {
    const store = storeWith({ copyById: () => Promise.resolve(null) });
    await expect(borrow(store).execute(request)).rejects.toThrow(UnknownParty);
  });

  it('REFUS 7 : l adherent n existe pas', async () => {
    const store = storeWith({ memberById: () => Promise.resolve(null) });
    await expect(borrow(store).execute(request)).rejects.toThrow(UnknownParty);
  });

  it('chaque refus porte un message dans le vocabulaire du metier', async () => {
    const store = storeWith({ setAsideFor: () => Promise.resolve('autre') });
    const failure = await borrow(store)
      .execute(request)
      .catch((error: Error) => error.message);
    expect(failure).toContain('c1');
    expect(failure).toContain('autre');
  });

  it('n importe jamais NestJS dans le domaine ni dans le cas d usage', () => {
    const roots = [
      'src/domain',
      'src/application/borrow',
      'src/application/ports',
    ];
    const offenders = roots
      .flatMap((root) => sourcesUnder(root))
      .filter((path) => /@nestjs\//.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
