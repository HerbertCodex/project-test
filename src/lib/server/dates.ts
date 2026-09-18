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

const parisDateTimeParts = new Intl.DateTimeFormat('en-US', {
  timeZone: LIBRARY_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
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
 * Recule une date calendaire d'une année, sur le modèle d'`addCalendarDays` :
 * le même jour de l'année précédente. Le 29 février n'existant pas hors année
 * bissextile, il devient le 28 février.
 */
export function subtractCalendarYear(isoDate: string): string {
  const date = toUtcMidnight(isoDate);
  const day = date.getUTCDate();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  // Date reporte au 1er mars un 29 février absent de l'année visée ; le jour 0
  // ramène au dernier jour du mois précédent, soit le 28 février.
  if (date.getUTCDate() !== day) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

/** Décalage de Paris sur UTC, en millisecondes, à l'instant donné. */
function parisOffsetMs(instant: number): number {
  // Les parties formatées s'arrêtent à la seconde : comparer à l'instant
  // tronqué à la seconde, sinon les millisecondes fausseraient le décalage.
  const truncated = Math.floor(instant / 1000) * 1000;
  const parts = Object.fromEntries(
    parisDateTimeParts.formatToParts(new Date(truncated)).map((part) => [part.type, part.value])
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asIfUtc - truncated;
}

/**
 * Instant, en millisecondes epoch, où commence à Paris la date calendaire
 * donnée : minuit local, heure d'été ou d'hiver comprise.
 */
export function startOfDayInParis(isoDate: string): number {
  const utcMidnight = toUtcMidnight(isoDate).getTime();
  // Le décalage à appliquer est celui de l'instant cherché, pas celui de minuit
  // UTC : une première estimation en approche, la seconde la confirme de part
  // et d'autre d'un changement d'heure.
  const estimate = utcMidnight - parisOffsetMs(utcMidnight);
  return utcMidnight - parisOffsetMs(estimate);
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
