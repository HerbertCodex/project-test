import { CopyAlreadyOnLoan } from '../../../../src/domain/availability.js';
import { Loan } from '../../../../src/domain/loan.js';
import { seededDatabase } from '../../../support/database.js';
import { DrizzleBorrowStore } from '../../../../src/infrastructure/persistence/repositories/drizzle-stores.js';

const OUT = new Date('2026-03-01T10:00:00Z');
const DUE = new Date('2026-03-24T10:00:00Z');

const loanFor = (memberId: string): Loan =>
  new Loan({ copyId: 'c1', memberId, startedAt: OUT, dueAt: DUE });

describe('Le refus fondateur, tenu par la base', () => {
  it('un second pret sur un exemplaire deja sorti leve CopyAlreadyOnLoan', async () => {
    const store = new DrizzleBorrowStore(
      seededDatabase({ copies: [{ id: 'c1', titleId: 't1' }] }),
    );
    await store.save(loanFor('m1'));
    await expect(store.save(loanFor('m2'))).rejects.toThrow(CopyAlreadyOnLoan);
  });

  it('et surtout : il n ECRASE PAS le pret existant', async () => {
    const db = seededDatabase({ copies: [{ id: 'c1', titleId: 't1' }] });
    const store = new DrizzleBorrowStore(db);
    await store.save(loanFor('m1'));
    await store.save(loanFor('m2')).catch(() => undefined);

    const open = await store.openLoansOfCopy('c1');
    expect(open).toHaveLength(1);
    expect(open[0].memberId).toBe('m1');
  });

  it('le refus n est PAS une erreur de pilote : c est un refus du domaine', async () => {
    const store = new DrizzleBorrowStore(
      seededDatabase({ copies: [{ id: 'c1', titleId: 't1' }] }),
    );
    await store.save(loanFor('m1'));
    const error = await store
      .save(loanFor('m2'))
      .catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(CopyAlreadyOnLoan);
    expect((error as Error).message).toContain('c1');
  });

  it('deux emprunts ENTRELACES : les deux lisent, puis les deux ecrivent', async () => {
    const store = new DrizzleBorrowStore(
      seededDatabase({ copies: [{ id: 'c1', titleId: 't1' }] }),
    );

    const seenByFirst = await store.openLoansOfCopy('c1');
    const seenBySecond = await store.openLoansOfCopy('c1');
    expect(seenByFirst).toEqual([]);
    expect(seenBySecond).toEqual([]);

    const outcomes = await Promise.allSettled([
      store.save(loanFor('m1')),
      store.save(loanFor('m2')),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

    const rejected = outcomes.find((o) => o.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      CopyAlreadyOnLoan,
    );
    expect(await store.openLoansOfCopy('c1')).toHaveLength(1);
  });

  it('un pret rendu laisse la place au suivant', async () => {
    const store = new DrizzleBorrowStore(
      seededDatabase({ copies: [{ id: 'c1', titleId: 't1' }] }),
    );
    await store.save(loanFor('m1'));
    const open = (await store.openLoansOfCopy('c1'))[0];
    await store.save(
      new Loan({
        copyId: 'c1',
        memberId: open.memberId,
        startedAt: open.startedAt,
        dueAt: open.dueAt,
        returnedAt: new Date('2026-03-10T10:00:00Z'),
      }),
    );
    await expect(store.save(loanFor('m2'))).resolves.toBeUndefined();
  });
});
