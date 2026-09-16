import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '$lib/server/auth';
import {
  BOOKSELLER_ONLY_MESSAGE,
  PRICE_DECIMALS_MESSAGE,
  PRICE_INVALID_MESSAGE,
  PRICE_NOT_POSITIVE_MESSAGE,
  PRICE_TOO_HIGH_MESSAGE,
  SALE_STOCK_TOO_HIGH_MESSAGE,
  addBook,
  listCatalogue
} from '$lib/server/catalogue';
import { closeDb, getDb } from '$lib/server/db';
import { BOOK_NOT_FOUND_MESSAGE, BORROWER_ONLY_MESSAGE } from '$lib/server/loans';
import {
  QUANTITY_INVALID_MESSAGE,
  QUANTITY_TOO_HIGH_MESSAGE,
  QUANTITY_TOO_LOW_MESSAGE,
  SALE_INSUFFICIENT_STOCK_MESSAGE,
  SALE_NO_PRICE_MESSAGE
} from '$lib/server/sales';
import { actions as catalogueActions } from '../../+page.server';
import { load as myLoansLoad } from '../../mes-prets/+page.server';
import { actions, load } from './+page.server';
import SalePage from './+page.svelte';

type ActionName = 'prix' | 'vendre' | 'reassortir';
type CounterBook = {
  id: number;
  title: string;
  author: string;
  priceCents: number | null;
  saleStock: number;
  saleStatus: 'on-sale' | 'sold-out';
  priceLabel: string | null;
  priceInput: string;
};
type CounterError = {
  action: ActionName;
  bookId: number | null;
  field: string | null;
  message: string;
  value: string;
};

const HOSTILE_TITLE = '<script>alert(1)</script>';

function insertUser(email: string, role: Role): AuthUser {
  const displayName = `Compte ${role}`;
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, 'hash-factice', ?, 0)`
    )
    .run(email, displayName, role);
  return { id: Number(result.lastInsertRowid), email, displayName, role };
}

function bookseller(): AuthUser {
  return insertUser('libraire@example.fr', 'bookseller');
}

function borrower(): AuthUser {
  return insertUser('lecteur@example.fr', 'borrower');
}

function createBook(
  title: string,
  sale: { price?: string; saleStock?: string } = {},
  author = 'Auteur'
): number {
  const created = addBook(getDb(), { title, author, ...sale });
  if (!created.ok) throw new Error('Livre de test non créé.');
  return created.book.id;
}

type BookState = { price_cents: number | null; sale_stock: number };

function bookState(bookId: number): BookState {
  return getDb()
    .prepare('SELECT price_cents, sale_stock FROM books WHERE id = ?')
    .get(bookId) as BookState;
}

function salesRows() {
  return getDb()
    .prepare(
      'SELECT book_id, bookseller_id, quantity, unit_price_cents, total_cents, sold_on FROM sales ORDER BY id'
    )
    .all();
}

/** Exécute un load ou une action et capture la redirection ou l'erreur HTTP levée. */
async function outcomeOf(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (thrown) {
    if (isRedirect(thrown) || isHttpError(thrown)) return thrown;
    throw thrown;
  }
}

function postAs(
  action: ActionName,
  user: AuthUser | null,
  fields: Record<string, string>
): Promise<unknown> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const url = new URL(`http://localhost/libraire/vente?/${action}`);
  const event = { request: new Request(url, { method: 'POST', body }), url, locals: { user } };
  const run = actions[action] as (event: unknown) => unknown;
  return outcomeOf(() => run(event));
}

function loadAs(user: AuthUser | null, search = ''): Promise<unknown> {
  const url = new URL(`http://localhost/libraire/vente${search}`);
  return outcomeOf(() => load({ url, locals: { user } } as unknown as Parameters<typeof load>[0]));
}

async function counterBooks(user: AuthUser): Promise<CounterBook[]> {
  return ((await loadAs(user)) as { books: CounterBook[] }).books;
}

function asFailure(outcome: unknown): { status: number; data: { counterError: CounterError } } {
  if (!isActionFailure(outcome)) throw new Error('Échec d’action attendu.');
  return outcome as unknown as { status: number; data: { counterError: CounterError } };
}

