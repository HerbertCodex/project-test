import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import CatalogueTable from '$lib/components/CatalogueTable.svelte';
import type { AuthUser } from '$lib/server/auth';
import { addBook, type CatalogueEntry } from '$lib/server/catalogue';
import { closeDb, getDb } from '$lib/server/db';
import { load } from './+page.server';

const SQL_PAYLOAD = "'; DROP TABLE books;--";
const HOSTILE_TITLE = '<script>alert(1)</script>';

type LoadEvent = Parameters<typeof load>[0];

async function catalogueFor(user: AuthUser | null): Promise<CatalogueEntry[]> {
  const data = await load({ locals: { user } } as unknown as LoadEvent);
  return (data as { books: CatalogueEntry[] }).books;
}

function insertUser(email: string, displayName: string): AuthUser {
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, ?, 'borrower', 0)`
    )
    .run(email, displayName, 'hash-factice');
  return { id: Number(result.lastInsertRowid), email, displayName, role: 'borrower' };
}

function createBook(title: string, author: string): number {
  const created = addBook(getDb(), { title, author });
  if (!created.ok) throw new Error('Livre de test non créé.');
  return created.book.id;
}

function tableNames(): string[] {
  return (
    getDb()
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

afterEach(() => {
  closeDb();
});

describe('load / (catalogue public)', () => {
  it('liste les livres sans connexion avec seulement id, titre, auteur et statut', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur Secret');
    const borrowedId = createBook('Le Petit Prince', 'Antoine de Saint-Exupéry');
    createBook('Candide', 'Voltaire');
    getDb()
      .prepare('INSERT INTO loans (book_id, user_id, borrowed_on, due_on) VALUES (?, ?, ?, ?)')
      .run(borrowedId, borrower.id, '2026-09-01', '2026-10-01');

    const books = await catalogueFor(null);

    expect(books).toEqual([
      { id: expect.any(Number), title: 'Candide', author: 'Voltaire', status: 'available' },
      {
        id: borrowedId,
        title: 'Le Petit Prince',
        author: 'Antoine de Saint-Exupéry',
        status: 'borrowed'
      }
    ]);
    for (const book of books) {
      expect(Object.keys(book).sort()).toEqual(['author', 'id', 'status', 'title']);
    }

    const serialized = JSON.stringify(books);
    for (const secret of ['lecteur@example.fr', 'Lecteur Secret', '2026-10-01', '2026-09-01']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('ne révèle pas l’emprunteur à un autre emprunteur connecté', async () => {
    const owner = insertUser('a@example.fr', 'Emprunteur A');
    const other = insertUser('b@example.fr', 'Emprunteur B');
    const bookId = createBook('Germinal', 'Émile Zola');
    getDb()
      .prepare('INSERT INTO loans (book_id, user_id, borrowed_on, due_on) VALUES (?, ?, ?, ?)')
      .run(bookId, owner.id, '2026-09-01', '2026-10-01');

    const books = await catalogueFor(other);

    expect(books).toEqual([{ id: bookId, title: 'Germinal', author: 'Émile Zola', status: 'borrowed' }]);
    expect(JSON.stringify(books)).not.toMatch(/a@example\.fr|Emprunteur A|2026-10-01/);
  });

  it('montre de nouveau « disponible » un livre rendu', async () => {
    const borrower = insertUser('lecteur@example.fr', 'Lecteur');
    const bookId = createBook('Nana', 'Émile Zola');
    getDb()
      .prepare(
        'INSERT INTO loans (book_id, user_id, borrowed_on, due_on, returned_on) VALUES (?, ?, ?, ?, ?)'
      )
      .run(bookId, borrower.id, '2026-09-01', '2026-10-01', '2026-09-10');

    expect((await catalogueFor(null))[0].status).toBe('available');
  });

  it('stocke et renvoie littéralement une charge utile SQL, tables intactes', async () => {
    const before = tableNames();
    const bookId = createBook(SQL_PAYLOAD, SQL_PAYLOAD);

    expect(await catalogueFor(null)).toEqual([
      { id: bookId, title: SQL_PAYLOAD, author: SQL_PAYLOAD, status: 'available' }
    ]);
    expect(tableNames()).toEqual(before);
    expect(tableNames()).toContain('books');
  });
});

describe('CatalogueTable', () => {
  const books: CatalogueEntry[] = [
    { id: 1, title: HOSTILE_TITLE, author: '<img src=x onerror=alert(1)>', status: 'available' },
    { id: 2, title: 'Candide', author: 'Voltaire', status: 'borrowed' }
  ];

  it('rend une table avec thead et en-têtes de colonne à portée explicite', () => {
    const { body } = render(CatalogueTable, { props: { books } });

    expect(body).toContain('<thead');
    expect(body).toMatch(/<th[^>]*scope="col"[^>]*>Titre<\/th>/);
    expect(body).toMatch(/<th[^>]*scope="col"[^>]*>Auteur<\/th>/);
    expect(body).toContain('Disponible');
    expect(body).toContain('Emprunté');
    // Sans action fournie (visiteur, libraire), aucune colonne Action.
    expect(body).not.toContain('col-action');
  });

  it('rend un titre et un auteur hostiles comme du texte', () => {
    const { body } = render(CatalogueTable, { props: { books } });

    expect(body).not.toContain('<script');
    expect(body).not.toContain('<img');
    expect(body).toMatch(/&lt;script(>|&gt;)alert\(1\)&lt;\/script(>|&gt;)/);
    expect(body).toMatch(/&lt;img src=x onerror=alert\(1\)(>|&gt;)/);
  });
});
