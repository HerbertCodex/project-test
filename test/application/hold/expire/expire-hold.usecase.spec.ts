import { readFileSync } from 'node:fs';
import { Hold } from '../../../../src/domain/hold.js';
import { DEFAULT_POLICY } from '../../../../src/infrastructure/config/circulation-policy.js';
import type { ExpireHoldStore } from '../../../../src/application/ports/expire-hold-store.port.js';
import type { HoldServing } from '../../../../src/application/hold/serve-next.js';
import type { NotificationSender } from '../../../../src/application/ports/notification-sender.port.js';
import {
  ExpireHoldsUseCase,
  type ExpiryOutcome,
} from '../../../../src/application/hold/expire/expire-holds.usecase.js';

const PLACED = new Date('2026-03-01T10:00:00Z');
const PICKUP_BY = new Date('2026-03-20T10:00:00Z');
const AFTER = new Date('2026-03-25T10:00:00Z');

const ready = (memberId: string): Hold =>
  new Hold({
    titleId: 't1',
    memberId,
    placedAt: PLACED,
    setAsideCopyId: 'c1',
    pickupBy: PICKUP_BY,
  });

const waiting = (memberId: string): Hold =>
  new Hold({
    titleId: 't1',
    memberId,
    placedAt: new Date('2026-03-02T10:00:00Z'),
  });

function storeWith(overrides: Partial<ExpireHoldStore> = {}): {
  store: ExpireHoldStore;
  expired: Hold[];
  served: { hold: Hold; copyId: string }[];
  freed: string[];
} {
  const expired: Hold[] = [];
  const served: { hold: Hold; copyId: string }[] = [];
  const freed: string[] = [];
  const store = {
    readyHolds: () => Promise.resolve([ready('m1')]),
    waitingHolds: () => Promise.resolve([]),
    markExpired: (hold: Hold) => {
      expired.push(hold);
      return Promise.resolve();
    },
    setAsideForHold: (hold: Hold, copyId: string) => {
      served.push({ hold, copyId });
      return Promise.resolve();
    },
    releaseCopy: (copyId: string) => {
      freed.push(copyId);
      return Promise.resolve();
    },
    ...overrides,
  } as ExpireHoldStore;
  return { store, expired, served, freed };
}

const silent = (): NotificationSender => ({
  holdAvailable: () => Promise.resolve(),
});

describe('Expirer une reservation non retiree', () => {
  const expiring = (
    store: ExpireHoldStore,
    notifier = silent(),
  ): ExpireHoldsUseCase =>
    new ExpireHoldsUseCase(store, DEFAULT_POLICY, notifier);

  it('n expire rien avant la date limite de retrait', async () => {
    const { store, expired } = storeWith();
    const outcome: ExpiryOutcome = await expiring(store).execute(
      new Date('2026-03-15T10:00:00Z'),
    );
    expect(expired).toEqual([]);
    expect(outcome.expired).toEqual([]);
  });

  it('un ExpireHoldStore satisfait la capacite de mise de cote', () => {
    const { store } = storeWith();
    const serving: HoldServing = store;
    expect(typeof serving.setAsideForHold).toBe('function');
  });

  it('expire au-dela du delai et passe au suivant de la file', async () => {
    const { store, expired, served } = storeWith({
      waitingHolds: () => Promise.resolve([waiting('m2')]),
    });
    await expiring(store).execute(AFTER);

    expect(expired).toHaveLength(1);
    expect(expired[0].memberId).toBe('m1');
    expect(served).toHaveLength(1);
    expect(served[0].hold.memberId).toBe('m2');
    expect(served[0].copyId).toBe('c1');
  });

  it('libere l exemplaire quand personne n attend derriere', async () => {
    const { store, expired, served, freed } = storeWith();
    await expiring(store).execute(AFTER);

    expect(expired).toHaveLength(1);
    expect(served).toEqual([]);
    expect(freed).toEqual(['c1']);
  });

  it('previent le suivant par le port de notification', async () => {
    const sent: string[] = [];
    const notifier: NotificationSender = {
      holdAvailable: (notice) => {
        sent.push(notice.memberId);
        return Promise.resolve();
      },
    };
    const { store } = storeWith({
      waitingHolds: () => Promise.resolve([waiting('m2')]),
    });
    await expiring(store, notifier).execute(AFTER);
    expect(sent).toEqual(['m2']);
  });

  it('n embarque aucun ordonnanceur : c est une operation appelable', () => {
    const source = readFileSync(
      'src/application/hold/expire/expire-holds.usecase.ts',
      'utf8',
    );
    expect(source).not.toMatch(/setInterval|setTimeout|cron|schedule/i);
  });
});