function expectForbidden(outcome: unknown, message = BOOKSELLER_ONLY_MESSAGE) {
  if (!isHttpError(outcome)) throw new Error('Erreur HTTP attendue.');
  expect(outcome.status).toBe(403);
  expect(outcome.body.message).toBe(message);
}

function expectLoginRedirect(outcome: unknown) {
  if (!isRedirect(outcome)) throw new Error('Redirection attendue.');
  expect(outcome.status).toBe(303);
  expect(outcome.location).toBe('/connexion');
}

afterEach(() => {
  vi.useRealTimers();
  closeDb();
});

describe('autorisation de /libraire/vente', () => {
  it('redirige un anonyme et refuse un emprunteur (403) au chargement', async () => {
    createBook('Germinal', { price: '9', saleStock: '137' });
    const reader = borrower();

    expectLoginRedirect(await loadAs(null));
    expectForbidden(await loadAs(reader));
  });

  const writes: [ActionName, Record<string, string>][] = [
    ['vendre', { quantity: '1' }],
    ['reassortir', { quantity: '5' }],
    ['prix', { intent: 'fixer', price: '1,00' }],
    ['prix', { intent: 'retirer' }]
  ];

  for (const [action, fields] of writes) {
    it(`POST direct ?/${action} (${fields.intent ?? action}) : anonyme redirigé, emprunteur 403, rien d’écrit`, async () => {
      const bookId = createBook('Germinal', { price: '9', saleStock: '3' });
      const reader = borrower();
      const before = bookState(bookId);
      const post = { bookId: String(bookId), ...fields };

      expectLoginRedirect(await postAs(action, null, post));
      expectForbidden(await postAs(action, reader, post));
      expectForbidden(await postAs(action, reader, { ...post, role: 'bookseller' }));

      expect(bookState(bookId)).toEqual(before);
      expect(salesRows()).toEqual([]);
    });
  }

  it('refuse une session au rôle périmé : vente 403, stock inchangé', async () => {
    const bookId = createBook('Germinal', { price: '9', saleStock: '3' });
    const former = insertUser('ancien@example.fr', 'borrower');

    // Session encore marquée libraire alors que le compte ne l'est plus.
    const outcome = await postAs('vendre', { ...former, role: 'bookseller' }, {
      bookId: String(bookId),
      quantity: '1'
    });

    expectForbidden(outcome);
    expect(bookState(bookId).sale_stock).toBe(3);
    expect(salesRows()).toEqual([]);
  });

  it('ignore les champs role, userId et booksellerId : la vente est attribuée au libraire de session', async () => {
    const seller = bookseller();
    const other = insertUser('autre@example.fr', 'bookseller');
    const reader = borrower();
    const bookId = createBook('Germinal', { price: '9', saleStock: '3' });

    await postAs('vendre', seller, {
      bookId: String(bookId),
      quantity: '1',
      role: 'borrower',
      userId: String(reader.id),
      booksellerId: String(other.id)
    });

    expect(salesRows()).toEqual([expect.objectContaining({ bookseller_id: seller.id })]);
    const roles = getDb().prepare('SELECT id, role FROM users ORDER BY id').all();
    expect(roles).toEqual([
      { id: seller.id, role: 'bookseller' },
      { id: other.id, role: 'bookseller' },
      { id: reader.id, role: 'borrower' }
    ]);
  });

  it('le libraire n’emprunte pas et l’emprunteur ne vend pas', async () => {
    const seller = bookseller();
    const reader = borrower();
    const bookId = createBook('Germinal', { price: '9', saleStock: '3' });

    const borrowEvent = {
      request: new Request('http://localhost/?/emprunter', {
        method: 'POST',
        body: new URLSearchParams({ bookId: String(bookId) })
      }),
      url: new URL('http://localhost/?/emprunter'),
      locals: { user: seller }
    };
    const borrowRun = catalogueActions.emprunter as (event: unknown) => unknown;
    expectForbidden(await outcomeOf(() => borrowRun(borrowEvent)), BORROWER_ONLY_MESSAGE);
    const myLoansEvent = { url: new URL('http://localhost/mes-prets'), locals: { user: seller } };
    expectForbidden(
      await outcomeOf(() => myLoansLoad(myLoansEvent as unknown as Parameters<typeof myLoansLoad>[0])),
      BORROWER_ONLY_MESSAGE
    );
    expectForbidden(await postAs('vendre', reader, { bookId: String(bookId), quantity: '1' }));
    expect(salesRows()).toEqual([]);
  });

  it('un GET avec des paramètres de vente ou de prix ne modifie rien', async () => {
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '9', saleStock: '3' });

    await loadAs(seller, `?/vendre&bookId=${bookId}&quantity=2&price=0,01&intent=retirer`);

    expect(bookState(bookId)).toEqual({ price_cents: 900, sale_stock: 3 });
    expect(salesRows()).toEqual([]);
  });
});

