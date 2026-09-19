/**
 * Module transverse de bornage de page et de calcul d'offset, réutilisé par
 * les cinq listes paginées. Ne connaît ni Db ni SQL : chaque domaine garde son
 * propre COUNT(*) et son propre SELECT ... LIMIT ? OFFSET ? à paramètres liés.
 */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Borne un paramètre `page` brut lu dans l'URL à un entier valide.
 * Absent, vide, non numérique, non entier ou < 1 devient 1. Le bornage à
 * `pageCount` (une fois le total connu) est appliqué séparément par
 * `pageWindow`, une fois le total lu en base.
 */
export function parsePageParam(raw: string | null): number {
  if (raw !== null && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return 1;
}

/**
 * Calcule le nombre total de pages pour `total` éléments à `pageSize` par
 * page. Toujours au moins 1, pour rester défini même à 0 résultat.
 */
export function computePageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Calcule l'OFFSET SQL pour un numéro de page déjà borné (base 1). */
export function computeOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** Fenêtre de pagination : page bornée, nombre de pages et offset SQL correspondant. */
export type PageWindow = {
  page: number;
  totalPages: number;
  offset: number;
};

/**
 * Borne `page` à [1, totalPages] connaissant le total réel de lignes pour un
 * domaine, et calcule l'offset SQL associé. Point d'entrée unique partagé par
 * le catalogue, la vente, les prêts et le journal de sécurité.
 */
export function pageWindow(page: number, totalItems: number, pageSize = DEFAULT_PAGE_SIZE): PageWindow {
  const totalPages = computePageCount(totalItems, pageSize);
  const clampedPage = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  return { page: clampedPage, totalPages, offset: computeOffset(clampedPage, pageSize) };
}
