import { Hold } from '../../../src/domain/hold.js';
import { Copy } from '../../../src/domain/copy.js';
import type { BorrowStore } from '../../../src/application/ports/borrow-store.port.js';
import {
  BorrowUseCase,
  CopySetAsideForAnother,
} from '../../../src/application/borrow/borrow.usecase.js';
import { Member } from '../../../src/domain/member.js';
import { DEFAULT_POLICY } from '../../../src/infrastructure/config/circulation-policy.js';
import type { HoldStore } from '../../../src/application/ports/hold-store.port.js';
import {
  PlaceHoldUseCase,
  AlreadyHoldsACopy,
  HoldCeilingReached,
  BlockedByDebtForHold,
  NothingToReserve,
  UnknownMember,
  type PlaceHoldRequest,
} from '../../../src/application/hold/place-hold.usecase.js';

const NOW = new Date('2026-03-10T10:00:00Z');
const request: PlaceHoldRequest = { titleId: 't1', memberId: 'm1', now: NOW };

function storeWith(overrides: Partial<HoldStore> = {}): {
  store: HoldStore;
  saved: Hold[];
} {
  const saved: Hold[] = [];
  const store = {
    memberById: () =>
      Promise.resolve(new Member('m1', new Date('2027-01-01T00:00:00Z'), 0)),
    holdsOfTitle: () => Promise.resolve([]),
    holdsOfMember: () => Promise.resolve([]),
    memberHoldsCopyOf: () => Promise.resolve(false),
    availableCopiesOf: () => Promise.resolve(0),
    save: (hold: Hold) => {
      saved.push(hold);
      return Promise.resolve();
    },
    ...overrides,
  } as HoldStore;
  return { store, saved };
}

describe('Reserver un titre', () => {
  const place = (store: HoldStore): PlaceHoldUseCase =>
    new PlaceHoldUseCase(store, DEFAULT_POLICY);

  it('met l adherent dans la file du TITRE, pas d un exemplaire', async () => {
    const { store, saved } = storeWith();
    const hold = await place(store).execute(request);
    expect(hold.titleId).toBe('t1');
    expect(hold.isWaiting()).toBe(true);
    expect(saved).toHaveLength(1);
  });

  it('REFUS 1 : l adherent detient deja un exemplaire du titre', async () => {
    const { store } = storeWith({
      memberHoldsCopyOf: () => Promise.resolve(true),
    });
    await expect(place(store).execute(request)).rejects.toThrow(
      AlreadyHoldsACopy,
    );
  });

  it('REFUS 2 : le plafond de reservations est atteint', async () => {
    const many = Array.from(
      { length: DEFAULT_POLICY.holdCeiling },
      (_, i) => new Hold({ titleId: `t${i}`, memberId: 'm1', placedAt: NOW }),
    );
    const { store } = storeWith({ holdsOfMember: () => Promise.resolve(many) });
    await expect(place(store).execute(request)).rejects.toThrow(
      HoldCeilingReached,
    );
  });

  it('REFUS 3 : les impayes depassent le seuil', async () => {
    const { store } = storeWith({
      memberById: () =>
        Promise.resolve(new Member('m1', new Date('2027-01-01T00:00:00Z'), 60)),
    });
    await expect(place(store).execute(request)).rejects.toThrow(
      BlockedByDebtForHold,
    );
  });

  it('REFUS 4 : le titre est disponible, il n y a rien a reserver', async () => {
    const { store } = storeWith({
      availableCopiesOf: () => Promise.resolve(2),
    });
    await expect(place(store).execute(request)).rejects.toThrow(
      NothingToReserve,
    );
  });
});

describe('Un exemplaire mis de cote n est plus empruntable par un autre', () => {
  const OUT = new Date('2026-03-01T10:00:00Z');
  const DUE = new Date('2026-03-24T10:00:00Z');

  it('REFUS : l adherent n existe pas', async () => {
    const { store } = storeWith({ memberById: () => Promise.resolve(null) });
    await expect(
      new PlaceHoldUseCase(store, DEFAULT_POLICY).execute(request),
    ).rejects.toThrow(UnknownMember);
  });

  it('un tiers qui tente l emprunt est refuse, et le beneficiaire est accepte', async () => {
    const borrowStore = (asker: string): BorrowStore =>
      ({
        copyById: () => Promise.resolve(new Copy('c1', 't1')),
        memberById: () =>
          Promise.resolve(
            new Member(asker, new Date('2027-01-01T00:00:00Z'), 0),
          ),
        openLoansOfCopy: () => Promise.resolve([]),
        openLoansOfMember: () => Promise.resolve([]),
        setAsideFor: () => Promise.resolve('m2'),
        save: () => Promise.resolve(),
      }) as BorrowStore;

    const third = new BorrowUseCase(borrowStore('m3'), DEFAULT_POLICY);
    await expect(
      third.execute({ copyId: 'c1', memberId: 'm3', now: OUT }),
    ).rejects.toThrow(CopySetAsideForAnother);

    const owner = new BorrowUseCase(borrowStore('m2'), DEFAULT_POLICY);
    const loan = await owner.execute({
      copyId: 'c1',
      memberId: 'm2',
      now: OUT,
    });
    expect(loan.dueAt).toEqual(DUE);
  });
});
