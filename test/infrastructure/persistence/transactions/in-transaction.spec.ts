import { readFileSync } from 'node:fs';
import { Loan } from '../../../../src/domain/loan.js';
import { sourcesUnder } from '../../../support/sources.js';
import { seededDatabase } from '../../../support/database.js';
import {
  DrizzleBorrowStore,
  DrizzleReturnStore,
} from '../../../../src/infrastructure/persistence/repositories/drizzle-stores.js';
import { inTransaction } from '../../../../src/infrastructure/persistence/transactions/in-transaction.js';

const OUT = new Date('2026-03-01T10:00:00Z');
const DUE = new Date('2026-03-24T10:00:00Z');
const BACK = new Date('2026-03-29T10:00:00Z');

const seeded = () =>
  seededDatabase({
    copies: [{ id: 'c1', titleId: 't1' }],
    members: [{ id: 'm1', expiresAt: '2027-01-01T00:00:00.000Z', debt: 0 }],
  });

const closed = (): Loan =>
  new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE, returnedAt: BACK });

describe('Un pret et sa dette, ecrits ensemble ou pas du tout', () => {
  it('le cas nominal ecrit les deux, relus depuis la base', async () => {
    const db = seeded();
    await new DrizzleBorrowStore(db).save(
      new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE }),
    );
    const store = new DrizzleReturnStore(db);

    await inTransaction(db, async () => {
      await store.closeLoan(closed());
      await store.addDebt('m1', 5);
    });

    expect(await store.openLoanOfCopy('c1')).toBeNull();
    expect((await new DrizzleBorrowStore(db).memberById('m1'))?.outstandingDebt).toBe(5);
  });

  it('si la dette echoue, le pret n est PAS ferme', async () => {
    const db = seeded();
    await new DrizzleBorrowStore(db).save(
      new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE }),
    );
    const store = new DrizzleReturnStore(db);

    await expect(
      inTransaction(db, async () => {
        await store.closeLoan(closed());
        throw new Error('ecriture de la dette impossible');
      }),
    ).rejects.toThrow('ecriture de la dette impossible');

    const open = await store.openLoanOfCopy('c1');
    expect(open).not.toBeNull();
    expect(open?.isOpen()).toBe(true);
    expect((await new DrizzleBorrowStore(db).memberById('m1'))?.outstandingDebt).toBe(0);
  });

  it('l erreur d origine remonte, elle n est pas remplacee par celle du rollback', async () => {
    const db = seeded();
    const cause = new Error('cause reelle');
    const caught = await inTransaction(db, () => Promise.reject(cause)).catch((e: Error) => e);
    expect(caught).toBe(cause);
  });

  it('la transaction vit dans l adaptateur, jamais dans le domaine ni l application', () => {
    const offenders: string[] = [];
    for (const root of ['src/domain', 'src/application']) {
      for (const path of sourcesUnder(root)) {
        const text = readFileSync(path, 'utf8')
          .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
          .replace(new RegExp('//[^\\n]*', 'g'), ' ');
        if (/\btransaction\b/i.test(text)) offenders.push(`${path}: transaction`);
        if (/\bdb\b/.test(text)) offenders.push(`${path}: db`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
