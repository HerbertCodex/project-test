import { isHttpError, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '$lib/server/auth';
import { addBook } from '$lib/server/catalogue';
import { closeDb, getDb } from '$lib/server/db';
import { BORROWER_ONLY_MESSAGE } from '$lib/server/loans';
import { load } from './+page.server';
import MyLoansPage from './+page.svelte';

type LoanPageInfo = { page: number; pageSize: number; totalItems: number; totalPages: number };
type ActiveLoan = {
  id: number;
  title: string;
  borrowedOn: { iso: string; label: string };
  dueOn: { iso: string; label: string };
  overdue: boolean;
};
type ReturnedLoan = {
  id: number;
  title: string;
  borrowedOn: { iso: string; label: string };
  returnedOn: { iso: string; label: string };
};
type LoadData = {
  active: ActiveLoan[];
  activeOverdueCount: number;
  activePageInfo: LoanPageInfo;
  activePageQuery: string;
  returned: ReturnedLoan[];
  returnedPageInfo: LoanPageInfo;
  returnedPageQuery: string;
};

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

function borrower(email = 'lecteur@example.fr'): AuthUser {
  return insertUser(email, 'borrower');
}

function bookseller(): AuthUser {
  return insertUser('libraire@example.fr', 'bookseller');
}

function createBook(title: string): number {
  const created = addBook(getDb(), { title, author: 'Auteur' });
  if (!created.ok) throw new Error('Livre de test non créé.');
  return created.book.id;
}

function insertActiveLoan(userId: number, title: string, dueOn: string): number {
  const bookId = createBook(title);
  const result = getDb()
    .prepare('INSERT INTO loans (book_id, user_id, borrowed_on, due_on) VALUES (?, ?, ?, ?)')
    .run(bookId, userId, '2026-01-01', dueOn);
  return Number(result.lastInsertRowid);
}

function insertReturnedLoan(userId: number, title: string, returnedOn: string): number {
  const bookId = createBook(title);
  const result = getDb()
    .prepare(
      'INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on) VALUES (?, ?, ?, ?, ?)'
    )
    .run(bookId, userId, '2025-01-01', '2025-01-31', returnedOn);
  return Number(result.lastInsertRowid);
}

/** Exécute un load et capture la redirection ou l'erreur HTTP levée. */
async function outcomeOf(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (thrown) {
    if (isRedirect(thrown) || isHttpError(thrown)) return thrown;
    throw thrown;
  }
}

function loadAs(user: AuthUser | null, search = ''): Promise<unknown> {
  const url = new URL(`http://localhost/mes-prets${search}`);
  return outcomeOf(() => load({ url, locals: { user } } as unknown as Parameters<typeof load>[0]));
}

function expectForbidden(outcome: unknown, message = BORROWER_ONLY_MESSAGE) {
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
  closeDb();
});

