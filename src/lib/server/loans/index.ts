/**
 * Emprunts, retours et suivi des retards.
 *
 * Toutes les fonctions reçoivent la base en paramètre, et une horloge
 * injectable là où la date du jour compte. Le SQL passe exclusivement par des
 * requêtes préparées à paramètres liés.
 */
import { error, redirect } from '@sveltejs/kit';
import type { AuthUser } from '../auth';
import {
  addCalendarDays,
  formatDateFr,
  isOverdue,
  subtractCalendarYear,
  systemClock,
  todayInParis,
  type Clock
} from '../dates';
import type { Db } from '../db';
import { DEFAULT_PAGE_SIZE, pageWindow } from '../pagination';

// ---------------------------------------------------------------------------
// Contrôle d'accès et validation
// ---------------------------------------------------------------------------

export const BORROWER_ONLY_MESSAGE =
  'Cet espace est réservé aux emprunteurs : le compte libraire ne permet pas d’emprunter.';

/**
 * Garde serveur des écrans et actions emprunteur : un visiteur anonyme est
 * redirigé vers /connexion, le libraire reçoit une 403.
 */
export function requireBorrower(user: AuthUser | null): AuthUser {
  if (!user) redirect(303, '/connexion');
  if (user.role !== 'borrower') error(403, BORROWER_ONLY_MESSAGE);
  return user;
}

const RECORD_ID = /^[1-9][0-9]{0,15}$/;

/** Identifiant de ligne envoyé par un formulaire : entier strictement positif, sinon null. */
export function parseRecordId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !RECORD_ID.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Dates affichées
// ---------------------------------------------------------------------------

export const LOAN_DURATION_DAYS = 30;

/** Date calendaire et son libellé français, pour `<time datetime="…">libellé</time>`. */
export type LoanDate = { iso: string; label: string };

export function loanDate(iso: string): LoanDate {
  return { iso, label: formatDateFr(iso) };
}

// ---------------------------------------------------------------------------
// Emprunt
// ---------------------------------------------------------------------------

export const BOOK_NOT_FOUND_MESSAGE = 'Ce livre est introuvable.';
export const BOOK_UNAVAILABLE_MESSAGE = 'Ce livre vient d’être emprunté. La liste est à jour.';

export type NewLoan = {
  id: number;
  bookId: number;
  title: string;
  borrowedOn: string;
  dueOn: string;
};

export type BorrowResult =
  | { ok: true; loan: NewLoan }
  | { ok: false; reason: 'not-found' | 'conflict' | 'forbidden' };