describe('load /libraire/vente', () => {
  it('liste tous les livres, avec ou sans prix, et leur stock chiffré', async () => {
    const seller = bookseller();
    const onSale = createBook('Germinal', { price: '12,50', saleStock: '137' });
    const soldOut = createBook('Candide', { price: '5', saleStock: '0' });
    // Livre ajouté avant l'incrément 2 : ni prix ni stock.
    const legacy = createBook('Nana');

    const books = await counterBooks(seller);

    expect(books.map((book) => book.id)).toEqual([soldOut, onSale, legacy]);
    expect(books[1]).toEqual({
      id: onSale,
      title: 'Germinal',
      author: 'Auteur',
      priceCents: 1250,
      saleStock: 137,
      saleStatus: 'on-sale',
      priceLabel: expect.stringMatching(/^12,50\s€$/),
      priceInput: '12,50'
    });
    expect(books[2]).toMatchObject({
      priceCents: null,
      saleStock: 0,
      saleStatus: 'sold-out',
      priceLabel: null,
      priceInput: ''
    });
  });

  it('rend le stock chiffré, les formulaires étiquetés par ligne et un titre hostile comme texte', async () => {
    const seller = bookseller();
    createBook(HOSTILE_TITLE, { price: '12,50', saleStock: '137' }, '<img src=x onerror=alert(1)>');
    createBook('Nana');
    const books = await counterBooks(seller);

    const { body } = render(SalePage, {
      props: { data: { books, user: { displayName: 'Libraire', role: 'bookseller' } }, form: null } as never
    });

    expect(body).toContain('Vente au comptoir');
    // La classe peut porter en plus le suffixe de portée de Svelte.
    expect(body).toMatch(/class="ledger__stock[^"]*"[^>]*>137</);
    expect(body).not.toContain('<script');
    expect(body).not.toContain('<img');
    expect(body).toMatch(/&lt;script(>|&gt;)alert\(1\)&lt;\/script(>|&gt;)/);
    for (const book of books) {
      expect(body).toContain(`for="prix-${book.id}"`);
      expect(body).toContain(`id="prix-${book.id}"`);
      expect(body).toContain(`for="qte-stock-${book.id}"`);
    }
    const hostileId = books.find((book) => book.priceCents !== null)?.id;
    const legacyId = books.find((book) => book.priceCents === null)?.id;
    expect(body).toContain(`for="qte-vente-${hostileId}"`);
    expect(body).not.toContain(`for="qte-vente-${legacyId}"`);
    expect(body).toContain('Fixez un prix pour le vendre.');
    expect(body).toContain('value="retirer"');
    expect(body).toContain('action="?/prix"');
    expect(body).toContain('action="?/vendre"');
    expect(body).toContain('action="?/reassortir"');
  });

  it('affiche l’état vide, une erreur rattachée au champ et une saisie hostile échappée', () => {
    const empty = render(SalePage, {
      props: { data: { books: [], user: null }, form: null } as never
    });
    expect(empty.body).toMatch(/class="empty[\s"]/);
    expect(empty.body).toContain('Aucun livre au catalogue.');

    const book: CounterBook = {
      id: 7,
      title: 'Les Fourmis',
      author: 'Bernard Werber',
      priceCents: 1190,
      saleStock: 1,
      saleStatus: 'on-sale',
      priceLabel: '11,90 €',
      priceInput: '11,90'
    };
    const flagged = render(SalePage, {
      props: {
        data: { books: [book], user: null },
        form: {
          counterError: {
            action: 'prix',
            bookId: 7,
            field: 'price',
            message: PRICE_DECIMALS_MESSAGE,
            value: '"><script>x</script>'
          }
        }
      } as never
    });
    expect(flagged.body).toContain('notice--error');
    expect(flagged.body).toContain('aria-invalid="true"');
    expect(flagged.body).toContain('aria-describedby="prix-7-err"');
    expect(flagged.body).not.toContain('<script');

    const done = render(SalePage, {
      props: {
        data: { books: [book], user: null },
        form: {
          sold: { bookId: 7, title: 'Les Fourmis', quantity: 2, totalLabel: '23,80 €', remainingStock: 3 }
        }
      } as never
    });
    expect(done.body).toContain('notice--success');
    expect(done.body).toContain('Stock restant : 3.');
  });
});

