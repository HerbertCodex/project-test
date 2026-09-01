import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_POLICY,
  IncoherentPolicy,
  assertCoherent,
  loadPolicy,
} from '../../src/infrastructure/config/circulation-policy.js';

/**
 * Les fichiers TypeScript sous une racine.
 */
function sourcesUnder(root: string, found: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) sourcesUnder(path, found);
    else if (path.endsWith('.ts')) found.push(path);
  }
  return found;
}

describe('Politique de circulation', () => {
  it('porte les huit seuils arretes au round 2', () => {
    expect(DEFAULT_POLICY).toEqual({
      loanPeriodDays: 23,
      renewalLimit: 5,
      borrowCeiling: 43,
      holdCeiling: 43,
      lostAfterDays: 45,
      debtBlockThreshold: 50,
      holdPickupDays: 8,
      lateFeePerDay: 0.2,
    });
  });

  it('lit les seuils depuis l environnement, defaut sinon', () => {
    expect(loadPolicy({ LOAN_PERIOD_DAYS: '14' }).loanPeriodDays).toBe(14);
    expect(loadPolicy({}).loanPeriodDays).toBe(DEFAULT_POLICY.loanPeriodDays);
  });

  it('REFUSE un bareme nul avec un seuil de blocage non nul', () => {
    const incoherent = { ...DEFAULT_POLICY, lateFeePerDay: 0, debtBlockThreshold: 50 };
    expect(() => assertCoherent(incoherent)).toThrow(IncoherentPolicy);
  });

  it('nomme les deux cles dans le message du refus', () => {
    const incoherent = { ...DEFAULT_POLICY, lateFeePerDay: 0, debtBlockThreshold: 50 };
    let message = '';
    try {
      assertCoherent(incoherent);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('lateFeePerDay');
    expect(message).toContain('debtBlockThreshold');
  });

  it('accepte un bareme nul quand le seuil de blocage est nul aussi', () => {
    const noFines = { ...DEFAULT_POLICY, lateFeePerDay: 0, debtBlockThreshold: 0 };
    expect(() => assertCoherent(noFines)).not.toThrow();
  });

  it('refuse au chargement, pas seulement a la verification', () => {
    expect(() => loadPolicy({ LATE_FEE_PER_DAY: '0' })).toThrow(IncoherentPolicy);
  });

  it('ne laisse aucun seuil fuir dans le domaine ni l application', () => {
    const distinctive = ['23', '43', '45', '50'];
    const leaks: string[] = [];
    for (const root of ['src/domain', 'src/application']) {
      for (const path of sourcesUnder(root)) {
        const text = readFileSync(path, 'utf8');
        if (/CirculationPolicy|DEFAULT_POLICY/.test(text)) leaks.push(`${path}: importe la politique`);
        for (const value of distinctive) {
          if (new RegExp(`(?<![\\w.])${value}(?![\\w.])`).test(text)) {
            leaks.push(`${path}: porte le litteral ${value}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
