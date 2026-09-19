import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  computeOffset,
  computePageCount,
  pageWindow,
  parsePageParam
} from './index';

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

  it('accepte une valeur démesurée telle quelle, avant le bornage par pageWindow', () => {
    expect(parsePageParam('9999999999999999')).toBe(9999999999999999);
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

describe('pageWindow', () => {
  it('borne la page et calcule l’offset ensemble', () => {
    expect(pageWindow(2, 100, 25)).toEqual({ page: 2, totalPages: 4, offset: 25 });
  });

  it('ramène une page hors bornes à la dernière page connue', () => {
    expect(pageWindow(999, 100, 25)).toEqual({ page: 4, totalPages: 4, offset: 75 });
  });

  it('ramène une page nulle, négative ou flottante à 1', () => {
    expect(pageWindow(0, 100, 25).page).toBe(1);
    expect(pageWindow(-1, 100, 25).page).toBe(1);
    expect(pageWindow(1.5, 100, 25).page).toBe(1);
  });

  it('renvoie une page 1 et un offset 0 à total nul', () => {
    expect(pageWindow(5, 0, 25)).toEqual({ page: 1, totalPages: 1, offset: 0 });
  });

  it('utilise DEFAULT_PAGE_SIZE quand pageSize est omis', () => {
    expect(pageWindow(1, 30)).toEqual({ page: 1, totalPages: 2, offset: 0 });
  });

  it('ramène une page démesurée (au-delà de Number.MAX_SAFE_INTEGER) sur une liste peuplée à la dernière page', () => {
    expect(pageWindow(Number.MAX_SAFE_INTEGER + 1, 100, 25)).toEqual({
      page: 4,
      totalPages: 4,
      offset: 75
    });
  });

  it('borne sur le chemin de production réel : parsePageParam(raw) puis pageWindow', () => {
    const page = parsePageParam('9999999999999999999999');
    expect(pageWindow(page, 100, 25)).toEqual({ page: 4, totalPages: 4, offset: 75 });
  });
});
