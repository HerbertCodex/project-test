import { fail } from '@sveltejs/kit';
import { addBook, formatPrice, requireBookseller } from '$lib/server/catalogue';
import { getDb } from '$lib/server/db';
import type { Actions } from './$types';

function textValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const actions: Actions = {
  default: async ({ request, locals }) => {
    // Le layout /libraire ne protège pas les actions : contrôle avant toute lecture.
    requireBookseller(locals.user);

    const form = await request.formData();
    const title = form.get('title');
    const author = form.get('author');
    const price = form.get('price');
    const saleStock = form.get('saleStock');

    const result = addBook(getDb(), { title, author, price, saleStock });
    if (!result.ok) {
      return fail(400, {
        title: textValue(title),
        author: textValue(author),
        price: textValue(price),
        saleStock: textValue(saleStock),
        errors: result.errors
      });
    }

    const { book } = result;
    return {
      added: {
        title: book.title,
        author: book.author,
        priceLabel: book.priceCents === null ? null : formatPrice(book.priceCents),
        saleStock: book.saleStock
      }
    };
  }
};
