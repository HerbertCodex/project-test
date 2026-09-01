import { Copy } from '../../src/domain/copy.js';
import {
  availabilityOf,
  assertLendable,
  CopyAlreadyOnLoan,
  type Availability,
} from '../../src/domain/availability.js';
import { aLoan } from './builders.js';

describe('Disponibilite derivee des prets', () => {
  const copy = new Copy('c1', 't1');
  const returned = () =>
    aLoan({ returnedAt: new Date('2026-01-10T10:00:00Z') });

  it('un exemplaire sans pret ouvert est disponible', () => {
    const state: Availability = availabilityOf(copy.id, []);
    expect(state).toBe('available');
  });

  it('un exemplaire portant un pret ouvert est sorti', () => {
    expect(availabilityOf(copy.id, [aLoan()])).toBe('on_loan');
  });

  it('un exemplaire dont le pret est ferme redevient disponible', () => {
    expect(availabilityOf(copy.id, [returned()])).toBe('available');
  });

  it('ne porte aucun drapeau booleen de disponibilite', () => {
    expect(Object.keys(copy)).not.toContain('available');
    expect(Object.keys(copy)).not.toContain('isAvailable');
  });

  it('refuse un second pret ouvert sur le meme exemplaire', () => {
    expect(() => assertLendable('c1', [aLoan()])).toThrow(CopyAlreadyOnLoan);
  });

  it('autorise le pret quand le precedent est rendu', () => {
    expect(() => assertLendable('c1', [returned()])).not.toThrow();
  });
});
