import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { Hold } from '../../../../src/domain/hold.js';
import { Loan } from '../../../../src/domain/loan.js';
import {
  openDatabase,
  type Db,
  DrizzleBorrowStore,
  DrizzleReturnStore,
  DrizzleHoldStore,
  DrizzleRenewStore,
  DrizzleLossStore,
  DrizzleExpireHoldStore,
} from '../../../../src/infrastructure/persistence/repositories/drizzle-stores.js';

const MIGRATIONS = 'src/infrastructure/persistence/migrations';
const OUT = new Date('2026-03-01T10:00:00Z');
const DUE = new Date('2026-03-24T10:00:00Z');

/**
 * Une base SQLite neuve, migrée, avec un exemplaire et un adhérent.
 */
function seeded(): Db {
  const file = join(mkdtempSync(join(tmpdir(), 'stores-')), 'test.db');
  const raw = new Database(file);
  for (const name of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, name), 'utf8'));
  }
  raw
    .prepare('INSERT INTO copies (id, title_id) VALUES (?, ?)')
    .run('c1', 't1');
  raw
    .prepare('INSERT INTO copies (id, title_id) VALUES (?, ?)')
    .run('c2', 't1');
  raw
    .prepare(
      'INSERT INTO members (id, membership_expires_at, outstanding_debt) VALUES (?, ?, ?)',
    )
    .run('m1', '2027-01-01T00:00:00.000Z', 0);
  raw.close();
  return openDatabase(file);
}

describe('Les sept ports sur Drizzle, contre une vraie base', () => {
  it('les ports de l application ne sont pas modifies par cette issue', () => {
    const diff = execFileSync(
      'git',
      ['diff', '--name-only', 'main', '--', 'src/application/ports'],
      {
        encoding: 'utf8',
      },
    );
    expect(diff.trim()).toBe('');
  });

  it('BorrowStore lit exemplaire, adherent, prets et mise de cote, et ecrit un pret', async () => {
    const db = seeded();
    const store = new DrizzleBorrowStore(db);
    expect((await store.copyById('c1'))?.titleId).toBe('t1');
    expect((await store.memberById('m1'))?.id).toBe('m1');
    expect(await store.openLoansOfCopy('c1')).toEqual([]);
    expect(await store.setAsideFor('c1')).toBeNull();

    await store.save(
      new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE }),
    );
    const open = await store.openLoansOfCopy('c1');
    expect(open).toHaveLength(1);
    expect(open[0].isOpen()).toBe(true);
    expect(await store.openLoansOfMember('m1')).toHaveLength(1);
  });

  it('BorrowStore rend null pour ce qui n existe pas', async () => {
    const db = seeded();
    const store = new DrizzleBorrowStore(db);
    expect(await store.copyById('inconnu')).toBeNull();
    expect(await store.memberById('inconnu')).toBeNull();
  });

  it('ReturnStore ferme un pret, constate la dette et solde le remplacement', async () => {
    const db = seeded();
    await new DrizzleBorrowStore(db).save(
      new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE }),
    );
    const store = new DrizzleReturnStore(db);
    const open = await store.openLoanOfCopy('c1');
    expect(open).not.toBeNull();
    expect(await store.titleOfCopy('c1')).toBe('t1');

    await store.closeLoan(
      new Loan({
        copyId: 'c1',
        memberId: 'm1',
        startedAt: OUT,
        dueAt: DUE,
        returnedAt: new Date(),
      }),
    );
    expect(await store.openLoanOfCopy('c1')).toBeNull();

    await store.addDebt('m1', 5);
    expect(
      (await new DrizzleBorrowStore(db).memberById('m1'))?.outstandingDebt,
    ).toBe(5);
    await store.clearReplacementDebt('m1');
  });

  it('HoldStore compte les reservations et dit ce qui est disponible', async () => {
    const db = seeded();
    const store = new DrizzleHoldStore(db);
    expect(await store.availableCopiesOf('t1')).toBe(2);
    expect(await store.memberHoldsCopyOf('m1', 't1')).toBe(false);

    await store.save(
      new Hold({ titleId: 't1', memberId: 'm1', placedAt: OUT }),
    );
    expect(await store.holdsOfTitle('t1')).toHaveLength(1);
    expect(await store.holdsOfMember('m1')).toHaveLength(1);
  });

  it('RenewStore lit le pret ouvert et enregistre la prolongation', async () => {
    const db = seeded();
    await new DrizzleBorrowStore(db).save(
      new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE }),
    );
    const store = new DrizzleRenewStore(db);
    const loan = await store.openLoanOfCopy('c1');
    expect(loan?.renewals).toBe(0);
    await store.save(loan!.renewFrom(new Date('2026-03-20T10:00:00Z'), 23));
    expect((await store.openLoanOfCopy('c1'))?.renewals).toBe(1);
    expect(await store.waitingHolds('t1')).toEqual([]);
  });

  it('LossStore bascule un pret et ajoute une dette de remplacement distincte', async () => {
    const db = seeded();
    await new DrizzleBorrowStore(db).save(
      new Loan({ copyId: 'c1', memberId: 'm1', startedAt: OUT, dueAt: DUE }),
    );
    const store = new DrizzleLossStore(db);
    const open = await store.openLoans();
    expect(open).toHaveLength(1);
    await store.markLost(
      open[0].declareLostAt(new Date('2026-05-20T10:00:00Z')),
    );
    expect((await store.openLoans())[0].isLost()).toBe(true);
    expect(await store.replacementCostOf('c1')).toBeGreaterThan(0);
    await store.addReplacementDebt('m1', 30);
    expect(
      (await new DrizzleBorrowStore(db).memberById('m1'))?.outstandingDebt,
    ).toBe(30);
  });

  it('ExpireHoldStore lit les reservations pretes, les expire et libere l exemplaire', async () => {
    const db = seeded();
    const holds = new DrizzleHoldStore(db);
    await holds.save(
      new Hold({ titleId: 't1', memberId: 'm1', placedAt: OUT }),
    );
    const store = new DrizzleExpireHoldStore(db);
    expect(await store.readyHolds()).toEqual([]);

    const waiting = (await holds.holdsOfTitle('t1'))[0];
    await store.setAsideForHold(
      waiting,
      'c1',
      new Date('2026-03-09T10:00:00Z'),
    );
    const ready = await store.readyHolds();
    expect(ready).toHaveLength(1);
    expect(ready[0].setAsideCopyId).toBe('c1');

    await store.markExpired(ready[0]);
    expect(await store.readyHolds()).toEqual([]);
    await store.releaseCopy('c1');
  });
});
