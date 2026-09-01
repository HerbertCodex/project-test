import { Loan } from '../../src/domain/loan.js';

describe('Loan', () => {
  const start = new Date('2026-01-01T10:00:00Z');
  const due = new Date('2026-01-24T10:00:00Z');

  it('est ouvert tant qu il n a pas ete rendu', () => {
    expect(
      new Loan({
        copyId: 'c1',
        memberId: 'm1',
        startedAt: start,
        dueAt: due,
      }).isOpen(),
    ).toBe(true);
  });

  it('est ferme une fois rendu', () => {
    const returned = new Loan({
      copyId: 'c1',
      memberId: 'm1',
      startedAt: start,
      dueAt: due,
      returnedAt: new Date('2026-01-10T10:00:00Z'),
    });
    expect(returned.isOpen()).toBe(false);
  });

  it('calcule le retard a une date fournie, sans jamais le stocker', () => {
    const loan = new Loan({
      copyId: 'c1',
      memberId: 'm1',
      startedAt: start,
      dueAt: due,
    });
    expect(loan.daysOverdueAt(new Date('2026-01-20T10:00:00Z'))).toBe(0);
    expect(loan.daysOverdueAt(new Date('2026-01-27T10:00:00Z'))).toBe(3);
  });

  it('voit son retard changer avec le temps sans aucune ecriture', () => {
    const loan = new Loan({
      copyId: 'c1',
      memberId: 'm1',
      startedAt: start,
      dueAt: due,
    });
    const before = JSON.stringify(loan);
    loan.daysOverdueAt(new Date('2026-03-01T10:00:00Z'));
    expect(JSON.stringify(loan)).toBe(before);
  });

  it('ne porte aucun champ de retard', () => {
    const loan = new Loan({
      copyId: 'c1',
      memberId: 'm1',
      startedAt: start,
      dueAt: due,
    });
    expect(Object.keys(loan)).not.toContain('overdue');
    expect(Object.keys(loan)).not.toContain('daysOverdue');
  });
});