describe('pagination indépendante de /mes-prets', () => {
  it('pagine séparément les prêts en cours et les prêts rendus, sans se gêner l’un l’autre', async () => {
    const reader = borrower();
    for (let i = 0; i < 30; i++) {
      insertActiveLoan(reader.id, `Actif ${String(i).padStart(2, '0')}`, `2026-06-${String(1 + (i % 28)).padStart(2, '0')}`);
    }
    for (let i = 0; i < 30; i++) {
      insertReturnedLoan(reader.id, `Rendu ${String(i).padStart(2, '0')}`, `2025-0${1 + (i % 9)}-01`);
    }

    const first = (await loadAs(reader, '?pageActifs=1&pageRendus=1')) as LoadData;
    const secondActive = (await loadAs(reader, '?pageActifs=2&pageRendus=1')) as LoadData;
    const secondReturned = (await loadAs(reader, '?pageActifs=1&pageRendus=2')) as LoadData;

    expect(first.active).toHaveLength(25);
    expect(first.returned).toHaveLength(25);
    expect(first.activePageInfo).toMatchObject({ page: 1, totalItems: 30, totalPages: 2 });
    expect(first.returnedPageInfo).toMatchObject({ page: 1, totalItems: 30, totalPages: 2 });

    // Changer pageActifs ne modifie pas la page rendue de pageRendus.
    expect(secondActive.active).toHaveLength(5);
    expect(secondActive.returned).toEqual(first.returned);
    expect(secondActive.returnedPageInfo).toEqual(first.returnedPageInfo);

    // Changer pageRendus ne modifie pas la page rendue de pageActifs.
    expect(secondReturned.returned).toHaveLength(5);
    expect(secondReturned.active).toEqual(first.active);
    expect(secondReturned.activePageInfo).toEqual(first.activePageInfo);
  });

  it('conserve le paramètre de page de l’autre section dans les liens Suivant', async () => {
    const reader = borrower();
    for (let i = 0; i < 30; i++) {
      insertActiveLoan(reader.id, `Actif ${String(i).padStart(2, '0')}`, '2026-06-01');
    }
    for (let i = 0; i < 30; i++) {
      insertReturnedLoan(reader.id, `Rendu ${String(i).padStart(2, '0')}`, '2025-01-01');
    }

    const data = (await loadAs(reader, '?pageActifs=1&pageRendus=1')) as LoadData;
    const { body } = render(MyLoansPage, {
      props: { data: { ...data, user: { displayName: 'Lecteur', role: 'borrower' } } } as never
    });

    // Le lien « Suivant » de la section active doit garder pageRendus=1, et
    // celui de la section rendus doit garder pageActifs=1, sinon cliquer dans
    // une section remet silencieusement l'autre en page 1.
    expect(body).toContain('href="?pageRendus=1&amp;pageActifs=2"');
    expect(body).toContain('href="?pageActifs=1&amp;pageRendus=2"');
  });

  it('affiche le total exact de prêts en cours et de retards, au-delà d’une seule page', async () => {
    const reader = borrower();
    for (let i = 0; i < 30; i++) {
      // Toutes en retard : échéance dépassée par rapport à aujourd'hui.
      insertActiveLoan(reader.id, `Actif ${String(i).padStart(2, '0')}`, '2026-02-01');
    }

    const data = (await loadAs(reader, '')) as LoadData;

    expect(data.activePageInfo.totalItems).toBe(30);
    expect(data.activeOverdueCount).toBe(30);
  });

  it.each(['0', '999', 'abc', '1.5'])(
    '?pageActifs=%s et ?pageRendus=%s répondent avec un contenu borné, sans erreur',
    async (page) => {
      const reader = borrower();
      insertActiveLoan(reader.id, 'Nana', '2026-06-01');
      insertReturnedLoan(reader.id, 'Germinal', '2025-01-01');

      const outcome = (await loadAs(reader, `?pageActifs=${page}&pageRendus=${page}`)) as LoadData;

      expect(outcome.activePageInfo.page).toBe(1);
      expect(outcome.returnedPageInfo.page).toBe(1);
      expect(outcome.active).toHaveLength(1);
      expect(outcome.returned).toHaveLength(1);
    }
  );

  it('n’expose jamais les prêts d’un autre compte, quel que soit le paramètre de page fourni', async () => {
    const owner = borrower('a@example.fr');
    const other = borrower('b@example.fr');
    insertActiveLoan(owner.id, 'Livre de A', '2026-06-01');
    insertReturnedLoan(owner.id, 'Ancien livre de A', '2025-01-01');
    insertActiveLoan(other.id, 'Livre de B', '2026-06-02');
    insertReturnedLoan(other.id, 'Ancien livre de B', '2025-02-01');

    for (const search of ['?pageActifs=1&pageRendus=1', '?pageActifs=0&pageRendus=999', '?pageActifs=abc&pageRendus=abc']) {
      const data = (await loadAs(other, search)) as LoadData;
      expect(data.active.map((loan) => loan.title)).toEqual(['Livre de B']);
      expect(data.returned.map((loan) => loan.title)).toEqual(['Ancien livre de B']);
      expect(JSON.stringify(data)).not.toMatch(/Livre de A|Ancien livre de A/);
    }
  });
});

describe('autorisation de /mes-prets', () => {
  it('un paramètre de page manipulé ne contourne pas le contrôle d’accès au chargement', async () => {
    const seller = bookseller();
    const reader = borrower();
    insertActiveLoan(reader.id, 'Nana', '2026-06-01');

    for (const search of [
      '?pageActifs=2&pageRendus=2',
      '?pageActifs=0&pageRendus=0',
      '?pageActifs=abc&pageRendus=999999'
    ]) {
      expectLoginRedirect(await loadAs(null, search));
      expectForbidden(await loadAs(seller, search));
    }
  });
});
