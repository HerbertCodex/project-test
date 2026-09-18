import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startOfDayInParis, type Clock } from '../dates';
import { IN_MEMORY_DATABASE_PATH, openDatabase, type Db } from '../db';
import { DEFAULT_PAGE_SIZE } from '../pagination';
import {
  SECURITY_EVENT_LABELS,
  SECURITY_EVENT_TYPES,
  SECURITY_SUBJECT_MAX_LENGTH,
  listRecentSecurityEvents,
  normalizeSecuritySubject,
  purgeSecurityEvents,
  recordSecurityEvent,
  securityLogRetentionStart,
  type SecurityEventType
} from '.';

const SQL_PAYLOAD = "'; DROP TABLE security_events;--";
const EXPECTED_TABLES = [
  'books',
  'loans',
  'login_failures',
  'sales',
  'security_events',
  'sessions',
  'users'
];

/** NUL et échappement ANSI, construits par code pour rester lisibles ici. */
const NUL = String.fromCharCode(0);
const ANSI_ESCAPE = String.fromCharCode(27);

// 18 septembre 2026, 12 h UTC = 14 h à Paris (heure d'été).
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const clockAt =
  (instant: number): Clock =>
  () =>
    new Date(instant);
const clock = clockAt(NOW);

let db: Db;

