import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../svelte.config.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(projectRoot, 'src');

function filesUnder(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
  });
}

describe('CSRF dans svelte.config.js', () => {
  it('laisse active la vérification d’origine de SvelteKit', () => {
    expect(config.kit?.csrf?.checkOrigin).not.toBe(false);
  });

  it('ne déclare aucune origine de confiance générique', () => {
    const trustedOrigins = config.kit?.csrf?.trustedOrigins ?? [];
    for (const origin of trustedOrigins) {
      expect(origin).not.toContain('*');
      expect(new URL(origin).origin).toBe(origin);
    }
  });

  it('ne désactive pas la vérification dans le source de la configuration', () => {
    const source = readFileSync(join(projectRoot, 'svelte.config.js'), 'utf8');
    expect(source).not.toMatch(/checkOrigin\s*:\s*false/);
    expect(source).not.toMatch(/trustedOrigins[^\]]*['"`]\*['"`]/);
  });
});

describe('CSP dans svelte.config.js', () => {
  const directives = config.kit?.csp?.directives;

  it('garde le mode auto et chaque directive restrictive', () => {
    expect(config.kit?.csp?.mode).toBe('auto');
    expect(directives?.['script-src']).toEqual(['self']);
    expect(directives?.['object-src']).toEqual(['none']);
    expect(directives?.['base-uri']).toEqual(['self']);
    expect(directives?.['form-action']).toEqual(['self']);
  });

  it('n’autorise aucune source générique, distante ni inline non contrôlée', () => {
    for (const sources of Object.values(directives ?? {})) {
      if (!Array.isArray(sources)) continue;
      for (const source of sources as string[]) {
        expect(source).not.toBe('*');
        expect(source).not.toMatch(/^(https?:|data:|unsafe-inline$|unsafe-eval$)/);
      }
    }
  });
});

describe('Rendu des contenus', () => {
  it('n’utilise {@html} dans aucun composant', () => {
    const offenders = filesUnder(srcDir, '.svelte')
      .filter((file) => readFileSync(file, 'utf8').includes('{@html'))
      .map((file) => relative(projectRoot, file));
    expect(offenders).toEqual([]);
  });
});
