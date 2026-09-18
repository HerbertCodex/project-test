import { error, fail } from '@sveltejs/kit';
import {
  BOOKSELLER_ONLY_MESSAGE,
  formatPrice,
  formatPriceInput,
  requireBookseller
} from '$lib/server/catalogue';
import { getDb } from '$lib/server/db';
import { BOOK_NOT_FOUND_MESSAGE, parseRecordId } from '$lib/server/loans';
import { parsePageParam } from '$lib/server/pagination';
import {
  listSaleCounter,
  recordSale,
  removeBookPrice,
  restockBook,
  setBookPrice,
  type SalesFailure,
  type SalesField
} from '$lib/server/sales';
import type { Actions, PageServerLoad } from './$types';

const PRICE_BLANK_MESSAGE = 'Saisissez un prix, ou utilisez « Retirer le prix ».';
const PRICE_INTENT_MESSAGE = 'Action sur le prix inconnue.';

type CounterAction = 'prix' | 'vendre' | 'reassortir';

/** Erreur rattachée à la ligne et au champ fautifs, avec la valeur saisie réaffichée. */
type CounterError = {
  action: CounterAction;
  bookId: number | null;
  field: SalesField | null;
  message: string;
  value: string;
};

function textValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function failureStatus(reason: string): 400 | 404 | 409 {
  if (reason === 'invalid') return 400;
  if (reason === 'not-found') return 404;
  return 409;
}

function counterFailure(
  action: CounterAction,
  bookId: number | null,
  value: string,
  failure: SalesFailure<string>
) {
  if (failure.reason === 'forbidden') error(403, BOOKSELLER_ONLY_MESSAGE);
  const counterError: CounterError = {
    action,
    // Un livre introuvable n'a pas de ligne à marquer.
    bookId: failure.reason === 'not-found' ? null : bookId,
    field: failure.field ?? null,
    message: failure.message,
    value
  };
  return fail(failureStatus(failure.reason), { counterError });
}

function invalidBookId(action: CounterAction) {
  const counterError: CounterError = {
    action,
    bookId: null,
    field: 'bookId',
    message: BOOK_NOT_FOUND_MESSAGE,
    value: ''
  };
  return fail(400, { counterError });
}

/**
 * Une page des livres du comptoir, avec ou sans prix, et leur stock chiffré
 * (réservé au libraire). `page` est bornée silencieusement : jamais d'erreur
 * pour une valeur invalide ou hors bornes.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  requireBookseller(locals.user);
  const page = parsePageParam(url?.searchParams.get('page') ?? null);
  const counter = listSaleCounter(getDb(), page);
  const books = counter.items.map((book) => ({
    ...book,
    priceLabel: book.priceCents === null ? null : formatPrice(book.priceCents),
    priceInput: book.priceCents === null ? '' : formatPriceInput(book.priceCents)
  }));
  return {
    books,
    page: counter.page,
    pageSize: counter.pageSize,
    totalItems: counter.totalItems,
    totalPages: counter.totalPages
  };
};

export const actions: Actions = {
  prix: async ({ request, locals }) => {
    // Le layout /libraire ne protège pas les actions : contrôle avant toute lecture.
    requireBookseller(locals.user);

    const form = await request.formData();
    const rawBookId = form.get('bookId');
    const bookId = parseRecordId(rawBookId);
    if (bookId === null) return invalidBookId('prix');

    const intent = form.get('intent');
    const price = form.get('price');
    const value = textValue(price);

    if (intent === 'retirer') {
      const result = removeBookPrice(getDb(), { bookId: rawBookId });
      if (!result.ok) return counterFailure('prix', bookId, value, result);
      return { priced: { bookId, title: result.book.title, priceLabel: null } };
    }
    if (intent !== 'fixer') {
      const counterError: CounterError = {
        action: 'prix',
        bookId,
        field: null,
        message: PRICE_INTENT_MESSAGE,
        value
      };
      return fail(400, { counterError });
    }
    if (value === '') {
      const counterError: CounterError = {
        action: 'prix',
        bookId,
        field: 'price',
        message: PRICE_BLANK_MESSAGE,
        value
      };
      return fail(400, { counterError });
    }

    const result = setBookPrice(getDb(), { bookId: rawBookId, price });
    if (!result.ok) return counterFailure('prix', bookId, value, result);
    const priceLabel = result.book.priceCents === null ? null : formatPrice(result.book.priceCents);
    return { priced: { bookId, title: result.book.title, priceLabel } };
  },

  vendre: async ({ request, locals }) => {
    // Enregistreur lu de la session, jamais du formulaire.
    const bookseller = requireBookseller(locals.user);

    const form = await request.formData();
    const rawBookId = form.get('bookId');
    const bookId = parseRecordId(rawBookId);
    if (bookId === null) return invalidBookId('vendre');

    // Seuls le livre et la quantité sont lus : le prix vient de la base.
    const quantity = form.get('quantity');
    const result = recordSale(getDb(), bookseller, { bookId: rawBookId, quantity });
    if (!result.ok) return counterFailure('vendre', bookId, textValue(quantity), result);

    const { sale } = result;
    return {
      sold: {
        bookId,
        title: sale.title,
        quantity: sale.quantity,
        totalLabel: formatPrice(sale.totalCents),
        remainingStock: sale.remainingStock
      }
    };
  },

  reassortir: async ({ request, locals }) => {
    requireBookseller(locals.user);

    const form = await request.formData();
    const rawBookId = form.get('bookId');
    const bookId = parseRecordId(rawBookId);
    if (bookId === null) return invalidBookId('reassortir');

    const quantity = form.get('quantity');
    const result = restockBook(getDb(), { bookId: rawBookId, quantity });
    if (!result.ok) return counterFailure('reassortir', bookId, textValue(quantity), result);

    return {
      restocked: { bookId, title: result.book.title, saleStock: result.book.saleStock }
    };
  }
};
