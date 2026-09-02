import { readFileSync } from 'node:fs';

const BLOCK_COMMENT = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
const LINE_COMMENT = new RegExp('//[^\\n]*', 'g');

/**
 * Le code d'un fichier, commentaires ôtés.
 *
 * @param path - le fichier à lire
 * @returns son code seul
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8').replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, ' ');
}

describe('La configuration globale appartient au composition root', () => {
  it('le module du guichet n enregistre RIEN de global', () => {
    const code = codeOf('src/adapters/http/circulation/circulation.module.ts');
    expect(code).not.toContain('APP_PIPE');
    expect(code).not.toContain('APP_FILTER');
  });

  it('configureApp applique le pipe et le filtre, en un seul endroit', () => {
    const code = codeOf('src/adapters/http/configure-app.ts');
    expect(code).toContain('ValidationPipe');
    expect(code).toContain('RefusalFilter');
    expect(code).toMatch(/useGlobalPipes/);
    expect(code).toMatch(/useGlobalFilters/);
  });

  it('main.ts appelle configureApp', () => {
    expect(codeOf('src/main.ts')).toContain('configureApp');
  });

  it('le montage de test appelle configureApp et ne configure rien lui-meme', () => {
    const code = codeOf('test/support/circulation-app.ts');
    expect(code).toContain('configureApp');
    expect(code).not.toContain('useGlobalPipes');
    expect(code).not.toContain('new ValidationPipe');
  });

  it('AppModule importe CirculationModule : l API est joignable par l application reelle', () => {
    const code = codeOf('src/app.module.ts');
    expect(code).toContain('CirculationModule');
    expect(code).toMatch(/imports:\s*\[[^\]]*CirculationModule/);
  });
});
