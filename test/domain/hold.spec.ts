import { Hold, queueFor, firstWaiting } from '../../src/domain/hold.js';

const T0 = new Date('2026-03-01T10:00:00Z');
const T1 = new Date('2026-03-02T10:00:00Z');
const T2 = new Date('2026-03-03T10:00:00Z');

const waiting = (memberId: string, placedAt: Date): Hold =>
  new Hold({ titleId: 't1', memberId, placedAt });

describe('Hold', () => {
  it('attend tant qu aucun exemplaire ne lui est mis de cote', () => {
    expect(waiting('m1', T0).isWaiting()).toBe(true);
    expect(waiting('m1', T0).isReady()).toBe(false);
  });

  it('est prete des qu un exemplaire lui est mis de cote', () => {
    const ready = new Hold({
      titleId: 't1',
      memberId: 'm1',
      placedAt: T0,
      setAsideCopyId: 'c1',
      pickupBy: T2,
    });
    expect(ready.isReady()).toBe(true);
    expect(ready.isWaiting()).toBe(false);
  });

  it('la file est servie dans l ordre d arrivee', () => {
    const holds = [waiting('m3', T2), waiting('m1', T0), waiting('m2', T1)];
    expect(queueFor('t1', holds).map((hold) => hold.memberId)).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
  });

  it('ne melange pas les files de deux titres', () => {
    const other = new Hold({ titleId: 't2', memberId: 'mx', placedAt: T0 });
    expect(
      queueFor('t1', [other, waiting('m1', T1)]).map((h) => h.memberId),
    ).toEqual(['m1']);
  });

  it('le premier en attente ignore celles qui sont deja pretes', () => {
    const ready = new Hold({
      titleId: 't1',
      memberId: 'm1',
      placedAt: T0,
      setAsideCopyId: 'c9',
      pickupBy: T2,
    });
    expect(firstWaiting('t1', [ready, waiting('m2', T1)])?.memberId).toBe('m2');
  });

  it('rend null quand personne n attend', () => {
    expect(firstWaiting('t1', [])).toBeNull();
  });
});
