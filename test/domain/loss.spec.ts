import { aLoan, DUE } from './builders.js';

const LOST_AFTER = 45;
const inTime = new Date('2026-01-20T10:00:00Z');
const late = new Date('2026-02-20T10:00:00Z');
const veryLate = new Date('2026-04-01T10:00:00Z');

describe('Un pret bascule en perdu', () => {
  it('n est pas perdu tant que le delai n est pas depasse', () => {
    expect(aLoan().isLostAt(late, LOST_AFTER)).toBe(false);
  });

  it('est perdu au-dela du delai configure', () => {
    expect(aLoan().isLostAt(veryLate, LOST_AFTER)).toBe(true);
  });

  it('une fois declare perdu, il porte sa date', () => {
    const lost = aLoan().declareLostAt(veryLate);
    expect(lost.lostAt).toEqual(veryLate);
    expect(lost.isLost()).toBe(true);
  });

  it('l etat anterieur reste lisible : echeance et sortie sont conservees', () => {
    const lost = aLoan().declareLostAt(veryLate);
    expect(lost.dueAt).toEqual(DUE);
    expect(lost.isOpen()).toBe(true);
  });

  it('un pret perdu ne peut pas etre prolonge', () => {
    expect(aLoan().declareLostAt(veryLate).canBeRenewed()).toBe(false);
  });

  it('un pret ordinaire peut etre prolonge', () => {
    expect(aLoan().canBeRenewed()).toBe(true);
  });

  it('un pret rendu ne peut pas etre prolonge non plus', () => {
    expect(aLoan({ returnedAt: inTime }).canBeRenewed()).toBe(false);
  });
});
