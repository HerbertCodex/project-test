import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const srcDir = join(projectRoot, 'src');
const appCssPath = join(projectRoot, 'src/lib/styles/app.css');
const catalogueTablePath = join(projectRoot, 'src/lib/components/CatalogueTable.svelte');

const TEXT_MIN_RATIO = 4.5;
const NON_TEXT_MIN_RATIO = 3;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function filesUnder(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
  });
}

/**
 * Lit la propriété personnalisée `--name` du bloc `:root` d'une feuille CSS.
 * Lève une erreur nommant la variable si elle est absente ou si sa valeur n'est pas
 * un hexadécimal à 6 chiffres, pour qu'un couple invérifiable ne passe jamais en silence.
 */
function rootColor(css: string, name: string): string {
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  if (!root) throw new Error(`Bloc :root introuvable, impossible de lire --${name}`);
  // Le `:` juste après le nom évite que `--brass` corresponde à `--brass-text`.
  const declaration = new RegExp(`(?:^|[\\s;{])--${name}\\s*:\\s*([^;]*);`).exec(root[1]);
  if (!declaration) throw new Error(`Variable --${name} absente du bloc :root`);
  const value = declaration[1].trim();
  if (!HEX_COLOR.test(value)) {
    throw new Error(`Variable --${name} : valeur « ${value} » non hexadécimale à 6 chiffres`);
  }
  return value;
}

/** Luminance relative d'une couleur `#rrggbb` selon WCAG 2.x. */
function relativeLuminance(hex: string): number {
  if (!HEX_COLOR.test(hex)) throw new Error(`Couleur « ${hex} » non hexadécimale à 6 chiffres`);
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG 2.x entre deux couleurs `#rrggbb`, indépendant de leur ordre. */
function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a
  );
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Teintes de fond littérales (`background: #rrggbb`) d'un fichier, avec le sélecteur
 * qui les déclare, pour suivre les couvertures sans recopier leurs valeurs.
 */