function isUniqueViolation(thrown: unknown): boolean {
  return (
    thrown instanceof Error &&
    'code' in thrown &&
    (thrown as { code: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

/**
 * Emprunt immédiat de l'exemplaire unique d'un livre, du jour (Paris) à J+30.
 * La transaction relit le livre et ses prêts actifs ; l'index unique partiel
 * sur les prêts actifs reste l'arbitre final entre deux emprunts concurrents.
 * Le rôle emprunteur est revérifié en base au moment de l'insertion.
 */
export function borrowBook(
  db: Db,
  borrower: AuthUser,
  bookId: number,
  clock: Clock = systemClock
): BorrowResult {
  const borrowedOn = todayInParis(clock);
  const dueOn = addCalendarDays(borrowedOn, LOAN_DURATION_DAYS);

  const attempt = db.transaction((): BorrowResult => {
    const book = db.prepare('SELECT title FROM books WHERE id = ?').get(bookId) as
      | { title: string }
      | undefined;
    if (!book) return { ok: false, reason: 'not-found' };

    const active = db
      .prepare('SELECT 1 FROM loans WHERE book_id = ? AND returned_on IS NULL')
      .get(bookId);
    if (active) return { ok: false, reason: 'conflict' };

    const inserted = db
      .prepare(
        `INSERT INTO loans (book_id, user_id, borrowed_on, due_on)
         SELECT ?, users.id, ?, ? FROM users WHERE users.id = ? AND users.role = 'borrower'`
      )
      .run(bookId, borrowedOn, dueOn, borrower.id);
    if (inserted.changes === 0) return { ok: false, reason: 'forbidden' };

    return {
      ok: true,
      loan: { id: Number(inserted.lastInsertRowid), bookId, title: book.title, borrowedOn, dueOn }
    };
  });

  try {
    return attempt.immediate();
  } catch (thrown) {
    if (isUniqueViolation(thrown)) return { ok: false, reason: 'conflict' };
    throw thrown;
  }
}

// ---------------------------------------------------------------------------
// Retour
// ---------------------------------------------------------------------------

export const LOAN_NOT_RETURNABLE_MESSAGE =
  'Ce prêt a déjà été rendu ou n’existe plus. La liste a été mise à jour.';

export type ReturnedLoan = {
  id: number;
  title: string;
  borrowerName: string;
  returnedOn: string;
};

export type ReturnResult =
  | { ok: true; loan: ReturnedLoan }
  | { ok: false; reason: 'not-found' | 'already-returned' };

type ReturnCandidateRow = {
  id: number;
  title: string;
  display_name: string;
  returned_on: string | null;
};

/**
 * Enregistre le retour d'un prêt actif à la date du jour (Paris). Le prêt est
 * conservé dans l'historique ; le livre redevient disponible. Réservé au
 * libraire : le contrôle de rôle est fait par l'appelant (requireBookseller).
 */
export function recordReturn(db: Db, loanId: number, clock: Clock = systemClock): ReturnResult {
  const returnedOn = todayInParis(clock);

  return db
    .transaction((): ReturnResult => {
      const loan = db
        .prepare(
          `SELECT loans.id, books.title, users.display_name, loans.returned_on
           FROM loans
           JOIN books ON books.id = loans.book_id
           JOIN users ON users.id = loans.user_id
           WHERE loans.id = ?`
        )
        .get(loanId) as ReturnCandidateRow | undefined;
      if (!loan) return { ok: false, reason: 'not-found' };
      if (loan.returned_on !== null) return { ok: false, reason: 'already-returned' };

      const updated = db
        .prepare('UPDATE loans SET returned_on = ? WHERE id = ? AND returned_on IS NULL')
        .run(returnedOn, loanId);
      if (updated.changes === 0) return { ok: false, reason: 'already-returned' };

      return {
        ok: true,
        loan: { id: loan.id, title: loan.title, borrowerName: loan.display_name, returnedOn }
      };
    })
    .immediate();
}

// ---------------------------------------------------------------------------
// Listes
// ---------------------------------------------------------------------------

/** Page d'une liste de prêts : les lignes de la page demandée et le total réel. */
export type LoanPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

function toLoanPage<T>(
  items: T[],
  clampedPage: number,
  totalItems: number,
  totalPages: number
): LoanPage<T> {
  return { items, page: clampedPage, pageSize: DEFAULT_PAGE_SIZE, totalItems, totalPages };
}

/** Prêt en cours vu au comptoir. */
export type ActiveLoan = {
  id: number;
  title: string;
  borrowerName: string;
  dueOn: LoanDate;
  overdue: boolean;
};

type ActiveLoanRow = { id: number; title: string; display_name: string; due_on: string };

/** Page de prêts en cours, avec le nombre total de retards toutes pages confondues. */
export type ActiveLoanPage = LoanPage<ActiveLoan> & { overdueCount: number };

/** Prêts en cours, par échéance croissante puis id : les retards viennent en tête. */
export function listActiveLoans(
  db: Db,
  page = 1,
  today: string = todayInParis()
): ActiveLoanPage {
  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM loans WHERE returned_on IS NULL')
    .get() as { count: number };
  const { overdueCount } = db
    .prepare('SELECT COUNT(*) AS overdueCount FROM loans WHERE returned_on IS NULL AND due_on < ?')
    .get(today) as { overdueCount: number };
  const { page: clampedPage, totalPages, offset } = pageWindow(page, count);

  const rows = db
    .prepare(
      `SELECT loans.id, books.title, users.display_name, loans.due_on
       FROM loans
       JOIN books ON books.id = loans.book_id
       JOIN users ON users.id = loans.user_id
       WHERE loans.returned_on IS NULL
       ORDER BY loans.due_on, loans.id
       LIMIT ? OFFSET ?`
    )
    .all(DEFAULT_PAGE_SIZE, offset) as ActiveLoanRow[];

  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    borrowerName: row.display_name,
    dueOn: loanDate(row.due_on),
    overdue: isOverdue(row.due_on, today)
  }));

  return { ...toLoanPage(items, clampedPage, count, totalPages), overdueCount };
}

/**
 * Vrai si ce compte a au moins un prêt non rendu. Une obligation en cours
 * interdit la suppression du compte : le livre doit revenir d'abord.
 */
export function hasActiveLoan(db: Db, userId: number): boolean {
  const active = db
    .prepare('SELECT 1 FROM loans WHERE user_id = ? AND returned_on IS NULL LIMIT 1')
    .get(userId);
  return active !== undefined;
}

/** Nombre exact de prêts en cours d'un compte, pour /compte. */
export function countActiveLoans(db: Db, userId: number): number {
  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM loans WHERE user_id = ? AND returned_on IS NULL')
    .get(userId) as { count: number };
  return count;
}

export type BorrowerActiveLoan = {
  id: number;
  title: string;
  borrowedOn: LoanDate;
  dueOn: LoanDate;
  overdue: boolean;
};

export type BorrowerReturnedLoan = {
  id: number;
  title: string;
  borrowedOn: LoanDate;
  returnedOn: LoanDate;
};

type BorrowerActiveLoanRow = { id: number; title: string; borrowed_on: string; due_on: string };

/** Page des prêts en cours d'un emprunteur, avec le nombre total de ses retards. */
export type BorrowerActiveLoanPage = LoanPage<BorrowerActiveLoan> & { overdueCount: number };

/** Prêts en cours d'un seul utilisateur, par échéance croissante puis id. */
export function listBorrowerActiveLoans(
  db: Db,
  userId: number,
  page = 1,
  today: string = todayInParis()
): BorrowerActiveLoanPage {
  const { count } = db
    .prepare(
      'SELECT COUNT(*) AS count FROM loans WHERE loans.user_id = ? AND loans.returned_on IS NULL'
    )
    .get(userId) as { count: number };
  const { overdueCount } = db
    .prepare(
      `SELECT COUNT(*) AS overdueCount FROM loans
       WHERE loans.user_id = ? AND loans.returned_on IS NULL AND loans.due_on < ?`
    )
    .get(userId, today) as { overdueCount: number };
  const { page: clampedPage, totalPages, offset } = pageWindow(page, count);

  const rows = db
    .prepare(
      `SELECT loans.id, books.title, loans.borrowed_on, loans.due_on
       FROM loans
       JOIN books ON books.id = loans.book_id
       WHERE loans.user_id = ? AND loans.returned_on IS NULL
       ORDER BY loans.due_on, loans.id
       LIMIT ? OFFSET ?`
    )
    .all(userId, DEFAULT_PAGE_SIZE, offset) as BorrowerActiveLoanRow[];

  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    borrowedOn: loanDate(row.borrowed_on),
    dueOn: loanDate(row.due_on),
    overdue: isOverdue(row.due_on, today)
  }));

  return { ...toLoanPage(items, clampedPage, count, totalPages), overdueCount };
}

