import { aLoan, DUE, START } from './builders.js';

describe('Loan', () => {
  it('est ouvert tant qu il n a pas ete rendu', () => {
    expect(aLoan().isOpen()).toBe(true);
  });

  it('est ferme une fois rendu', () => {
    expect(
      aLoan({ returnedAt: new Date('2026-01-10T10:00:00Z') }).isOpen(),
    ).toBe(false);
  });

  it('calcule le retard a une date fournie, sans jamais le stocker', () => {
    const loan = aLoan();
    expect(loan.daysOverdueAt(new Date('2026-01-20T10:00:00Z'))).toBe(0);
    expect(loan.daysOverdueAt(new Date('2026-01-27T10:00:00Z'))).toBe(3);
  });

  it('voit son retard changer avec le temps sans aucune ecriture', () => {
    const loan = aLoan();
    const before = JSON.stringify(loan);
    loan.daysOverdueAt(new Date('2026-03-01T10:00:00Z'));
    expect(JSON.stringify(loan)).toBe(before);
  });

  it('ne porte aucun champ de retard', () => {
    expect(Object.keys(aLoan())).not.toContain('overdue');
    expect(Object.keys(aLoan())).not.toContain('daysOverdue');
  });

  it('porte les dates qu on lui donne', () => {
    const loan = aLoan();
    expect(loan.startedAt).toBe(START);
    expect(loan.dueAt).toBe(DUE);
  });
});
