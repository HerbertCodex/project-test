/**
 * Vente au comptoir, réassort et prix des livres, réservés au libraire.
 *
 * Toutes les fonctions reçoivent la base en paramètre, et une horloge
 * injectable là où la date du jour compte. Le SQL passe exclusivement par des
 * requêtes préparées à paramètres liés. Le contrôle de rôle des écrans est fait
 * par l'appelant (requireBookseller) ; le stock de vente est indépendant de
 * l'exemplaire de prêt et ne touche jamais à la table loans.
 */
import type { AuthUser, Validation } from '../auth';
import {
  BOOKSELLER_ONLY_MESSAGE,
  ensureFoldFunction,
  FOLD_FUNCTION,
  NEGATIVE_NUMBER,
  PRICE_NOT_POSITIVE_MESSAGE,
  SALE_STOCK_MAX,
  SALE_STOCK_TOO_HIGH_MESSAGE,
  formatInteger,
  validatePrice,
  type BookSaleStatus
} from '../catalogue';
import { systemClock, todayInParis, type Clock } from '../dates';
import type { Db } from '../db';
import { BOOK_NOT_FOUND_MESSAGE, parseRecordId } from '../loans';
import { DEFAULT_PAGE_SIZE, pageWindow } from '../pagination';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Borne technique d'une vente ou d'un réassort : de 1 à 1 000 exemplaires. */
export const SALE_QUANTITY_MIN = 1;
export const SALE_QUANTITY_MAX = 1_000;

export const QUANTITY_INVALID_MESSAGE =
  'Saisissez une quantité en nombre entier d’exemplaires, par exemple 1.';
export const QUANTITY_TOO_LOW_MESSAGE = `La quantité doit être d’au moins ${SALE_QUANTITY_MIN} exemplaire.`;
export const QUANTITY_TOO_HIGH_MESSAGE = `La quantité ne doit pas dépasser ${formatInteger(SALE_QUANTITY_MAX)} exemplaires.`;

const QUANTITY_PATTERN = /^\d+$/;

/** Quantité saisie : entier de SALE_QUANTITY_MIN à SALE_QUANTITY_MAX. */
export function validateQuantity(raw: unknown): Validation<number> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: QUANTITY_INVALID_MESSAGE };
  }
  const value = raw.trim();
  if (NEGATIVE_NUMBER.test(value)) return { ok: false, error: QUANTITY_TOO_LOW_MESSAGE };
  if (!QUANTITY_PATTERN.test(value)) return { ok: false, error: QUANTITY_INVALID_MESSAGE };

  // Un nombre démesuré devient Infinity et échoue à la borne haute.
  const quantity = Number(value);
  if (quantity < SALE_QUANTITY_MIN) return { ok: false, error: QUANTITY_TOO_LOW_MESSAGE };
  if (quantity > SALE_QUANTITY_MAX) return { ok: false, error: QUANTITY_TOO_HIGH_MESSAGE };
  return { ok: true, value: quantity };
}

/** Champ du formulaire en cause dans un refus de validation. */
export type SalesField = 'bookId' | 'quantity' | 'price';

/**
 * Refus discriminé : `invalid` (400) pour une saisie refusée avant toute
 * requête, `not-found` (404), les autres raisons (409) pour un état de la base
 * qui ne permet pas l'opération. Le message est affichable tel quel.
 */
export type SalesFailure<Reason extends string> = {
  ok: false;
  reason: Reason;
  message: string;
  field?: SalesField;
};

function invalid(field: SalesField, message: string): SalesFailure<'invalid'> {
  return { ok: false, reason: 'invalid', field, message };
}

const NOT_FOUND: SalesFailure<'not-found'> = {
  ok: false,
  reason: 'not-found',
  message: BOOK_NOT_FOUND_MESSAGE
};

function isCheckViolation(thrown: unknown): boolean {
  return (
    thrown instanceof Error &&
    'code' in thrown &&
    (thrown as { code: unknown }).code === 'SQLITE_CONSTRAINT_CHECK'
  );
}

type SaleBookRow = { title: string; price_cents: number | null; sale_stock: number };

function findSaleBook(db: Db, bookId: number): SaleBookRow | undefined {
  return db
    .prepare('SELECT title, price_cents, sale_stock FROM books WHERE id = ?')
    .get(bookId) as SaleBookRow | undefined;
}

// ---------------------------------------------------------------------------
// Liste du comptoir
// ---------------------------------------------------------------------------

/** Ligne de l'écran de vente : contrairement au catalogue public, le stock chiffré y figure. */
export type SaleCounterEntry = {
  id: number;
  title: string;
  author: string;
  priceCents: number | null;
  saleStock: number;
  saleStatus: BookSaleStatus;
};

type SaleCounterRow = {
  id: number;
  title: string;
  author: string;
  price_cents: number | null;
  sale_stock: number;
};

/**
 * Page du comptoir de vente : les lignes de la page demandée et le total réel,
 * ainsi que les deux comptes affichés en tête d'écran (toutes pages confondues).
 */