type BorrowerReturnedLoanRow = {
  id: number;
  title: string;
  borrowed_on: string;
  returned_on: string;
};

/** Prêts rendus d'un seul utilisateur, du plus récent au plus ancien puis id décroissant. */
export function listBorrowerReturnedLoans(
  db: Db,
  userId: number,
  page = 1
): LoanPage<BorrowerReturnedLoan> {
  const { count } = db
    .prepare(
      'SELECT COUNT(*) AS count FROM loans WHERE loans.user_id = ? AND loans.returned_on IS NOT NULL'
    )
    .get(userId) as { count: number };
  const { page: clampedPage, totalPages, offset } = pageWindow(page, count);

  const rows = db
    .prepare(
      `SELECT loans.id, books.title, loans.borrowed_on, loans.returned_on
       FROM loans
       JOIN books ON books.id = loans.book_id
       WHERE loans.user_id = ? AND loans.returned_on IS NOT NULL
       ORDER BY loans.returned_on DESC, loans.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, DEFAULT_PAGE_SIZE, offset) as BorrowerReturnedLoanRow[];

  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    borrowedOn: loanDate(row.borrowed_on),
    returnedOn: loanDate(row.returned_on)
  }));

  return toLoanPage(items, clampedPage, count, totalPages);
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/**
 * Première date calendaire de prêt rendu que la purge conserve : la date du jour
 * à Paris reculée d'une année calendaire. La rétention se compte en dates
 * calendaires, jamais en 365 jours.
 */
export function returnedLoanRetentionStart(clock: Clock = systemClock): string {
  return subtractCalendarYear(todayInParis(clock));
}

/**
 * Supprime les prêts rendus dont `returned_on` est strictement antérieur à
 * `returnedLoanRetentionStart` et renvoie leur nombre.
 *
 * Un prêt en cours n'est jamais supprimé, si ancien soit-il : il reste une
 * obligation. Les livres et les ventes ne sont pas touchés.
 */
export function purgeReturnedLoans(db: Db, clock: Clock = systemClock): number {
  // Des dates AAAA-MM-JJ valides se comparent dans l'ordre lexicographique.
  const retentionStart = returnedLoanRetentionStart(clock);
  return db
    .prepare('DELETE FROM loans WHERE returned_on IS NOT NULL AND returned_on < ?')
    .run(retentionStart).changes;
}