function createUser(email: string, displayName: string): number {
  const inserted = db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, 'hash-factice', 'borrower', 0)`
    )
    .run(email, displayName);
  return Number(inserted.lastInsertRowid);
}

type StoredEvent = {
  created_at: number;
  type: string;
  user_id: number | null;
  subject: string | null;
};

function storedEvents(): StoredEvent[] {
  return db
    .prepare('SELECT created_at, type, user_id, subject FROM security_events ORDER BY id')
    .all() as StoredEvent[];
}

function tableNames(): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

beforeEach(() => {
  db = openDatabase(IN_MEMORY_DATABASE_PATH);
});

afterEach(() => {
  db.close();
});

describe('recordSecurityEvent', () => {
  it('accepte chaque type de la liste fermée, comme le CHECK de la table', () => {
    for (const type of SECURITY_EVENT_TYPES) {
      recordSecurityEvent(db, { type }, clock);
    }

    expect(storedEvents().map((event) => event.type)).toEqual([...SECURITY_EVENT_TYPES]);
    expect(Object.keys(SECURITY_EVENT_LABELS).sort()).toEqual([...SECURITY_EVENT_TYPES].sort());
  });

  it('enregistre un échec sans compte avec l’e-mail tenté', () => {
    recordSecurityEvent(db, { type: 'login_failure', subject: 'inconnu@example.fr' }, clock);

    expect(storedEvents()).toEqual([
      { created_at: NOW, type: 'login_failure', user_id: null, subject: 'inconnu@example.fr' }
    ]);
  });

  it('date l’événement de l’horloge fournie, en millisecondes entières', () => {
    recordSecurityEvent(db, { type: 'signup' }, clockAt(NOW + 1));

    const [event] = storedEvents();
    expect(event.created_at).toBe(NOW + 1);
    expect(Number.isSafeInteger(event.created_at)).toBe(true);
  });

  it('refuse un type hors de la liste fermée sans rien écrire', () => {
    const refused = ['root_access', SQL_PAYLOAD, '', undefined, 42];
    for (const type of refused) {
      expect(() =>
        recordSecurityEvent(db, { type: type as unknown as SecurityEventType }, clock)
      ).toThrow(RangeError);
    }

    expect(storedEvents()).toEqual([]);
  });

  it('le CHECK de la table refuse aussi un type inconnu inséré directement', () => {
    expect(() =>
      db
        .prepare('INSERT INTO security_events (created_at, type, subject) VALUES (?, ?, ?)')
        .run(NOW, 'root_access', null)
    ).toThrow();

    expect(storedEvents()).toEqual([]);
  });

  it('refuse un identifiant de compte qui n’est pas un entier', () => {
    expect(() => recordSecurityEvent(db, { type: 'login_success', userId: 1.5 }, clock)).toThrow(
      RangeError
    );
    expect(storedEvents()).toEqual([]);
  });

  it('retire les caractères de contrôle du sujet et conserve le reste littéralement', () => {
    const hostile = `  a${NUL}b\nc\td${ANSI_ESCAPE}[31m  `;
    recordSecurityEvent(db, { type: 'login_failure', subject: hostile }, clock);
    recordSecurityEvent(db, { type: 'access_denied', subject: '<script>alert(1)</script>' }, clock);
    recordSecurityEvent(db, { type: 'login_failure', subject: SQL_PAYLOAD }, clock);

    expect(storedEvents().map((event) => event.subject)).toEqual([
      'abcd[31m',
      '<script>alert(1)</script>',
      SQL_PAYLOAD
    ]);
    expect(tableNames()).toEqual(EXPECTED_TABLES);
  });

  it('borne un sujet trop long à la longueur acceptée par le schéma', () => {
    const subject = `${'x'.repeat(SECURITY_SUBJECT_MAX_LENGTH)}débordement`;
    recordSecurityEvent(db, { type: 'access_denied', subject }, clock);

    const [event] = storedEvents();
    expect(event.subject).toBe('x'.repeat(SECURITY_SUBJECT_MAX_LENGTH));
    expect(event.subject?.length).toBe(SECURITY_SUBJECT_MAX_LENGTH);
  });

  it('traite un sujet absent, vide ou fait de caractères de contrôle comme absent', () => {
    recordSecurityEvent(db, { type: 'signup' }, clock);
    recordSecurityEvent(db, { type: 'signup', subject: '   ' }, clock);
    recordSecurityEvent(db, { type: 'signup', subject: `${NUL}${ANSI_ESCAPE}` }, clock);
    recordSecurityEvent(db, { type: 'signup', subject: null }, clock);

    expect(storedEvents().map((event) => event.subject)).toEqual([null, null, null, null]);
    expect(normalizeSecuritySubject(undefined)).toBeNull();
  });
});

describe('listRecentSecurityEvents', () => {
  it('rend les événements du plus récent au plus ancien', () => {
    recordSecurityEvent(db, { type: 'login_failure', subject: 'un@example.fr' }, clockAt(NOW));
    recordSecurityEvent(db, { type: 'lockout_started', subject: 'un@example.fr' }, clockAt(NOW + 2));
    recordSecurityEvent(db, { type: 'signup', subject: 'deux@example.fr' }, clockAt(NOW + 1));

    expect(listRecentSecurityEvents(db).items.map((event) => event.type)).toEqual([
      'lockout_started',
      'signup',
      'login_failure'
    ]);
  });

  it('pagine à DEFAULT_PAGE_SIZE événements par page, sans limite fixe totale', () => {
    const total = DEFAULT_PAGE_SIZE * 4 + 5;
    for (let index = 0; index < total; index++) {
      recordSecurityEvent(db, { type: 'login_failure', subject: `n${index}` }, clockAt(NOW + index));
    }

    const firstPage = listRecentSecurityEvents(db, 1);
    expect(firstPage.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(firstPage.items[0].subject).toBe(`n${total - 1}`);
    expect(firstPage.totalItems).toBe(total);
    expect(firstPage.totalPages).toBe(Math.ceil(total / DEFAULT_PAGE_SIZE));

    // Au-delà de l'ancienne limite fixe de 100 : la page 5 (indices 100-104) reste accessible.
    const lastPage = listRecentSecurityEvents(db, firstPage.totalPages);
    expect(lastPage.items).toHaveLength(5);
    expect(lastPage.items[lastPage.items.length - 1].subject).toBe('n0');
    expect(storedEvents()).toHaveLength(total);
  });

  it('borne silencieusement une page invalide ou hors bornes', () => {
    for (let index = 0; index < DEFAULT_PAGE_SIZE + 5; index++) {
      recordSecurityEvent(db, { type: 'login_failure', subject: `n${index}` }, clockAt(NOW + index));
    }

    expect(listRecentSecurityEvents(db, 0).page).toBe(1);
    expect(listRecentSecurityEvents(db, -1).page).toBe(1);
    expect(listRecentSecurityEvents(db, 1.5).page).toBe(1);
    expect(listRecentSecurityEvents(db, 999).page).toBe(2);
  });

  it('joint le nom affiché du compte et le libellé français du type', () => {
    const userId = createUser('lea@example.fr', 'Léa Moreau');
    recordSecurityEvent(db, { type: 'login_success', userId, subject: 'lea@example.fr' }, clock);

    expect(listRecentSecurityEvents(db).items).toEqual([
      {
        id: expect.any(Number),
        createdAt: NOW,
        type: 'login_success',
        label: SECURITY_EVENT_LABELS.login_success,
        userId,
        userName: 'Léa Moreau',
        subject: 'lea@example.fr'
      }
    ]);
  });

  it('rend un événement sans compte avec un nom affiché nul', () => {
    recordSecurityEvent(db, { type: 'login_failure', subject: 'inconnu@example.fr' }, clock);

    const [event] = listRecentSecurityEvents(db).items;
    expect(event.userId).toBeNull();
    expect(event.userName).toBeNull();
    expect(event.subject).toBe('inconnu@example.fr');
  });

  it('conserve l’événement et remet user_id à null quand le compte est supprimé', () => {
    const userId = createUser('lea@example.fr', 'Léa Moreau');
    recordSecurityEvent(db, { type: 'login_success', userId, subject: 'lea@example.fr' }, clock);

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    const events = listRecentSecurityEvents(db).items;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('login_success');
    expect(events[0].userId).toBeNull();
    expect(events[0].userName).toBeNull();
    expect(storedEvents()[0].user_id).toBeNull();
  });

  it('ne rend rien tant qu’aucun événement n’est journalisé', () => {
    expect(listRecentSecurityEvents(db).items).toEqual([]);
  });
});

describe('securityLogRetentionStart', () => {
  it('rend le début de journée à Paris de la date du jour reculée d’un an', () => {
    expect(securityLogRetentionStart(clock)).toBe(startOfDayInParis('2025-09-18'));
    expect(securityLogRetentionStart(clock)).toBe(Date.parse('2025-09-17T22:00:00Z'));
  });

  it('ramène une horloge au 29 février à une borne au 28 février', () => {
    const leapDay = clockAt(Date.UTC(2028, 1, 29, 12, 0, 0));
    expect(securityLogRetentionStart(leapDay)).toBe(startOfDayInParis('2027-02-28'));
    expect(securityLogRetentionStart(leapDay)).toBe(Date.parse('2027-02-27T23:00:00Z'));
  });

  it('se fonde sur la date de Paris et non sur la date UTC', () => {
    // 22 h 30 UTC le 31 mars : déjà le 1er avril à Paris (heure d'été).
    const parisTomorrow = clockAt(Date.parse('2026-03-31T22:30:00Z'));
    expect(securityLogRetentionStart(parisTomorrow)).toBe(startOfDayInParis('2025-04-01'));
  });
});

describe('purgeSecurityEvents', () => {
  it('supprime ce qui précède la borne et garde le début de journée exact', () => {
    const start = securityLogRetentionStart(clock);
    recordSecurityEvent(db, { type: 'login_failure', subject: 'avant' }, clockAt(start - 1));
    recordSecurityEvent(db, { type: 'login_failure', subject: 'borne' }, clockAt(start));
    recordSecurityEvent(db, { type: 'login_success', subject: 'après' }, clockAt(start + 1));
    recordSecurityEvent(db, { type: 'signup', subject: 'aujourd’hui' }, clock);

    expect(purgeSecurityEvents(db, clock)).toBe(1);
    expect(storedEvents().map((event) => event.subject)).toEqual(['borne', 'après', 'aujourd’hui']);
  });

  it('supprime les événements des jours précédant la borne et renvoie leur nombre', () => {
    const start = securityLogRetentionStart(clock);
    const oneDay = 24 * 60 * 60 * 1000;
    recordSecurityEvent(db, { type: 'login_failure' }, clockAt(start - oneDay));
    recordSecurityEvent(db, { type: 'login_failure' }, clockAt(start - 2 * oneDay));
    recordSecurityEvent(db, { type: 'login_success' }, clock);

    expect(purgeSecurityEvents(db, clock)).toBe(2);
    expect(storedEvents().map((event) => event.type)).toEqual(['login_success']);
  });

  it('avec une horloge au 29 février, garde le 28 février de l’année précédente', () => {
    const leapDay = clockAt(Date.UTC(2028, 1, 29, 12, 0, 0));
    const start = startOfDayInParis('2027-02-28');
    recordSecurityEvent(db, { type: 'login_failure', subject: '27 février' }, clockAt(start - 1));
    recordSecurityEvent(db, { type: 'login_failure', subject: '28 février' }, clockAt(start));

    expect(purgeSecurityEvents(db, leapDay)).toBe(1);
    expect(storedEvents().map((event) => event.subject)).toEqual(['28 février']);
  });

  it('ne supprime rien quand tout est dans la période de conservation', () => {
    recordSecurityEvent(db, { type: 'login_success' }, clock);

    expect(purgeSecurityEvents(db, clock)).toBe(0);
    expect(purgeSecurityEvents(db, clock)).toBe(0);
    expect(storedEvents()).toHaveLength(1);
  });

  it('ne supprime rien sur un journal vide', () => {
    expect(purgeSecurityEvents(db, clock)).toBe(0);
  });
});
