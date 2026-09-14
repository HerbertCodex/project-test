import { fail } from '@sveltejs/kit';
import { addBook, requireBookseller } from '$lib/server/catalogue';
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

    const result = addBook(getDb(), { title, author });
    if (!result.ok) {
      return fail(400, { title: textValue(title), author: textValue(author), errors: result.errors });
    }

    return { added: { title: result.book.title, author: result.book.author } };
  }
};
