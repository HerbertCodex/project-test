import { readFileSync } from 'node:fs';
import { sourcesUnder } from '../support/sources.js';
import {
  DEFAULT_POLICY,
  IncoherentPolicy,
  assertCoherent,
  loadPolicy,
} from '../../src/infrastructure/config/circulation-policy.js';

/**
 * Ce qu'un fichier laisse fuir de la politique.
 *
 * Les valeurs cherchées sont les quatre distinctives. 5 et 8 sont exclus
 * volontairement : trop courants pour distinguer un seuil d'un nombre
 * ordinaire, et un test qui crie au loup finit supprimé.
 *
 * @param path - le fichier lu
 * @returns une ligne par fuite constatée
 */
function leaksIn(path: string): string[] {
  const BLOCK_COMMENT = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const LINE_COMMENT = new RegExp('//[^\\n]*', 'g');
  const text = readFileSync(path, 'utf8')
    .replace(BLOCK_COMMENT, ' ')
    .replace(LINE_COMMENT, ' ');
  const found: string[] = [];
  if (/CirculationPolicy|DEFAULT_POLICY/.test(text))
    found.push(`${path}: importe la politique`);
  for (const value of ['23', '43', '45', '50']) {
    const literal = new RegExp(`(?<![\\w.])${value}(?![\\w.])`);
    if (literal.test(text)) found.push(`${path}: porte le litteral ${value}`);
  }
  return found;
}

describe('Politique de circulation', () => {
  const incoherent = {
    ...DEFAULT_POLICY,
    lateFeePerDay: 0,
    debtBlockThreshold: 50,
  };

  it('porte les huit seuils arretes au round 2', () => {
    const byKey = (left: [string, unknown], right: [string, unknown]): number =>
      left[0].localeCompare(right[0]);
    const expected: [string, number][] = [
      ['borrowCeiling', 43],
      ['debtBlockThreshold', 50],
      ['holdCeiling', 43],
      ['holdPickupDays', 8],
      ['lateFeePerDay', 0.2],
      ['loanPeriodDays', 23],
      ['lostAfterDays', 45],
      ['renewalLimit', 5],
    ];
    expect(Object.entries(DEFAULT_POLICY).sort(byKey)).toEqual(
      expected.sort(byKey),
    );
  });

  it('lit les seuils depuis l environnement, defaut sinon', () => {
    expect(loadPolicy({ LOAN_PERIOD_DAYS: '14' }).loanPeriodDays).toBe(14);
    expect(loadPolicy({}).loanPeriodDays).toBe(DEFAULT_POLICY.loanPeriodDays);
  });

  it('refuse une valeur qui n est pas un nombre', () => {
    expect(() => loadPolicy({ BORROW_CEILING: 'beaucoup' })).toThrow(
      IncoherentPolicy,
    );
  });

  it('REFUSE un bareme nul avec un seuil de blocage non nul', () => {
    expect(() => assertCoherent(incoherent)).toThrow(IncoherentPolicy);
  });

  it('nomme les deux cles dans le message du refus', () => {
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
    expect(() =>
      assertCoherent({
        ...DEFAULT_POLICY,
        lateFeePerDay: 0,
        debtBlockThreshold: 0,
      }),
    ).not.toThrow();
  });

  it('refuse au chargement, pas seulement a la verification', () => {
    expect(() => loadPolicy({ LATE_FEE_PER_DAY: '0' })).toThrow(
      IncoherentPolicy,
    );
  });

  it('ne laisse aucun seuil fuir dans le domaine ni l application', () => {
    const roots = ['src/domain', 'src/application'];
    const leaks = roots.flatMap((root) =>
      sourcesUnder(root).flatMap((path) => leaksIn(path)),
    );
    expect(leaks).toEqual([]);
  });
});
