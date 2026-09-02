import { readFileSync } from 'node:fs';
import { CopyAlreadyOnLoan } from '../../../../src/domain/availability.js';
import {
  BlockedByDebt,
  BorrowCeilingReached,
  CopySetAsideForAnother,
  MembershipExpired,
  UnknownParty,
} from '../../../../src/application/borrow/borrow.usecase.js';
import { CopyNotOnLoan } from '../../../../src/application/return/return.usecase.js';
import {
  AlreadyHoldsACopy,
  BlockedByDebtForHold,
  HoldCeilingReached,
  NothingToReserve,
  UnknownMember,
} from '../../../../src/application/hold/place-hold.usecase.js';
import {
  BlockedByDebtForRenewal,
  LoanCannotBeRenewed,
  NothingToRenew,
  RenewalLimitReached,
  TitleIsHeldByAnother,
} from '../../../../src/application/renew/renew.usecase.js';
import {
  statusFor,
  REFUSAL_STATUS,
  type RefusalName,
} from '../../../../src/adapters/http/errors/refusal-map.js';
import { REFUSAL_MAP_IS_EXHAUSTIVE } from '../../../../src/adapters/http/errors/exhaustive.js';

describe('La table de correspondance refus vers code HTTP', () => {
  it('un conflit d etat ressort en 409', () => {
    expect(statusFor(new CopyAlreadyOnLoan('c1'))).toBe(409);
    expect(statusFor(new CopySetAsideForAnother('c1', 'm2'))).toBe(409);
    expect(statusFor(new CopyNotOnLoan('c1'))).toBe(409);
    expect(statusFor(new NothingToReserve('t1', 2))).toBe(409);
  });

  it('un droit suspendu ressort en 403', () => {
    expect(statusFor(new BlockedByDebt('m1', 50))).toBe(403);
    expect(statusFor(new MembershipExpired('m1'))).toBe(403);
    expect(statusFor(new BorrowCeilingReached('m1', 43))).toBe(403);
    expect(statusFor(new HoldCeilingReached('m1', 43))).toBe(403);
    expect(statusFor(new BlockedByDebtForHold('m1', 50))).toBe(403);
    expect(statusFor(new BlockedByDebtForRenewal('m1', 50))).toBe(403);
    expect(statusFor(new TitleIsHeldByAnother('t1', 2))).toBe(403);
    expect(statusFor(new AlreadyHoldsACopy('m1', 't1'))).toBe(403);
  });

  it('une demande coherente mais impossible ressort en 422', () => {
    expect(statusFor(new LoanCannotBeRenewed('c1'))).toBe(422);
    expect(statusFor(new RenewalLimitReached(5))).toBe(422);
  });

  it('un inconnu ressort en 404', () => {
    expect(statusFor(new UnknownParty('exemplaire c1'))).toBe(404);
    expect(statusFor(new UnknownMember('m1'))).toBe(404);
    expect(statusFor(new NothingToRenew('rien'))).toBe(404);
  });

  it('chaque cle de la table est un RefusalName', () => {
    for (const key of Object.keys(REFUSAL_STATUS)) {
      const name: RefusalName = key as RefusalName;
      expect(REFUSAL_STATUS[name]).toBeGreaterThan(0);
    }
  });

  it('AUCUN refus metier ne produit un 5xx', () => {
    const codes = Object.values(REFUSAL_STATUS);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(code).toBeLessThan(500);
  });

  it('l exhaustivite est tenue par le COMPILATEUR, pas seulement par ce test', () => {
    expect(REFUSAL_MAP_IS_EXHAUSTIVE).toBe(REFUSAL_STATUS);
  });

  it('la table couvre TOUS les refus que le domaine et l application declarent', () => {
    const declared = new Set<string>();
    const sources = [
      'src/domain/availability.ts',
      'src/application/borrow/borrow.usecase.ts',
      'src/application/return/return.usecase.ts',
      'src/application/hold/place-hold.usecase.ts',
      'src/application/renew/renew.usecase.ts',
    ];
    for (const path of sources) {
      for (const found of readFileSync(path, 'utf8').matchAll(
        /export class (\w+) extends Error/g,
      )) {
        declared.add(found[1]);
      }
    }
    const mapped = new Set(Object.keys(REFUSAL_STATUS));
    expect([...declared].filter((name) => !mapped.has(name))).toEqual([]);
  });
});