describe('action ?/vendre', () => {
  it('enregistre la vente au prix lu en base, à la date de Paris, et décrémente le stock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-31T22:30:00Z'));
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '12,50', saleStock: '5' });

    const outcome = await postAs('vendre', seller, {
      bookId: String(bookId),
      quantity: '2',
      price: '0,01',
      unitPriceCents: '1',
      totalCents: '1'
    });

    expect(outcome).toEqual({
      sold: {
        bookId,
        title: 'Germinal',
        quantity: 2,
        totalLabel: expect.stringMatching(/^25,00\s€$/),
        remainingStock: 3
      }
    });
    expect(bookState(bookId)).toEqual({ price_cents: 1250, sale_stock: 3 });
    expect(salesRows()).toEqual([
      {
        book_id: bookId,
        bookseller_id: seller.id,
        quantity: 2,
        unit_price_cents: 1250,
        total_cents: 2500,
        sold_on: '2026-04-01'
      }
    ]);
  });

  it('deux ventes successives du dernier exemplaire : la seconde répond 409, stock 0', async () => {
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '9', saleStock: '1' });

    await postAs('vendre', seller, { bookId: String(bookId), quantity: '1' });
    const second = asFailure(await postAs('vendre', seller, { bookId: String(bookId), quantity: '1' }));

    expect(second.status).toBe(409);
    expect(second.data.counterError.message).toBe(SALE_INSUFFICIENT_STOCK_MESSAGE);
    expect(bookState(bookId).sale_stock).toBe(0);
    expect(salesRows()).toHaveLength(1);
  });

  it('répond 409 pour un stock insuffisant et réaffiche la quantité saisie', async () => {
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '9', saleStock: '1' });

    const failure = asFailure(await postAs('vendre', seller, { bookId: String(bookId), quantity: '3' }));

    expect(failure.status).toBe(409);
    expect(failure.data.counterError).toEqual({
      action: 'vendre',
      bookId,
      field: null,
      message: SALE_INSUFFICIENT_STOCK_MESSAGE,
      value: '3'
    });
    expect(bookState(bookId).sale_stock).toBe(1);
  });

  it('répond 409 pour un livre sans prix', async () => {
    const seller = bookseller();
    const bookId = createBook('Nana', { saleStock: '4' });

    const failure = asFailure(await postAs('vendre', seller, { bookId: String(bookId), quantity: '1' }));

    expect(failure.status).toBe(409);
    expect(failure.data.counterError.message).toBe(SALE_NO_PRICE_MESSAGE);
    expect(bookState(bookId).sale_stock).toBe(4);
    expect(salesRows()).toEqual([]);
  });

  it('répond 404 pour un livre inexistant', async () => {
    const seller = bookseller();
    createBook('Germinal', { price: '9', saleStock: '1' });

    const failure = asFailure(await postAs('vendre', seller, { bookId: '424242', quantity: '1' }));

    expect(failure.status).toBe(404);
    expect(failure.data.counterError).toMatchObject({ bookId: null, message: BOOK_NOT_FOUND_MESSAGE });
    expect(salesRows()).toEqual([]);
  });

  const badQuantities: [string, string][] = [
    ['0', QUANTITY_TOO_LOW_MESSAGE],
    ['-2', QUANTITY_TOO_LOW_MESSAGE],
    ['1,5', QUANTITY_INVALID_MESSAGE],
    ['deux', QUANTITY_INVALID_MESSAGE],
    ['', QUANTITY_INVALID_MESSAGE],
    ['1001', QUANTITY_TOO_HIGH_MESSAGE]
  ];

  for (const [quantity, message] of badQuantities) {
    it(`répond 400 pour la quantité « ${quantity} », stock inchangé`, async () => {
      const seller = bookseller();
      const bookId = createBook('Germinal', { price: '9', saleStock: '5' });

      const failure = asFailure(await postAs('vendre', seller, { bookId: String(bookId), quantity }));

      expect(failure.status).toBe(400);
      expect(failure.data.counterError).toMatchObject({
        action: 'vendre',
        bookId,
        field: 'quantity',
        message
      });
      expect(bookState(bookId).sale_stock).toBe(5);
      expect(salesRows()).toEqual([]);
    });
  }

  for (const raw of ['', 'abc', '0', '-1', '1.5', ' 1', '1 OR 1=1', '99999999999999999999']) {
    it(`répond 400 pour l’identifiant mal formé « ${raw} »`, async () => {
      const seller = bookseller();
      const bookId = createBook('Germinal', { price: '9', saleStock: '5' });

      const failure = asFailure(await postAs('vendre', seller, { bookId: raw, quantity: '1' }));

      expect(failure.status).toBe(400);
      expect(failure.data.counterError.message).toBe(BOOK_NOT_FOUND_MESSAGE);
      expect(bookState(bookId).sale_stock).toBe(5);
    });
  }
});