export type SaleCounterPage = {
  items: SaleCounterEntry[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onSaleCount: number;
  noPriceCount: number;
};

/**
 * Page de livres du comptoir de vente, triée en SQL par titre puis auteur
 * (pliage partagé avec le catalogue), puis identifiant pour un ordre total et
 * stable entre deux pages. `page` est bornée silencieusement au total réel.
 */
export function listSaleCounter(db: Db, page = 1): SaleCounterPage {
  ensureFoldFunction(db);

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM books').get() as { count: number };
  const { onSaleCount, noPriceCount } = db
    .prepare(
      `SELECT
         SUM(CASE WHEN price_cents IS NOT NULL AND sale_stock > 0 THEN 1 ELSE 0 END) AS onSaleCount,
         SUM(CASE WHEN price_cents IS NULL THEN 1 ELSE 0 END) AS noPriceCount
       FROM books`
    )
    .get() as { onSaleCount: number | null; noPriceCount: number | null };
  const { page: clampedPage, totalPages, offset } = pageWindow(page, count);

  const rows = db
    .prepare(
      `SELECT id, title, author, price_cents, sale_stock FROM books
       ORDER BY ${FOLD_FUNCTION}(title), ${FOLD_FUNCTION}(author), id
       LIMIT ? OFFSET ?`
    )
    .all(DEFAULT_PAGE_SIZE, offset) as SaleCounterRow[];

  const items = rows.map(
    (row): SaleCounterEntry => ({
      id: row.id,
      title: row.title,
      author: row.author,
      priceCents: row.price_cents,
      saleStock: row.sale_stock,
      saleStatus: row.price_cents !== null && row.sale_stock > 0 ? 'on-sale' : 'sold-out'
    })
  );

  return {
    items,
    page: clampedPage,
    pageSize: DEFAULT_PAGE_SIZE,
    totalItems: count,
    totalPages,
    onSaleCount: onSaleCount ?? 0,
    noPriceCount: noPriceCount ?? 0
  };
}

// ---------------------------------------------------------------------------
// Vente
// ---------------------------------------------------------------------------

export const SALE_NO_PRICE_MESSAGE = 'Ce livre n’a pas de prix : fixez-en un avant de le vendre.';
/** Message rattaché au champ quantité, avec le stock encore disponible (réservé au libraire). */
export function saleInsufficientStockMessage(available: number): string {
  const count = formatInteger(available);
  return available > 1
    ? `Stock insuffisant : ${count} exemplaires disponibles.`
    : `Stock insuffisant : ${count} exemplaire disponible.`;
}

/**
 * Valeurs brutes du formulaire de vente. Seuls le livre et la quantité sont
 * lus : un prix, un total, un rôle ou un auteur envoyés sont ignorés.
 */
export type SaleInput = { bookId: unknown; quantity: unknown };

export type RecordedSale = {
  id: number;
  bookId: number;
  title: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  soldOn: string;
  remainingStock: number;
};

export type SaleResult =
  | { ok: true; sale: RecordedSale }
  | SalesFailure<'invalid' | 'not-found' | 'no-price' | 'insufficient-stock' | 'forbidden'>;

const NO_PRICE: SalesFailure<'no-price'> = {
  ok: false,
  reason: 'no-price',
  message: SALE_NO_PRICE_MESSAGE
};

function insufficientStock(available: number): SalesFailure<'insufficient-stock'> {
  return {
    ok: false,
    reason: 'insufficient-stock',
    field: 'quantity',
    message: saleInsufficientStockMessage(available)
  };
}

/**
 * Enregistre la vente d'une quantité d'un livre à la date du jour (Paris).
 * Dans une transaction immediate : relecture du livre, décrément conditionnel
 * du stock puis écriture de la vente avec le prix unitaire lu en base. La
 * contrainte CHECK sale_stock >= 0 reste l'arbitre final. Le rôle libraire de
 * l'enregistreur est revérifié en base.
 */
export function recordSale(
  db: Db,
  bookseller: AuthUser,
  input: SaleInput,
  clock: Clock = systemClock
): SaleResult {
  const bookId = parseRecordId(input.bookId);
  if (bookId === null) return invalid('bookId', BOOK_NOT_FOUND_MESSAGE);
  const validQuantity = validateQuantity(input.quantity);
  if (!validQuantity.ok) return invalid('quantity', validQuantity.error);
  const quantity = validQuantity.value;

  const soldOn = todayInParis(clock);

  const attempt = db.transaction((): SaleResult => {
    const seller = db
      .prepare("SELECT 1 FROM users WHERE id = ? AND role = 'bookseller'")
      .get(bookseller.id);
    if (!seller) return { ok: false, reason: 'forbidden', message: BOOKSELLER_ONLY_MESSAGE };

    const book = findSaleBook(db, bookId);
    if (!book) return NOT_FOUND;
    if (book.price_cents === null) return NO_PRICE;
    if (book.sale_stock < quantity) return insufficientStock(book.sale_stock);

    const decremented = db
      .prepare('UPDATE books SET sale_stock = sale_stock - ? WHERE id = ? AND sale_stock >= ?')
      .run(quantity, bookId, quantity);
    if (decremented.changes === 0) {
      return insufficientStock(findSaleBook(db, bookId)?.sale_stock ?? 0);
    }

    const unitPriceCents = book.price_cents;
    const totalCents = unitPriceCents * quantity;
    const inserted = db
      .prepare(
        `INSERT INTO sales (book_id, bookseller_id, quantity, unit_price_cents, total_cents, sold_on)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(bookId, bookseller.id, quantity, unitPriceCents, totalCents, soldOn);

    return {
      ok: true,
      sale: {
        id: Number(inserted.lastInsertRowid),
        bookId,
        title: book.title,
        quantity,
        unitPriceCents,
        totalCents,
        soldOn,
        remainingStock: book.sale_stock - quantity
      }
    };
  });

  try {
    return attempt.immediate();
  } catch (thrown) {
    if (isCheckViolation(thrown)) {
      return insufficientStock(findSaleBook(db, bookId)?.sale_stock ?? 0);
    }
    throw thrown;
  }
}

// ---------------------------------------------------------------------------
// Réassort
// ---------------------------------------------------------------------------

/** Valeurs brutes du formulaire de réassort. */
export type RestockInput = { bookId: unknown; quantity: unknown };

export type RestockedBook = { bookId: number; title: string; saleStock: number };

export type RestockResult =
  | { ok: true; book: RestockedBook }
  | SalesFailure<'invalid' | 'not-found' | 'stock-limit'>;

/**
 * Ajoute une quantité bornée au stock de vente d'un livre, sans dépasser
 * SALE_STOCK_MAX. Un échec ne modifie aucun stock.
 */
export function restockBook(db: Db, input: RestockInput): RestockResult {
  const bookId = parseRecordId(input.bookId);
  if (bookId === null) return invalid('bookId', BOOK_NOT_FOUND_MESSAGE);
  const validQuantity = validateQuantity(input.quantity);
  if (!validQuantity.ok) return invalid('quantity', validQuantity.error);
  const quantity = validQuantity.value;

  return db
    .transaction((): RestockResult => {
      const book = findSaleBook(db, bookId);
      if (!book) return NOT_FOUND;

      const updated = db
        .prepare('UPDATE books SET sale_stock = sale_stock + ? WHERE id = ? AND sale_stock + ? <= ?')
        .run(quantity, bookId, quantity, SALE_STOCK_MAX);
      if (updated.changes === 0) {
        return {
          ok: false,
          reason: 'stock-limit',
          field: 'quantity',
          message: SALE_STOCK_TOO_HIGH_MESSAGE
        };
      }

      return {
        ok: true,
        book: { bookId, title: book.title, saleStock: book.sale_stock + quantity }
      };
    })
    .immediate();
}

// ---------------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------------

/** Valeurs brutes du formulaire de prix ; le prix suit la validation du catalogue. */
export type PriceInput = { bookId: unknown; price: unknown };

export type PricedBook = { bookId: number; title: string; priceCents: number | null };

export type PriceResult = { ok: true; book: PricedBook } | SalesFailure<'invalid' | 'not-found'>;

function updatePrice(db: Db, bookId: number, priceCents: number | null): PriceResult {
  return db
    .transaction((): PriceResult => {
      const book = findSaleBook(db, bookId);
      if (!book) return NOT_FOUND;
      // Seul le prix change : ni le stock, ni les ventes passées (prix figé), ni les prêts.
      db.prepare('UPDATE books SET price_cents = ? WHERE id = ?').run(priceCents, bookId);
      return { ok: true, book: { bookId, title: book.title, priceCents } };
    })
    .immediate();
}

/**
 * Fixe ou modifie le prix de n'importe quel livre, y compris un livre sans
 * prix. Un prix invalide ne modifie rien.
 */
export function setBookPrice(db: Db, input: PriceInput): PriceResult {
  const bookId = parseRecordId(input.bookId);
  if (bookId === null) return invalid('bookId', BOOK_NOT_FOUND_MESSAGE);
  const price = validatePrice(input.price);
  if (!price.ok) return invalid('price', price.error);

  try {
    return updatePrice(db, bookId, price.value);
  } catch (thrown) {
    // Arbitre final : CHECK price_cents > 0.
    if (isCheckViolation(thrown)) return invalid('price', PRICE_NOT_POSITIVE_MESSAGE);
    throw thrown;
  }
}

/**
 * Retire le prix d'un livre (prix nul) : il devient « Épuisé » au catalogue
 * public ; son stock et les ventes déjà enregistrées sont inchangés.
 */
export function removeBookPrice(db: Db, input: { bookId: unknown }): PriceResult {
  const bookId = parseRecordId(input.bookId);
  if (bookId === null) return invalid('bookId', BOOK_NOT_FOUND_MESSAGE);
  return updatePrice(db, bookId, null);
}
