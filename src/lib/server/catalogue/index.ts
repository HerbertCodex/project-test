/**
 * Catalogue public et ajout de livres par le libraire.
 *
 * Toutes les fonctions reçoivent la base en paramètre. Le SQL passe
 * exclusivement par des requêtes préparées à paramètres liés.
 */
import { error, redirect } from '@sveltejs/kit';
import type { AuthUser, Validation } from '../auth';
import type { Db } from '../db';

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

/**
 * Ligne du catalogue public : ni emprunteur ni échéance. Les colonnes de
 * l'incrément 2 (prix, vente) s'ajouteront ici.
 */
export type CatalogueEntry = {
  id: number;
  title: string;
  author: string;
  status: BookLoanStatus;
};

type CatalogueRow = { id: number; title: string; author: string; borrowed: number };

const frenchCollator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/** Tous les livres, triés par titre puis auteur, avec leur statut de prêt. */
export function listCatalogue(db: Db): CatalogueEntry[] {
  const rows = db
    .prepare(
      `SELECT books.id, books.title, books.author,
         EXISTS (
           SELECT 1 FROM loans WHERE loans.book_id = books.id AND loans.returned_on IS NULL
         ) AS borrowed
       FROM books`
    )
    .all() as CatalogueRow[];

  return rows
    .map((row) => ({
      id: row.id,
      title: row.title,
      author: row.author,
      status: row.borrowed ? ('borrowed' as const) : ('available' as const)
    }))
    .sort(
      (a, b) =>
        frenchCollator.compare(a.title, b.title) ||
        frenchCollator.compare(a.author, b.author) ||
        a.id - b.id
    );
}

// ---------------------------------------------------------------------------
// Ajout d'un livre
// ---------------------------------------------------------------------------

export const BOOK_TEXT_MAX_LENGTH = 200;

export type BookField = 'title' | 'author';
export type BookFieldErrors = Partial<Record<BookField, string>>;

/** Valeurs brutes du formulaire : rien n'est présumé. */
export type BookInput = { title: unknown; author: unknown };
export type ValidBook = { title: string; author: string };
export type BookValidation = { ok: true; value: ValidBook } | { ok: false; errors: BookFieldErrors };

export type NewBook = Omit<CatalogueEntry, 'status'>;
export type BookCreationResult = { ok: true; book: NewBook } | { ok: false; errors: BookFieldErrors };

const CONTROL_CHARACTER = /\p{Cc}/u;

const FIELD_WORDING: Record<BookField, { missing: string; subject: string }> = {
  title: { missing: 'Saisissez un titre.', subject: 'Le titre' },
  author: { missing: 'Saisissez un auteur.', subject: 'L’auteur' }
};

function validateBookText(field: BookField, raw: unknown): Validation<string> {
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

/** Titre et auteur sans espaces autour, de 1 à 200 caractères chacun. */
export function validateBook(input: BookInput): BookValidation {
  const title = validateBookText('title', input.title);
  const author = validateBookText('author', input.author);

  if (title.ok && author.ok) {
    return { ok: true, value: { title: title.value, author: author.value } };
  }

  const errors: BookFieldErrors = {};
  if (!title.ok) errors.title = title.error;
  if (!author.ok) errors.author = author.error;
  return { ok: false, errors };
}

/** Ajoute l'exemplaire unique d'un titre ; il est aussitôt « Disponible ». */
export function addBook(db: Db, input: BookInput): BookCreationResult {
  const validation = validateBook(input);
  if (!validation.ok) return validation;

  const { title, author } = validation.value;
  const result = db.prepare('INSERT INTO books (title, author) VALUES (?, ?)').run(title, author);
  return { ok: true, book: { id: Number(result.lastInsertRowid), title, author } };
}
