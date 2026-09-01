import { Member } from '../../src/domain/member.js';

describe('Member', () => {
  const at = new Date('2026-01-15T10:00:00Z');

  it('a une adhesion valide avant son echeance', () => {
    expect(
      new Member('m1', new Date('2026-06-01T00:00:00Z'), 0).isMembershipValidAt(
        at,
      ),
    ).toBe(true);
  });

  it('a une adhesion expiree apres son echeance', () => {
    expect(
      new Member('m1', new Date('2026-01-01T00:00:00Z'), 0).isMembershipValidAt(
        at,
      ),
    ).toBe(false);
  });

  it('est bloque au-dela du seuil d impayes', () => {
    expect(
      new Member('m1', new Date('2026-06-01T00:00:00Z'), 60).isBlockedByDebt(
        50,
      ),
    ).toBe(true);
  });

  it('n est pas bloque a hauteur exacte du seuil', () => {
    expect(
      new Member('m1', new Date('2026-06-01T00:00:00Z'), 50).isBlockedByDebt(
        50,
      ),
    ).toBe(false);
  });
});