describe('action ?/reassortir', () => {
  it('ajoute la quantité au stock et remet en vente un livre épuisé avec prix', async () => {
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '9', saleStock: '0' });

    const outcome = await postAs('reassortir', seller, { bookId: String(bookId), quantity: '6' });

    expect(outcome).toEqual({ restocked: { bookId, title: 'Germinal', saleStock: 6 } });
    expect(bookState(bookId)).toEqual({ price_cents: 900, sale_stock: 6 });
    expect(listCatalogue(getDb())[0].saleStatus).toBe('on-sale');
  });

  it('réassortit un livre sans prix, qui reste « Épuisé »', async () => {
    const seller = bookseller();
    const bookId = createBook('Nana');

    await postAs('reassortir', seller, { bookId: String(bookId), quantity: '2' });

    expect(bookState(bookId)).toEqual({ price_cents: null, sale_stock: 2 });
    expect(listCatalogue(getDb())[0].saleStatus).toBe('sold-out');
  });

  const badRestocks: [string, string][] = [
    ['0', QUANTITY_TOO_LOW_MESSAGE],
    ['abc', QUANTITY_INVALID_MESSAGE],
    ['1001', QUANTITY_TOO_HIGH_MESSAGE]
  ];

  for (const [quantity, message] of badRestocks) {
    it(`répond 400 pour la quantité « ${quantity} », stock inchangé`, async () => {
      const seller = bookseller();
      const bookId = createBook('Germinal', { price: '9', saleStock: '2' });

      const failure = asFailure(await postAs('reassortir', seller, { bookId: String(bookId), quantity }));

      expect(failure.status).toBe(400);
      expect(failure.data.counterError).toMatchObject({ field: 'quantity', message, value: quantity });
      expect(bookState(bookId).sale_stock).toBe(2);
    });
  }

  it('répond 409 au-delà de 10 000 exemplaires en stock, stock inchangé', async () => {
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '9', saleStock: '9500' });

    const failure = asFailure(await postAs('reassortir', seller, { bookId: String(bookId), quantity: '501' }));

    expect(failure.status).toBe(409);
    expect(failure.data.counterError.message).toBe(SALE_STOCK_TOO_HIGH_MESSAGE);
    expect(bookState(bookId).sale_stock).toBe(9500);
  });

  it('répond 404 pour un livre inexistant et 400 pour un identifiant mal formé', async () => {
    const seller = bookseller();

    expect(asFailure(await postAs('reassortir', seller, { bookId: '424242', quantity: '1' })).status).toBe(404);
    expect(asFailure(await postAs('reassortir', seller, { bookId: 'x', quantity: '1' })).status).toBe(400);
  });
});

