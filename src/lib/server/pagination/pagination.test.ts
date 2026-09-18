import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, computeOffset, computePageCount, parsePageParam } from './index';

describe('DEFAULT_PAGE_SIZE', () => {
  it('vaut 25', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });
});

describe('parsePageParam', () => {
  it('renvoie 1 quand le paramètre est absent', () => {
    expect(parsePageParam(null)).toBe(1);
  });

  it('renvoie 1 quand le paramètre est vide', () => {
    expect(parsePageParam('')).toBe(1);
    expect(parsePageParam('   ')).toBe(1);
  });

  it('renvoie 1 quand le paramètre est non numérique', () => {
    expect(parsePageParam('abc')).toBe(1);
  });

  it('renvoie 1 quand le paramètre est non entier', () => {
    expect(parsePageParam('1.5')).toBe(1);
  });

  it('renvoie 1 quand le paramètre est nul ou négatif', () => {
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('-1')).toBe(1);
  });

  it('accepte une valeur entière positive', () => {
    expect(parsePageParam('3')).toBe(3);
  });

  it('accepte une valeur démesurée quand pageCount est inconnu', () => {
    expect(parsePageParam('9999999999999999')).toBe(9999999999999999);
  });

  it('borne à pageCount une fois celui-ci connu', () => {
    expect(parsePageParam('999', 4)).toBe(4);
    expect(parsePageParam('9999999999999999', 4)).toBe(4);
  });

  it('ne remonte pas une page invalide au-dessus de 1 même avec pageCount connu', () => {
    expect(parsePageParam('abc', 4)).toBe(1);
    expect(parsePageParam('0', 4)).toBe(1);
  });
});

describe('computePageCount', () => {
  it('calcule le nombre de pages à partir du total et de la taille de page', () => {
    expect(computePageCount(100, 25)).toBe(4);
    expect(computePageCount(101, 25)).toBe(5);
    expect(computePageCount(1, 25)).toBe(1);
  });

  it('renvoie 1 quand le total est nul', () => {
    expect(computePageCount(0, 25)).toBe(1);
  });
});

describe('computeOffset', () => {
  it('calcule l’offset à partir de la page et de la taille de page', () => {
    expect(computeOffset(1, 25)).toBe(0);
    expect(computeOffset(2, 25)).toBe(25);
    expect(computeOffset(4, 25)).toBe(75);
  });
});