function literalBackgrounds(source: string): { selector: string; hex: string }[] {
  const pattern = /([.\w-]+)\s*\{[^}]*?\bbackground\s*:\s*(#[0-9a-f]{6})\s*;/gi;
  return [...source.matchAll(pattern)].map((match) => ({ selector: match[1], hex: match[2] }));
}

/** Blocs `<style>` d'un composant Svelte. */
function styleBlocks(source: string): string {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

/** Déclarations `color:` (propriété exacte) qui utilisent `var(--brass)` exactement. */
function brassColorDeclarations(css: string): string[] {
  return [...css.matchAll(/(?:^|[\s;{])(color\s*:[^;}]*var\(\s*--brass\s*\)[^;}]*)/g)].map(
    (m) => m[1].trim()
  );
}

type Pair = { foreground: string; background: string; usage: string };

const TEXT_PAIRS: Pair[] = [
  { foreground: 'ink', background: 'ivory', usage: 'texte courant' },
  { foreground: 'ink', background: 'paper', usage: 'texte sur papier' },
  { foreground: 'ink-2', background: 'ivory', usage: 'texte secondaire' },
  { foreground: 'ink-2', background: 'paper', usage: 'texte secondaire sur papier' },
  { foreground: 'danger', background: 'ivory', usage: 'erreur de champ' },
  { foreground: 'danger', background: 'paper', usage: 'erreur sur papier' },
  { foreground: 'danger', background: 'danger-wash', usage: 'badge de retard, titre d’erreur' },
  { foreground: 'ink', background: 'danger-wash', usage: 'message d’erreur' },
  { foreground: 'ink', background: 'success-wash', usage: 'message de succès' },
  { foreground: 'success', background: 'success-wash', usage: 'titre de succès' },
  { foreground: 'success', background: 'ivory', usage: 'statut disponible' },
  { foreground: 'ivory', background: 'ink', usage: 'bandeau libraire, bouton principal' },
  { foreground: 'ivory', background: 'ink-hover', usage: 'bouton principal survolé' },
  { foreground: 'ivory', background: 'ink-2', usage: 'bouton en cours d’envoi' },
  { foreground: 'brass-light', background: 'ink', usage: 'étiquette « Espace libraire »' },
  { foreground: 'brass-text', background: 'ivory', usage: 'texte laiton' }
];

const NON_TEXT_PAIRS: Pair[] = [
  { foreground: 'rule-strong', background: 'ivory', usage: 'bordure de champ' },
  { foreground: 'rule-strong', background: 'paper', usage: 'bordure de champ sur papier' },
  { foreground: 'success', background: 'ivory', usage: 'repère de statut' },
  { foreground: 'success', background: 'paper', usage: 'repère de statut sur papier' },
  { foreground: 'ink-2', background: 'ivory', usage: 'repère de statut' },
  { foreground: 'ink-2', background: 'paper', usage: 'repère de statut sur papier' },
  { foreground: 'ink', background: 'ivory', usage: 'contour de focus' },
  { foreground: 'ink', background: 'paper', usage: 'contour de focus sur papier' },
  { foreground: 'ivory', background: 'ink', usage: 'contour de focus du bandeau libraire' },
  { foreground: 'brass-light', background: 'ink', usage: 'repère de page active' },
  { foreground: 'brass', background: 'ivory', usage: 'ornement' }
];

const appCss = readFileSync(appCssPath, 'utf8');

describe('Calcul du contraste WCAG', () => {
  it('donne 21:1 pour noir sur blanc', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('donne 1:1 pour une couleur sur elle-même', () => {
    expect(contrastRatio('#4a5068', '#4a5068')).toBeCloseTo(1, 5);
  });

  it('juge #777777 sur #ffffff insuffisant pour du texte', () => {
    const ratio = contrastRatio('#777777', '#ffffff');
    expect(ratio).toBeGreaterThan(4.4);
    expect(ratio).toBeLessThan(TEXT_MIN_RATIO);
  });

  it('refuse une couleur qui n’est pas un hexadécimal à 6 chiffres', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow('#fff');
  });
});

describe('Lecture des variables :root', () => {
  it('lit une variable hexadécimale sans confondre les préfixes', () => {
    const css = ':root { --brass-text: #111111; --brass: #222222; }';
    expect(rootColor(css, 'brass')).toBe('#222222');
    expect(rootColor(css, 'brass-text')).toBe('#111111');
  });

  it('lève une erreur nommant une variable absente', () => {
    const css = ':root { --ivory: #f8f4ea; }';
    expect(() => rootColor(css, 'ink')).toThrow('--ink');
  });

  it('ignore une variable déclarée hors de :root', () => {
    const css = ':root { --ivory: #f8f4ea; }\n.x { --ink: #14213d; }';
    expect(() => rootColor(css, 'ink')).toThrow('--ink');
  });

  it.each(['rgb(20 33 61)', 'red', '#fff', 'var(--ivory)'])(
    'lève une erreur nommant la variable pour la valeur %s',
    (value) => {
      const css = `:root { --ink: ${value}; }`;
      expect(() => rootColor(css, 'ink')).toThrow('--ink');
    }
  );

  it('lève une erreur sans bloc :root', () => {
    expect(() => rootColor('body { color: red; }', 'ink')).toThrow('--ink');
  });
});

describe('Contrastes des couples texte / fond d’app.css', () => {
  it.each(TEXT_PAIRS)(
    '$foreground sur $background ($usage) atteint 4,5:1',
    ({ foreground, background }) => {
      const ratio = contrastRatio(rootColor(appCss, foreground), rootColor(appCss, background));
      expect(ratio).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
    }
  );
});

describe('Contrastes des couples non textuels d’app.css', () => {
  it.each(NON_TEXT_PAIRS)(
    '$foreground sur $background ($usage) atteint 3:1',
    ({ foreground, background }) => {
      const ratio = contrastRatio(rootColor(appCss, foreground), rootColor(appCss, background));
      expect(ratio).toBeGreaterThanOrEqual(NON_TEXT_MIN_RATIO);
    }
  );
});

describe('Teintes de couverture de CatalogueTable.svelte', () => {
  const covers = literalBackgrounds(readFileSync(catalogueTablePath, 'utf8'));

  it('déclare au moins une teinte littérale à vérifier', () => {
    expect(covers.length).toBeGreaterThan(0);
  });

  it.each(covers)('ivory sur $selector ($hex) atteint 4,5:1', ({ hex }) => {
    expect(contrastRatio(rootColor(appCss, 'ivory'), hex)).toBeGreaterThanOrEqual(
      TEXT_MIN_RATIO
    );
  });
});

describe('Laiton réservé aux ornements', () => {
  it('brass sur ivory atteint 3:1 mais reste sous 4,5:1', () => {
    const ratio = contrastRatio(rootColor(appCss, 'brass'), rootColor(appCss, 'ivory'));
    expect(ratio).toBeGreaterThanOrEqual(NON_TEXT_MIN_RATIO);
    expect(ratio).toBeLessThan(TEXT_MIN_RATIO);
  });

  it('repère color: var(--brass) sans viser --brass-text, --brass-light ni border-color', () => {
    const css = [
      '.a { color: var(--brass); }',
      '.b { color: var(--brass-text); }',
      '.c { color: var(--brass-light); }',
      '.d { border-bottom-color: var(--brass); }',
      '.e{color:var( --brass )}'
    ].join('\n');
    expect(brassColorDeclarations(css)).toEqual(['color: var(--brass)', 'color:var( --brass )']);
  });

  it('n’utilise var(--brass) dans aucune déclaration color: d’app.css', () => {
    expect(brassColorDeclarations(appCss)).toEqual([]);
  });

  it('n’utilise var(--brass) dans aucune déclaration color: des composants et pages', () => {
    const offenders = filesUnder(srcDir, '.svelte')
      .filter(
        (file) => brassColorDeclarations(styleBlocks(readFileSync(file, 'utf8'))).length > 0
      )
      .map((file) => relative(projectRoot, file));
    expect(offenders).toEqual([]);
  });
});
