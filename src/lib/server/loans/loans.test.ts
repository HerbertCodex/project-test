import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth';
import { addBook } from '../catalogue';
import { DEFAULT_PAGE_SIZE } from '../pagination';
import { IN_MEMORY_DATABASE_PATH, openDatabase, type Db } from '../db';
import {
  countActiveLoans,
  listActiveLoans,
  listBorrowerActiveLoans,
  listBorrowerReturnedLoans
} from '.';

let db: Db;

function createUser(email: string, role: AuthUser['role'] = 'borrower'): AuthUser {
  const result = db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, 'hash-factice', ?, 0)`
    )
    .run(email, `Compte ${email}`, role);
  return { id: Number(result.lastInsertRowid), email, displayName: `Compte ${email}`, role };
}

function createBook(title: string): number {
  const created = addBook(db, { title, author: 'Autrice de test' });
  if (!created.ok) throw new Error('Livre de test non créé.');
  return created.book.id;
}

function insertLoan(
  bookId: number,
  userId: number,
  borrowedOn: string,
  dueOn: string,
  returnedOn: string | null = null
): number {
  const result = db
    .prepare(
      'INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on) VALUES (?, ?, ?, ?, ?)'
    )
    .run(bookId, userId, borrowedOn, dueOn, returnedOn);
  return Number(result.lastInsertRowid);
}

/** Insère `count` prêts en cours pour `userId`, chacun sur un livre distinct, même échéance. */
function insertManyActiveLoans(userId: number, count: number, dueOn = '2026-06-01'): number[] {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const bookId = createBook(`Livre actif ${i}`);
    ids.push(insertLoan(bookId, userId, '2026-05-01', dueOn));
  }
  return ids;
}

/** Insère `count` prêts rendus pour `userId`, chacun sur un livre distinct, même date de retour. */
function insertManyReturnedLoans(userId: number, count: number, returnedOn = '2026-05-15'): number[] {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const bookId = createBook(`Livre rendu ${i}`);
    ids.push(insertLoan(bookId, userId, '2026-04-01', '2026-05-01', returnedOn));
  }
  return ids;
}

beforeEach(() => {
  db = openDatabase(IN_MEMORY_DATABASE_PATH);
});

afterEach(() => {
  db.close();
});

describe('listActiveLoans', () => {
  it('pagine à 25 lignes et calcule le total réel', () => {
    const bookseller = createUser('libraire@example.fr', 'bookseller');
    const borrower = createUser('lecteur@example.fr');
    const ids = insertManyActiveLoans(borrower.id, 30);
    void bookseller;

    const firstPage = listActiveLoans(db, 1, '2026-05-20');
    const secondPage = listActiveLoans(db, 2, '2026-05-20');

    expect(firstPage.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(firstPage.totalItems).toBe(30);
    expect(firstPage.totalPages).toBe(2);
    expect(secondPage.items).toHaveLength(5);
    expect(secondPage.page).toBe(2);

    // Même échéance pour tous : l'id départage, sans recouvrement ni oubli entre les pages.
    const seenIds = [...firstPage.items, ...secondPage.items].map((loan) => loan.id);
    expect(new Set(seenIds).size).toBe(30);
    expect(seenIds).toEqual([...ids]);
  });

  it('compte tous les retards, y compris ceux des pages suivantes', () => {
    const borrower = createUser('lecteur@example.fr');
    // Trente prêts en cours : les dix premiers échus la veille, les vingt autres à venir.
    // Le comptoir n'affiche que vingt-cinq lignes, donc cinq retards sont hors de la première page.
    for (let index = 0; index < 10; index++) {
      insertLoan(createBook(`Retard ${index}`), borrower.id, '2026-04-01', '2026-05-19');
    }
    for (let index = 0; index < 20; index++) {
      insertLoan(createBook(`À jour ${index}`), borrower.id, '2026-05-01', '2026-06-30');
    }

    const firstPage = listActiveLoans(db, 1, '2026-05-20');
    const secondPage = listActiveLoans(db, 2, '2026-05-20');

    expect(firstPage.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(firstPage.overdueCount).toBe(10);
    expect(secondPage.overdueCount).toBe(10);
    // Le compteur ne se confond pas avec les retards visibles sur la page courante.
    expect(firstPage.items.filter((loan) => loan.overdue)).toHaveLength(10);
    expect(secondPage.items.filter((loan) => loan.overdue)).toHaveLength(0);
  });

  it('borne silencieusement une page hors bornes à la dernière page connue', () => {
    const borrower = createUser('lecteur@example.fr');
    insertManyActiveLoans(borrower.id, 3);

    const page = listActiveLoans(db, 999, '2026-05-20');

    expect(page.page).toBe(1);
    expect(page.totalPages).toBe(1);
    expect(page.items).toHaveLength(3);
  });

  it('conserve le tri par échéance croissante puis id', () => {
    const borrower = createUser('lecteur@example.fr');
    const bookA = createBook('A');
    const bookB = createBook('B');
    const later = insertLoan(bookA, borrower.id, '2026-04-01', '2026-06-01');
    const earlier = insertLoan(bookB, borrower.id, '2026-04-01', '2026-05-01');

    const page = listActiveLoans(db, 1, '2026-05-20');

    expect(page.items.map((loan) => loan.id)).toEqual([earlier, later]);
  });
});

describe('listBorrowerActiveLoans', () => {
  it('pagine indépendamment par utilisateur, triée par échéance puis id', () => {
    const a = createUser('a@example.fr');
    const b = createUser('b@example.fr');
    const idsA = insertManyActiveLoans(a.id, 27);
    insertManyActiveLoans(b.id, 2);

    const firstPage = listBorrowerActiveLoans(db, a.id, 1, '2026-05-20');
    const secondPage = listBorrowerActiveLoans(db, a.id, 2, '2026-05-20');

    expect(firstPage.totalItems).toBe(27);
    expect(firstPage.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(secondPage.items).toHaveLength(2);
    const seenIds = [...firstPage.items, ...secondPage.items].map((loan) => loan.id);
    expect(seenIds).toEqual(idsA);
  });

  it("ne renvoie jamais les prêts d'un autre emprunteur", () => {
    const a = createUser('a@example.fr');
    const b = createUser('b@example.fr');
    insertManyActiveLoans(a.id, 1);
    const [idB] = insertManyActiveLoans(b.id, 1);

    const page = listBorrowerActiveLoans(db, b.id, 1);

    expect(page.items.map((loan) => loan.id)).toEqual([idB]);
  });
});

describe('listBorrowerReturnedLoans', () => {
  it('trie en SQL par date de retour puis id, tous deux décroissants', () => {
    const borrower = createUser('lecteur@example.fr');
    const bookA = createBook('A');
    const bookB = createBook('B');
    const bookC = createBook('C');
    const sameDayFirst = insertLoan(bookA, borrower.id, '2026-01-01', '2026-01-31', '2026-02-10');
    const sameDaySecond = insertLoan(bookB, borrower.id, '2026-01-01', '2026-01-31', '2026-02-10');
    const older = insertLoan(bookC, borrower.id, '2026-01-01', '2026-01-31', '2026-02-01');

    const page = listBorrowerReturnedLoans(db, borrower.id, 1);

    expect(page.items.map((loan) => loan.id)).toEqual([sameDaySecond, sameDayFirst, older]);
  });

  it('pagine à 25 lignes sans recouvrement ni omission entre deux pages', () => {
    const borrower = createUser('lecteur@example.fr');
    const ids = insertManyReturnedLoans(borrower.id, 40);
    // Insérés du plus ancien id au plus récent ; le tri id DESC les renvoie donc à l'envers.
    const expectedOrder = [...ids].reverse();

    const firstPage = listBorrowerReturnedLoans(db, borrower.id, 1);
    const secondPage = listBorrowerReturnedLoans(db, borrower.id, 2);

    expect(firstPage.totalItems).toBe(40);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(secondPage.items).toHaveLength(15);
    const seenIds = [...firstPage.items, ...secondPage.items].map((loan) => loan.id);
    expect(seenIds).toEqual(expectedOrder);
  });
});

describe('countActiveLoans', () => {
  it('vaut 0 sans prêt en cours', () => {
    const borrower = createUser('lecteur@example.fr');

    expect(countActiveLoans(db, borrower.id)).toBe(0);
  });

  it('vaut 1 avec un seul prêt en cours', () => {
    const borrower = createUser('lecteur@example.fr');
    insertManyActiveLoans(borrower.id, 1);

    expect(countActiveLoans(db, borrower.id)).toBe(1);
  });

  it('compte exactement plusieurs prêts en cours, sans compter les rendus ni ceux des autres', () => {
    const borrower = createUser('lecteur@example.fr');
    const other = createUser('autre@example.fr');
    insertManyActiveLoans(borrower.id, 4);
    insertManyReturnedLoans(borrower.id, 2);
    insertManyActiveLoans(other.id, 5);

    expect(countActiveLoans(db, borrower.id)).toBe(4);
  });
});
