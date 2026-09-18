/**
 * Catalogue public et ajout de livres par le libraire.
 *
 * Toutes les fonctions reçoivent la base en paramètre. Le SQL passe
 * exclusivement par des requêtes préparées à paramètres liés.
 */
import { error, redirect } from '@sveltejs/kit';
import type { AuthUser, Validation } from '../auth';
import type { Db } from '../db';
import { computeOffset, computePageCount, DEFAULT_PAGE_SIZE } from '../pagination';

// ---------------------------------------------------------------------------
// Contrôle d'accès
// ---------------------------------------------------------------------------

export const BOOKSELLER_ONLY_MESSAGE = 'Cette page est réservée au libraire.';

/**
 * Garde serveur de l'espace libraire : un visiteur anonyme est redirigé vers
 * /connexion, un emprunteur reçoit une 403. À appeler dans chaque load et
 * chaque action de /libraire/**, car les actions ne passent pas par les load.
 */
export function requireBookseller(user: AuthUser | null): AuthUser {
  if (!user) redirect(303, '/connexion');
  if (user.role !== 'bookseller') error(403, BOOKSELLER_ONLY_MESSAGE);
  return user;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export type BookLoanStatus = 'available' | 'borrowed';

/** « En vente » exige un prix et au moins un exemplaire ; tout le reste est « Épuisé ». */
export type BookSaleStatus = 'on-sale' | 'sold-out';

/**
 * Ligne du catalogue public : ni emprunteur, ni échéance, ni stock chiffré
 * (le stock de vente n'est visible que du libraire).
 */
export type CatalogueEntry = {
  id: number;
  title: string;
  author: string;
  status: BookLoanStatus;
  priceCents: number | null;
  saleStatus: BookSaleStatus;
};

/** Filtres déjà normalisés, combinés par ET. */
export type CatalogueFilters = {
  text?: string;
  availableForLoan?: boolean;
  availableForSale?: boolean;
};

/** Valeurs brutes des filtres (paramètres d'URL) : rien n'est présumé. */
export type CatalogueFilterInput = {
  text?: unknown;
  availableForLoan?: unknown;
  availableForSale?: unknown;
};

/** Noms des paramètres GET du catalogue public. */
export const CATALOGUE_FILTER_PARAMS = {
  text: 'q',
  availableForLoan: 'pret',
  availableForSale: 'vente'
} as const satisfies Record<keyof CatalogueFilters, string>;

/** Valeurs qui activent un filtre de disponibilité (« on » : case à cocher HTML). */
const FILTER_ENABLED_VALUES: readonly unknown[] = [true, 'on', '1'];

type CatalogueRow = {
  id: number;
  title: string;
  author: string;
  borrowed: number;
  price_cents: number | null;
  on_sale: number;
};

const frenchCollator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/**
 * Ordre d'affichage des livres, partagé par le catalogue et l'écran de vente :
 * titre puis auteur selon la collation française (sans casse ni accents,
 * nombres dans l'ordre numérique), puis identifiant pour un ordre stable.
 */
export function compareBooksByTitle(
  a: { id: number; title: string; author: string },
  b: { id: number; title: string; author: string }
): number {
  return (
    frenchCollator.compare(a.title, b.title) ||
    frenchCollator.compare(a.author, b.author) ||
    a.id - b.id
  );
}

/**
 * Pliage du texte pour la recherche : minuscules, sans diacritiques, ligatures
 * développées, comme la comparaison de base de frenchCollator.
 */
function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

const FOLD_FUNCTION = 'catalogue_fold';
const foldRegistered = new WeakSet<Db>();

/** Déclare une fois par connexion la fonction SQL de pliage utilisée par la recherche. */
function ensureFoldFunction(db: Db): void {
  if (foldRegistered.has(db)) return;
  db.function(FOLD_FUNCTION, { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? foldText(value) : null
  );
  foldRegistered.add(db);
}

/** Les jokers LIKE saisis (%, _) et le caractère d'échappement deviennent littéraux. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Terme de recherche : caractères de contrôle remplacés par des espaces,
 * espaces autour retirés, borné à BOOK_TEXT_MAX_LENGTH caractères. Vide → absent.
 */
function normalizeSearchText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/\p{Cc}/gu, ' ').trim();
  const bounded = Array.from(cleaned).slice(0, BOOK_TEXT_MAX_LENGTH).join('').trim();
  return bounded.length > 0 ? bounded : undefined;
}

