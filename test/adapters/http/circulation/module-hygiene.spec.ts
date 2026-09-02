import { readFileSync } from 'node:fs';
import { codeOf, sourcesUnder } from '../../../support/sources.js';

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\bforTesting\b/,
    why: 'un point d entree que la production expose pour les tests',
  },
  { pattern: /\bmkdtempSync\b/, why: 'la creation d un repertoire temporaire' },
  { pattern: /\btmpdir\b/, why: 'un chemin de repertoire temporaire' },
  { pattern: /INSERT INTO/i, why: 'un jeu d essai insere en dur' },
  {
    pattern: /\brequiredString\b/,
    why: 'la validation ecrite a la main, remplacee par class-validator',
  },
];

/**
 * Les commentaires sont dépouillés avant le scan : une explication peut
 * légitimement citer ce qu'elle interdit, et seule une occurrence dans le CODE
 * est un couplage. C'est le principe que le cœur applique dans son propre gate
 * d'agnosticité, et le même défaut avait déjà été corrigé sur le test
 * d'étanchéité des seuils.
 */
describe('Le module ne porte aucun echafaudage de test', () => {
  const sources = sourcesUnder('src/adapters/http');

  it('aucune source de src/adapters/http ne porte de code de test', () => {
    const BLOCK_COMMENT = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
    const LINE_COMMENT = new RegExp('//[^\\n]*', 'g');
    const offenders: string[] = [];
    for (const path of sources) {
      const text = readFileSync(path, 'utf8')
        .replace(BLOCK_COMMENT, ' ')
        .replace(LINE_COMMENT, ' ');
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(text)) offenders.push(`${path}: ${rule.why}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('le module se declare une fois, dans son decorateur', () => {
    const text = readFileSync(
      'src/adapters/http/circulation/circulation.module.ts',
      'utf8',
    );
    expect(text).not.toContain('DynamicModule');
    expect(text).toMatch(/@Module\(\{[\s\S]*controllers:/);
    expect(text).toMatch(/@Module\(\{[\s\S]*providers:/);
  });

  it('les DTO declarent leurs contraintes plutot que de les verifier a la main', () => {
    const files = sourcesUnder('src/adapters/http/circulation/dto');
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text).toContain('class-validator');
      expect(text).toMatch(/@IsString\(\)/);
      expect(text).toMatch(/@IsNotEmpty\(\)/);
    }
  });

  it('aucun DTO n esquive strictPropertyInitialization', () => {
    for (const file of sourcesUnder('src/adapters/http/circulation/dto')) {
      const code = codeOf(file);
      expect(code).not.toMatch(/[A-Za-z_]!\s*:/);
      expect(code).not.toMatch(/\bdeclare\s+\w+\s*:/);
    }
  });
});
