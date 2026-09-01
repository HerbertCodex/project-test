import { Copy } from '../../src/domain/copy.js';
import { Loan } from '../../src/domain/loan.js';
import { availabilityOf, assertLendable, CopyAlreadyOnLoan } from '../../src/domain/availability.js';

describe('Disponibilite derivee des prets', () => {
  const copy = new Copy('c1', 't1');
  const start = new Date('2026-01-01T10:00:00Z');
  const due = new Date('2026-01-24T10:00:00Z');

  it('un exemplaire sans pret ouvert est disponible', () => {
    expect(availabilityOf(copy.id, [])).toBe('available');
  });

  it('un exemplaire portant un pret ouvert est sorti', () => {
    expect(availabilityOf(copy.id, [new Loan('c1', 'm1', start, due)])).toBe('on_loan');
  });

  it('un exemplaire dont le pret est ferme redevient disponible', () => {
    const closed = new Loan('c1', 'm1', start, due, new Date('2026-01-10T10:00:00Z'));
    expect(availabilityOf(copy.id, [closed])).toBe('available');
  });

  it('ne porte aucun drapeau booleen de disponibilite', () => {
    expect(Object.keys(copy)).not.toContain('available');
    expect(Object.keys(copy)).not.toContain('isAvailable');
  });

  it('refuse un second pret ouvert sur le meme exemplaire', () => {
    const open = [new Loan('c1', 'm1', start, due)];
    expect(() => assertLendable('c1', open)).toThrow(CopyAlreadyOnLoan);
  });

  it('autorise le pret quand le precedent est rendu', () => {
    const closed = [new Loan('c1', 'm1', start, due, new Date('2026-01-10T10:00:00Z'))];
    expect(() => assertLendable('c1', closed)).not.toThrow();
  });
});