/** Normalise des filtres bruts : toute valeur absente, vide ou inconnue est ignorée. */
export function normalizeCatalogueFilters(input: CatalogueFilterInput): CatalogueFilters {
  const filters: CatalogueFilters = {};
  const text = normalizeSearchText(input.text);
  if (text !== undefined) filters.text = text;
  if (FILTER_ENABLED_VALUES.includes(input.availableForLoan)) filters.availableForLoan = true;
  if (FILTER_ENABLED_VALUES.includes(input.availableForSale)) filters.availableForSale = true;
  return filters;
}

/** Filtres lus dans les paramètres GET du catalogue public. */
export function catalogueFiltersFromSearchParams(params: URLSearchParams): CatalogueFilters {
  return normalizeCatalogueFilters({
    text: params.get(CATALOGUE_FILTER_PARAMS.text),
    availableForLoan: params.get(CATALOGUE_FILTER_PARAMS.availableForLoan),
    availableForSale: params.get(CATALOGUE_FILTER_PARAMS.availableForSale)
  });
}

const ACTIVE_LOAN_EXISTS = `EXISTS (
  SELECT 1 FROM loans WHERE loans.book_id = books.id AND loans.returned_on IS NULL
)`;

// sale_stock sert uniquement à dériver on_sale : sa valeur n'est jamais renvoyée.
const ON_SALE = '(books.price_cents IS NOT NULL AND books.sale_stock > 0)';