describe('action ?/prix', () => {
  it('fixe le prix d’un livre migré sans prix, qui devient vendable', async () => {
    const seller = bookseller();
    const bookId = createBook('Nana', { saleStock: '2' });

    const outcome = await postAs('prix', seller, { bookId: String(bookId), intent: 'fixer', price: '12,50' });

    expect(outcome).toEqual({
      priced: { bookId, title: 'Nana', priceLabel: expect.stringMatching(/^12,50\s€$/) }
    });
    expect(bookState(bookId)).toEqual({ price_cents: 1250, sale_stock: 2 });
    const sale = await postAs('vendre', seller, { bookId: String(bookId), quantity: '1' });
    expect(sale).toMatchObject({ sold: { remainingStock: 1 } });
  });

  it('modifie un prix sans réécrire les ventes passées', async () => {
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '9', saleStock: '3' });
    await postAs('vendre', seller, { bookId: String(bookId), quantity: '1' });

    await postAs('prix', seller, { bookId: String(bookId), intent: 'fixer', price: '11.20' });

    expect(bookState(bookId)).toEqual({ price_cents: 1120, sale_stock: 2 });
    expect(salesRows()).toEqual([expect.objectContaining({ unit_price_cents: 900, total_cents: 900 })]);
  });

  it('retire le prix : prix nul, stock et ventes inchangés, « Épuisé » au catalogue', async () => {
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '9', saleStock: '3' });
    await postAs('vendre', seller, { bookId: String(bookId), quantity: '1' });
    const salesBefore = salesRows();

    const outcome = await postAs('prix', seller, { bookId: String(bookId), intent: 'retirer', price: '15' });

    expect(outcome).toEqual({ priced: { bookId, title: 'Germinal', priceLabel: null } });
    expect(bookState(bookId)).toEqual({ price_cents: null, sale_stock: 2 });
    expect(salesRows()).toEqual(salesBefore);
    expect(listCatalogue(getDb())[0].saleStatus).toBe('sold-out');
  });

  const badPrices: [string, string, string][] = [
    ['négatif', '-3', PRICE_NOT_POSITIVE_MESSAGE],
    ['nul', '0', PRICE_NOT_POSITIVE_MESSAGE],
    ['à trois décimales', '11,905', PRICE_DECIMALS_MESSAGE],
    ['alphabétique', 'douze', PRICE_INVALID_MESSAGE],
    ['au-delà de la borne', '10000,01', PRICE_TOO_HIGH_MESSAGE],
    ['vide', '   ', 'Saisissez un prix, ou utilisez « Retirer le prix ».']
  ];

  for (const [label, price, message] of badPrices) {
    it(`refuse un prix ${label} (400) sans rien modifier`, async () => {
      const seller = bookseller();
      const bookId = createBook('Germinal', { price: '9', saleStock: '3' });

      const failure = asFailure(await postAs('prix', seller, { bookId: String(bookId), intent: 'fixer', price }));

      expect(failure.status).toBe(400);
      expect(failure.data.counterError).toEqual({
        action: 'prix',
        bookId,
        field: 'price',
        message,
        value: price.trim()
      });
      expect(bookState(bookId)).toEqual({ price_cents: 900, sale_stock: 3 });
    });
  }

  it('refuse une intention inconnue ou absente (400) sans rien modifier', async () => {
    const seller = bookseller();
    const bookId = createBook('Germinal', { price: '9', saleStock: '3' });

    for (const fields of [{ intent: 'supprimer' }, {}]) {
      const failure = asFailure(await postAs('prix', seller, { bookId: String(bookId), price: '5', ...fields }));
      expect(failure.status).toBe(400);
    }
    expect(bookState(bookId)).toEqual({ price_cents: 900, sale_stock: 3 });
  });

  it('répond 404 pour un livre inexistant, 400 pour un identifiant mal formé', async () => {
    const seller = bookseller();

    const missing = asFailure(await postAs('prix', seller, { bookId: '424242', intent: 'fixer', price: '5' }));
    const removed = asFailure(await postAs('prix', seller, { bookId: '424242', intent: 'retirer' }));
    const malformed = asFailure(await postAs('prix', seller, { bookId: '1e3', intent: 'fixer', price: '5' }));

    expect(missing.status).toBe(404);
    expect(missing.data.counterError.message).toBe(BOOK_NOT_FOUND_MESSAGE);
    expect(removed.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});
