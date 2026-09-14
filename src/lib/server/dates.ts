/**
 * Dates calendaires (AAAA-MM-JJ) dans le fuseau Europe/Paris.
 *
 * Seule la lecture de « maintenant » dépend du fuseau : une fois la date du
 * jour à Paris connue, l'ajout de jours et les comparaisons se font sur des
 * dates sans heure, donc sans effet des changements d'heure.
 */

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export const LIBRARY_TIME_ZONE = 'Europe/Paris';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const parisDateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: LIBRARY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const frenchLongDate = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

function toUtcMidnight(isoDate: string): Date {
  const match = CALENDAR_DATE.exec(isoDate);
  if (match) {
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.toISOString().slice(0, 10) === isoDate) return date;
  }
  throw new RangeError('Date calendaire invalide : format AAAA-MM-JJ attendu.');
}

/** Vrai si `value` est une date calendaire existante au format AAAA-MM-JJ. */
export function isCalendarDate(value: string): boolean {
  try {
    toUtcMidnight(value);
    return true;
  } catch {
    return false;
  }
}

/** Date calendaire à Paris de l'instant donné. */
export function parisDateOf(instant: Date): string {
  const parts = Object.fromEntries(
    parisDateParts.formatToParts(instant).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Date du jour à Paris selon l'horloge fournie. */
export function todayInParis(clock: Clock = systemClock): string {
  return parisDateOf(clock());
}

/** Ajoute (ou retire, si négatif) un nombre entier de jours calendaires. */
export function addCalendarDays(isoDate: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError('Le nombre de jours doit être un entier.');
  }
  const date = toUtcMidnight(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Un prêt est en retard si et seulement si la date du jour à Paris est
 * strictement postérieure à son échéance.
 */
export function isOverdue(dueOn: string, today: string = todayInParis()): boolean {
  toUtcMidnight(dueOn);
  toUtcMidnight(today);
  // Des dates AAAA-MM-JJ valides se comparent dans l'ordre lexicographique.
  return today > dueOn;
}

/** Libellé français d'une date calendaire, par exemple « 14 octobre 2026 ». */
export function formatDateFr(isoDate: string): string {
  return frenchLongDate.format(toUtcMidnight(isoDate));
}