/** Page d'un catalogue paginé : les lignes de la page demandée et le total réel. */
export type CataloguePage = {
  items: CatalogueEntry[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

/** Borne `page` à [1, totalPages] connaissant le total réel de lignes, et calcule l'offset SQL. */
function pageWindow(page: number, totalItems: number) {
  const totalPages = computePageCount(totalItems, DEFAULT_PAGE_SIZE);
  const clampedPage = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  return { clampedPage, totalPages, offset: computeOffset(clampedPage, DEFAULT_PAGE_SIZE) };
}

/**
 * Page de livres du catalogue, triée en SQL par titre puis auteur (pliage
 * partagé avec la recherche), puis identifiant pour un ordre total et stable
 * entre deux pages. Les filtres sont normalisés ici aussi, puis appliqués en
 * SQL à paramètres liés ; le total renvoyé porte sur les mêmes conditions.
 */
export function listCatalogue(
  db: Db,
  rawFilters: CatalogueFilterInput = {},
  page = 1
): CataloguePage {
  const filters = normalizeCatalogueFilters(rawFilters);
  ensureFoldFunction(db);
  // Fragments SQL constants uniquement ; les valeurs passent par `params`.
  const conditions: string[] = [];
  const params: string[] = [];

  if (filters.text !== undefined) {
    const pattern = `%${escapeLike(foldText(filters.text))}%`;
    conditions.push(
      `(${FOLD_FUNCTION}(books.title) LIKE ? ESCAPE '\\' OR ${FOLD_FUNCTION}(books.author) LIKE ? ESCAPE '\\')`
    );
    params.push(pattern, pattern);
  }
  if (filters.availableForLoan) conditions.push(`NOT ${ACTIVE_LOAN_EXISTS}`);
  if (filters.availableForSale) conditions.push(ON_SALE);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM books ${where}`).get(...params) as {
    count: number;
  };
  const { clampedPage, totalPages, offset } = pageWindow(page, count);

  const rows = db
    .prepare(
      `SELECT books.id, books.title, books.author, books.price_cents,
         ${ACTIVE_LOAN_EXISTS} AS borrowed,
         ${ON_SALE} AS on_sale
       FROM books
       ${where}
       ORDER BY ${FOLD_FUNCTION}(books.title), ${FOLD_FUNCTION}(books.author), books.id
       LIMIT ? OFFSET ?`
    )
    .all(...params, DEFAULT_PAGE_SIZE, offset) as CatalogueRow[];

  const items = rows.map(
    (row): CatalogueEntry => ({
      id: row.id,
      title: row.title,
      author: row.author,
      status: row.borrowed ? 'borrowed' : 'available',
      priceCents: row.price_cents,
      saleStatus: row.on_sale ? 'on-sale' : 'sold-out'
    })
  );

  return { items, page: clampedPage, pageSize: DEFAULT_PAGE_SIZE, totalItems: count, totalPages };
}

// ---------------------------------------------------------------------------
// Ajout d'un livre
// ---------------------------------------------------------------------------

export const BOOK_TEXT_MAX_LENGTH = 200;

export type BookField = 'title' | 'author' | 'price' | 'saleStock';
export type BookFieldErrors = Partial<Record<BookField, string>>;

/** Valeurs brutes du formulaire : rien n'est présumé. Prix et stock sont facultatifs. */
export type BookInput = { title: unknown; author: unknown; price?: unknown; saleStock?: unknown };
export type ValidBook = {
  title: string;
  author: string;
  priceCents: number | null;
  saleStock: number;
};
export type BookValidation = { ok: true; value: ValidBook } | { ok: false; errors: BookFieldErrors };

/** Livre créé, vu du libraire : le stock chiffré y figure. */
export type NewBook = { id: number } & ValidBook;
export type BookCreationResult = { ok: true; book: NewBook } | { ok: false; errors: BookFieldErrors };

const CONTROL_CHARACTER = /\p{Cc}/u;

const FIELD_WORDING: Record<'title' | 'author', { missing: string; subject: string }> = {
  title: { missing: 'Saisissez un titre.', subject: 'Le titre' },
  author: { missing: 'Saisissez un auteur.', subject: 'L’auteur' }
};

function validateBookText(field: 'title' | 'author', raw: unknown): Validation<string> {
  const wording = FIELD_WORDING[field];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) {
    return { ok: false, error: wording.missing };
  }
  if (value.length > BOOK_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      error: `${wording.subject} ne doit pas dépasser ${BOOK_TEXT_MAX_LENGTH} caractères.`
    };
  }
  if (CONTROL_CHARACTER.test(value)) {
    return { ok: false, error: `${wording.subject} contient des caractères non autorisés.` };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Prix et stock de vente
// ---------------------------------------------------------------------------

/** Bornes techniques : prix de 0,01 € à 10 000,00 €, stock de 0 à 10 000. */
export const PRICE_MAX_CENTS = 1_000_000;
export const SALE_STOCK_MAX = 10_000;

const euroFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const frenchInteger = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/**
 * Entier au format français, avec l'espace de groupement d'Intl
 * (« 1 000 »), pour les messages qui citent une borne ou un stock.
 */
export function formatInteger(n: number): string {
  return frenchInteger.format(n);
}

/**
 * Prix en centimes au format français, par exemple « 12,50 € ». Le montant est
 * transmis à Intl sous forme de chaîne décimale : aucun calcul en flottant.
 */
export function formatPrice(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const euros = Math.trunc(absolute / 100);
  const amount: string = `${sign}${euros}.${String(absolute % 100).padStart(2, '0')}`;
  return euroFormatter.format(amount as `${number}`);
}

/** Prix en centimes tel qu'il se saisit (« 12,50 »), pour préremplir un champ. */
export function formatPriceInput(cents: number): string {
  return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

export const PRICE_MISSING_MESSAGE = 'Saisissez un prix.';
// Un seul libellé pour les saisies mal formées, nulles ou négatives : il dit quoi saisir.
const PRICE_FORMAT_MESSAGE =
  'Indiquez un montant positif avec au plus deux décimales, par exemple 12,50.';
export const PRICE_INVALID_MESSAGE = PRICE_FORMAT_MESSAGE;
export const PRICE_NOT_POSITIVE_MESSAGE = PRICE_FORMAT_MESSAGE;
export const PRICE_DECIMALS_MESSAGE = PRICE_FORMAT_MESSAGE;
export const PRICE_TOO_HIGH_MESSAGE = `Le prix ne doit pas dépasser ${formatPrice(PRICE_MAX_CENTS)}.`;

export const SALE_STOCK_INVALID_MESSAGE =
  'Saisissez un stock de vente en nombre entier d’exemplaires, par exemple 3.';
export const SALE_STOCK_NEGATIVE_MESSAGE = 'Le stock de vente ne peut pas être négatif.';
export const SALE_STOCK_TOO_HIGH_MESSAGE = `Le stock de vente ne doit pas dépasser ${formatInteger(SALE_STOCK_MAX)} exemplaires.`;

// Chiffres ASCII seulement ; un nombre démesuré devient Infinity et échoue à la borne haute.
const PRICE_PATTERN = /^(\d+)(?:[.,](\d{1,2}))?$/;
const PRICE_TOO_PRECISE = /^\d+[.,]\d{3,}$/;
/** Saisie qui commence par un signe moins suivi d'un chiffre, espaces tolérées (« -1 », « - 3 »). */
export const NEGATIVE_NUMBER = /^-\s*\d/;
const STOCK_PATTERN = /^\d+$/;

function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
}

/**
 * Prix saisi en euros (« 12 », « 12,50 », « 12.50 », symbole € final toléré),
 * converti en centimes entiers et borné à ]0 ; PRICE_MAX_CENTS].
 */
export function validatePrice(raw: unknown): Validation<number> {
  if (isBlank(raw)) return { ok: false, error: PRICE_MISSING_MESSAGE };
  if (typeof raw !== 'string') return { ok: false, error: PRICE_INVALID_MESSAGE };

  const value = raw.trim().replace(/\s*€$/, '');
  if (NEGATIVE_NUMBER.test(value)) return { ok: false, error: PRICE_NOT_POSITIVE_MESSAGE };
  if (PRICE_TOO_PRECISE.test(value)) return { ok: false, error: PRICE_DECIMALS_MESSAGE };

  const match = PRICE_PATTERN.exec(value);
  if (!match) return { ok: false, error: PRICE_INVALID_MESSAGE };

  const [, euros, decimals = ''] = match;
  const cents = Number(euros) * 100 + Number(decimals.padEnd(2, '0'));
  if (cents <= 0) return { ok: false, error: PRICE_NOT_POSITIVE_MESSAGE };
  if (cents > PRICE_MAX_CENTS) return { ok: false, error: PRICE_TOO_HIGH_MESSAGE };
  return { ok: true, value: cents };
}

/** Prix facultatif : absent ou vide → null (livre sans prix), sinon validatePrice. */
export function validateOptionalPrice(raw: unknown): Validation<number | null> {
  if (isBlank(raw)) return { ok: true, value: null };
  return validatePrice(raw);
}

/** Stock de vente : entier de 0 à SALE_STOCK_MAX ; absent ou vide → 0. */
export function validateSaleStock(raw: unknown): Validation<number> {
  if (isBlank(raw)) return { ok: true, value: 0 };
  if (typeof raw !== 'string') return { ok: false, error: SALE_STOCK_INVALID_MESSAGE };

  const value = raw.trim();
  if (NEGATIVE_NUMBER.test(value)) return { ok: false, error: SALE_STOCK_NEGATIVE_MESSAGE };
  if (!STOCK_PATTERN.test(value)) return { ok: false, error: SALE_STOCK_INVALID_MESSAGE };

  const stock = Number(value);
  if (stock > SALE_STOCK_MAX) return { ok: false, error: SALE_STOCK_TOO_HIGH_MESSAGE };
  return { ok: true, value: stock };
}

/**
 * Titre et auteur sans espaces autour, de 1 à 200 caractères chacun ; prix
 * facultatif et stock de vente initial facultatif (0 par défaut).
 */
export function validateBook(input: BookInput): BookValidation {
  const title = validateBookText('title', input.title);
  const author = validateBookText('author', input.author);
  const price = validateOptionalPrice(input.price);
  const saleStock = validateSaleStock(input.saleStock);

  if (title.ok && author.ok && price.ok && saleStock.ok) {
    return {
      ok: true,
      value: {
        title: title.value,
        author: author.value,
        priceCents: price.value,
        saleStock: saleStock.value
      }
    };
  }

  const errors: BookFieldErrors = {};
  if (!title.ok) errors.title = title.error;
  if (!author.ok) errors.author = author.error;
  if (!price.ok) errors.price = price.error;
  if (!saleStock.ok) errors.saleStock = saleStock.error;
  return { ok: false, errors };
}

/**
 * Ajoute l'exemplaire unique d'un titre ; il est aussitôt « Disponible » au
 * prêt. Le prix et le stock de vente initial sont facultatifs.
 */
export function addBook(db: Db, input: BookInput): BookCreationResult {
  const validation = validateBook(input);
  if (!validation.ok) return validation;

  const book = validation.value;
  const result = db
    .prepare('INSERT INTO books (title, author, price_cents, sale_stock) VALUES (?, ?, ?, ?)')
    .run(book.title, book.author, book.priceCents, book.saleStock);
  return { ok: true, book: { id: Number(result.lastInsertRowid), ...book } };
}
