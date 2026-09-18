import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  formatDateFr,
  isCalendarDate,
  isOverdue,
  parisDateOf,
  startOfDayInParis,
  subtractCalendarYear,
  todayInParis,
  type Clock
} from './dates';

const clockAt =
  (iso: string): Clock =>
  () =>
    new Date(iso);

describe('todayInParis', () => {
  it('2026-03-31T22:30Z tombe le 2026-04-01 à Paris (heure d’été)', () => {
    expect(todayInParis(clockAt('2026-03-31T22:30:00Z'))).toBe('2026-04-01');
  });

  it('bascule à minuit heure de Paris, en été comme en hiver', () => {
    expect(todayInParis(clockAt('2026-03-31T21:59:59Z'))).toBe('2026-03-31');
    expect(todayInParis(clockAt('2026-03-31T22:00:00Z'))).toBe('2026-04-01');
    expect(todayInParis(clockAt('2026-01-15T22:59:59Z'))).toBe('2026-01-15');
    expect(todayInParis(clockAt('2026-01-15T23:00:00Z'))).toBe('2026-01-16');
  });

  it('suit les changements d’heure de mars et d’octobre', () => {
    // 29 mars 2026 : 02:00 CET → 03:00 CEST ; 25 octobre 2026 : 03:00 CEST → 02:00 CET.
    expect(todayInParis(clockAt('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
    expect(todayInParis(clockAt('2026-03-29T21:30:00Z'))).toBe('2026-03-29');
    expect(todayInParis(clockAt('2026-03-29T22:30:00Z'))).toBe('2026-03-30');
    expect(todayInParis(clockAt('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
    expect(todayInParis(clockAt('2026-10-25T22:30:00Z'))).toBe('2026-10-25');
    expect(todayInParis(clockAt('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });

  it('utilise l’horloge système par défaut', () => {
    expect(isCalendarDate(todayInParis())).toBe(true);
    expect(parisDateOf(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
});

describe('addCalendarDays', () => {
  it('calcule J+30 à travers le passage à l’heure d’été de mars', () => {
    expect(addCalendarDays('2026-03-10', 30)).toBe('2026-04-09');
    expect(addCalendarDays('2026-03-29', 30)).toBe('2026-04-28');
    expect(addCalendarDays(todayInParis(clockAt('2026-03-28T23:30:00Z')), 30)).toBe('2026-04-28');
  });

  it('calcule J+30 à travers le passage à l’heure d’hiver d’octobre', () => {
    expect(addCalendarDays('2026-10-01', 30)).toBe('2026-10-31');
    expect(addCalendarDays('2026-10-10', 30)).toBe('2026-11-09');
    expect(addCalendarDays(todayInParis(clockAt('2026-10-24T22:30:00Z')), 30)).toBe('2026-11-24');
  });

  it('gère fins de mois, années bissextiles et changement d’année', () => {
    expect(addCalendarDays('2028-02-15', 30)).toBe('2028-03-16');
    expect(addCalendarDays('2026-02-15', 30)).toBe('2026-03-17');
    expect(addCalendarDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addCalendarDays('2026-03-01', 0)).toBe('2026-03-01');
  });

  it('rejette une date ou un nombre de jours invalide', () => {
    expect(() => addCalendarDays('2026-02-30', 30)).toThrow(RangeError);
    expect(() => addCalendarDays('2026-4-1', 30)).toThrow(RangeError);
    expect(() => addCalendarDays("'; DROP TABLE books;--", 30)).toThrow(RangeError);
    expect(() => addCalendarDays('2026-04-01', 1.5)).toThrow(RangeError);
  });
});

describe('subtractCalendarYear', () => {
  it('rend le même jour de l’année précédente', () => {
    expect(subtractCalendarYear('2026-09-18')).toBe('2025-09-18');
    expect(subtractCalendarYear('2026-01-01')).toBe('2025-01-01');
    expect(subtractCalendarYear('2026-12-31')).toBe('2025-12-31');
  });

  it('ramène un 29 février au 28 février', () => {
    expect(subtractCalendarYear('2028-02-29')).toBe('2027-02-28');
    expect(subtractCalendarYear('2028-02-28')).toBe('2027-02-28');
    expect(subtractCalendarYear('2028-03-01')).toBe('2027-03-01');
  });

  it('garde le 28 février quand l’année d’arrivée est bissextile', () => {
    expect(subtractCalendarYear('2029-02-28')).toBe('2028-02-28');
    expect(subtractCalendarYear('2029-03-01')).toBe('2028-03-01');
  });

  it('part de la date de Paris, changement d’heure compris', () => {
    // 22 h 30 UTC le 31 mars : déjà le 1er avril à Paris (heure d'été).
    expect(subtractCalendarYear(todayInParis(clockAt('2026-03-31T22:30:00Z')))).toBe('2025-04-01');
    expect(subtractCalendarYear(todayInParis(clockAt('2026-10-25T23:00:00Z')))).toBe('2025-10-26');
  });

  it('rejette une date mal formée ou inexistante', () => {
    expect(() => subtractCalendarYear('2026-02-30')).toThrow(RangeError);
    expect(() => subtractCalendarYear('2026-4-1')).toThrow(RangeError);
    expect(() => subtractCalendarYear("'; DROP TABLE security_events;--")).toThrow(RangeError);
  });
});

describe('startOfDayInParis', () => {
  it('place minuit à 23 h UTC la veille en heure d’hiver', () => {
    expect(startOfDayInParis('2026-01-15')).toBe(Date.parse('2026-01-14T23:00:00Z'));
    expect(startOfDayInParis('2027-02-28')).toBe(Date.parse('2027-02-27T23:00:00Z'));
  });

  it('place minuit à 22 h UTC la veille en heure d’été', () => {
    expect(startOfDayInParis('2026-07-15')).toBe(Date.parse('2026-07-14T22:00:00Z'));
    expect(startOfDayInParis('2026-04-01')).toBe(Date.parse('2026-03-31T22:00:00Z'));
  });

  it('suit le changement d’heure de mars et celui d’octobre', () => {
    // Le 29 mars 2026 commence encore en heure d'hiver : le décalage change à 2 h.
    expect(startOfDayInParis('2026-03-29')).toBe(Date.parse('2026-03-28T23:00:00Z'));
    expect(startOfDayInParis('2026-03-30')).toBe(Date.parse('2026-03-29T22:00:00Z'));
    // Le 25 octobre 2026 commence encore en heure d'été.
    expect(startOfDayInParis('2026-10-25')).toBe(Date.parse('2026-10-24T22:00:00Z'));
    expect(startOfDayInParis('2026-10-26')).toBe(Date.parse('2026-10-25T23:00:00Z'));
  });

  it('donne le premier instant de la journée à Paris, la milliseconde d’avant appartenant à la veille', () => {
    const dates = ['2026-01-15', '2026-03-29', '2026-07-15', '2026-10-25', '2028-02-29'];
    for (const date of dates) {
      const start = startOfDayInParis(date);
      expect(parisDateOf(new Date(start))).toBe(date);
      expect(parisDateOf(new Date(start - 1))).toBe(addCalendarDays(date, -1));
    }
  });

  it('rejette une date mal formée ou inexistante', () => {
    expect(() => startOfDayInParis('2026-02-29')).toThrow(RangeError);
    expect(() => startOfDayInParis('15/01/2026')).toThrow(RangeError);
  });
});

describe('isOverdue', () => {
  it('le jour de l’échéance, le prêt n’est pas en retard', () => {
    expect(isOverdue('2026-04-09', '2026-04-09')).toBe(false);
  });

  it('dès le lendemain de l’échéance, le prêt est en retard', () => {
    expect(isOverdue('2026-04-09', '2026-04-10')).toBe(true);
    expect(isOverdue('2026-12-31', '2027-01-01')).toBe(true);
  });

  it('avant l’échéance, le prêt n’est pas en retard', () => {
    expect(isOverdue('2026-04-09', '2026-04-08')).toBe(false);
    expect(isOverdue('2027-01-01', '2026-12-31')).toBe(false);
  });

  it('se fonde sur la date de Paris et non sur la date UTC', () => {
    // 22:30 UTC le 9 avril = 00:30 le 10 avril à Paris.
    expect(isOverdue('2026-04-09', todayInParis(clockAt('2026-04-09T21:59:59Z')))).toBe(false);
    expect(isOverdue('2026-04-09', todayInParis(clockAt('2026-04-09T22:30:00Z')))).toBe(true);
  });

  it('rejette des dates mal formées', () => {
    expect(() => isOverdue('09/04/2026', '2026-04-10')).toThrow(RangeError);
    expect(() => isOverdue('2026-04-09', 'demain')).toThrow(RangeError);
  });
});

describe('isCalendarDate', () => {
  it('reconnaît seulement les dates AAAA-MM-JJ existantes', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-04-01T00:00:00Z')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });
});

describe('formatDateFr', () => {
  it('formate une date calendaire en toutes lettres sans décalage de fuseau', () => {
    expect(formatDateFr('2026-10-14')).toBe('14 octobre 2026');
    expect(formatDateFr('2026-04-01')).toBe('1 avril 2026');
    expect(formatDateFr('2026-12-31')).toBe('31 décembre 2026');
  });
});
