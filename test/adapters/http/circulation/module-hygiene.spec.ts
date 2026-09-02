import { readFileSync } from 'node:fs';
import { sourcesUnder } from '../../../support/sources.js';

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bforTesting\b/, why: 'un point d entree que la production expose pour les tests' },
  { pattern: /\bmkdtempSync\b/, why: 'la creation d un repertoire temporaire' },
  { pattern: /\btmpdir\b/, why: 'un chemin de repertoire temporaire' },
  { pattern: /INSERT INTO/i, why: 'un jeu d essai insere en dur' },
  { pattern: /\brequiredString\b/, why: 'la validation ecrite a la main, remplacee par class-validator' },
];

describe('Le module ne porte aucun echafaudage de test', () => {
  const sources = sourcesUnder('src/adapters/http');

  it('aucune source de src/adapters/http ne porte de code de test', () => {
    const offenders: string[] = [];
    for (const path of sources) {
      const text = readFileSync(path, 'utf8');
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(text)) offenders.push(`${path}: ${rule.why}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('le module se declare une fois, dans son decorateur', () => {
    const text = readFileSync('src/adapters/http/circulation/circulation.module.ts', 'utf8');
    expect(text).not.toContain('DynamicModule');
    expect(text).toMatch(/@Module\(\{[\s\S]*controllers:/);
    expect(text).toMatch(/@Module\(\{[\s\S]*providers:/);
  });

  it('les DTO declarent leurs contraintes plutot que de les verifier a la main', () => {
    const text = readFileSync('src/adapters/http/circulation/circulation.dto.ts', 'utf8');
    expect(text).toContain('class-validator');
    expect(text).toMatch(/@IsString\(\)/);
    expect(text).toMatch(/@IsNotEmpty\(\)/);
  });
});
