import { readFileSync } from 'node:fs';
import { Loan } from '../../../src/domain/loan.js';
import { DEFAULT_POLICY } from '../../../src/infrastructure/config/circulation-policy.js';
import type { LossStore } from '../../../src/application/ports/loss-store.port.js';
import {
  DeclareLossUseCase,
  type LossOutcome,
} from '../../../src/application/loss/declare-loss.usecase.js';

const OUT = new Date('2026-01-01T10:00:00Z');
const DUE = new Date('2026-01-24T10:00:00Z');
const WAY_LATE = new Date('2026-04-01T10:00:00Z');

function storeWith(overrides: Partial<LossStore> = {}): {
  store: LossStore;
  lost: Loan[];
  debts: { memberId: string; amount: number; kind: string }[];
} {
  const lost: Loan[] = [];
  const debts: { memberId: string; amount: number; kind: string }[] = [];
  const store = {
    openLoans: () =>
      Promise.resolve([
        new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE }),
      ]),
    markLost: (loan: Loan) => {
      lost.push(loan);
      return Promise.resolve();
    },
    addReplacementDebt: (memberId: string, amount: number) => {
      debts.push({ memberId, amount, kind: 'replacement' });
      return Promise.resolve();
    },
    replacementCostOf: () => Promise.resolve(30),
    ...overrides,
  } as LossStore;
  return { store, lost, debts };
}

describe('Basculer un pret trop en retard vers perdu', () => {
  it('bascule et produit une dette de REMPLACEMENT, distincte de l amende', async () => {
    const { store, lost, debts } = storeWith();
    const outcome: LossOutcome = await new DeclareLossUseCase(
      store,
      DEFAULT_POLICY,
    ).execute(WAY_LATE);

    expect(lost).toHaveLength(1);
    expect(lost[0].isLost()).toBe(true);
    expect(debts).toEqual([
      { memberId: 'm1', amount: 30, kind: 'replacement' },
    ]);
    expect(outcome.declared).toHaveLength(1);
  });

  it('la dette de remplacement n est PAS l amende de retard', async () => {
    const { store, debts } = storeWith();
    await new DeclareLossUseCase(store, DEFAULT_POLICY).execute(WAY_LATE);
    const lateFee = 68 * DEFAULT_POLICY.lateFeePerDay;
    expect(debts[0].amount).toBe(30);
    expect(debts[0].amount).not.toBeCloseTo(lateFee);
    expect(debts[0].kind).toBe('replacement');
  });

  it('ne touche pas un pret dont le retard reste sous le delai', async () => {
    const { store, lost } = storeWith();
    const outcome = await new DeclareLossUseCase(store, DEFAULT_POLICY).execute(
      new Date('2026-02-20T10:00:00Z'),
    );
    expect(lost).toEqual([]);
    expect(outcome.declared).toEqual([]);
  });

  it('la bascule est datee, et l etat anterieur reste lisible', async () => {
    const { store, lost } = storeWith();
    await new DeclareLossUseCase(store, DEFAULT_POLICY).execute(WAY_LATE);
    expect(lost[0].lostAt).toEqual(WAY_LATE);
    expect(lost[0].dueAt).toEqual(DUE);
    expect(lost[0].startedAt).toEqual(OUT);
  });

  it('n embarque aucun ordonnanceur : c est une operation appelable', () => {
    const source = readFileSync(
      'src/application/loss/declare-loss.usecase.ts',
      'utf8',
    );
    expect(source).not.toMatch(/setInterval|setTimeout|cron|schedule/i);
  });
});
