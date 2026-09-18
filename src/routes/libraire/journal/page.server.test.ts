import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '$lib/server/auth';
import { BOOKSELLER_ONLY_MESSAGE } from '$lib/server/catalogue';
import type { Clock } from '$lib/server/dates';
import { closeDb, getDb } from '$lib/server/db';
import {
  SECURITY_EVENT_LABELS,
  SECURITY_EVENT_LIST_LIMIT,
  recordSecurityEvent,
  type SecurityEventInput
} from '$lib/server/security-log';
import * as journalPageServer from './+page.server';
import JournalPage from './+page.svelte';

const { load } = journalPageServer;

type JournalEntry = {
  id: number;
  label: string;
  when: { iso: string; label: string };
  userName: string | null;
  subject: string | null;
};
type JournalData = { events: JournalEntry[]; limit: number };

const HOSTILE_SUBJECT = '<script>alert(1)</script>@example.com';
const HOSTILE_DISPLAY_NAME = '"><img src=x onerror=alert(1)>';

// 18 septembre 2026, 12 h UTC = 14 h à Paris (heure d'été).
const SUMMER = Date.UTC(2026, 8, 18, 12, 0, 0);
// 5 janvier 2026, 23 h 30 UTC = 6 janvier, 0 h 30 à Paris (heure d'hiver).
const WINTER = Date.UTC(2026, 0, 5, 23, 30, 0);

const clockAt =
  (instant: number): Clock =>
  () =>
    new Date(instant);

function insertUser(email: string, role: Role, displayName = `Compte ${role}`): AuthUser {
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, role, created_at)
       VALUES (?, ?, 'hash-factice', ?, 0)`
    )
    .run(email, displayName, role);
  return { id: Number(result.lastInsertRowid), email, displayName, role };
}

function bookseller(): AuthUser {
  return insertUser('libraire@example.fr', 'bookseller', 'Camille Roy');
}

function borrower(): AuthUser {
  return insertUser('lecteur@example.fr', 'borrower', 'Léa Berthier');
}

function logEvent(event: SecurityEventInput, instant: number): void {
  recordSecurityEvent(getDb(), event, clockAt(instant));
}

function eventCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS total FROM security_events').get() as {
    total: number;
  };
  return row.total;
}

/** Exécute le load et capture la redirection ou l'erreur HTTP levée. */
async function outcomeOf(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (thrown) {
    if (isRedirect(thrown) || isHttpError(thrown)) return thrown;
    throw thrown;
  }
}

function loadAs(user: AuthUser | null, search = ''): Promise<unknown> {
  const url = new URL(`http://localhost/libraire/journal${search}`);
  return outcomeOf(() => load({ url, locals: { user } } as unknown as Parameters<typeof load>[0]));
}

async function journalData(user: AuthUser, search = ''): Promise<JournalData> {
  return (await loadAs(user, search)) as JournalData;
}

function renderJournal(data: JournalData): string {
  return render(JournalPage, { props: { data } as never }).body;
}

afterEach(() => {
  closeDb();
});

describe('autorisation de /libraire/journal', () => {
  it('redirige un anonyme vers /connexion sans rien lire', async () => {
    const outcome = await loadAs(null);

    if (!isRedirect(outcome)) throw new Error('Redirection attendue.');
    expect(outcome.status).toBe(303);
    expect(outcome.location).toBe('/connexion');
  });

  it('refuse un emprunteur connecté (403) avec le message réservé au libraire', async () => {
    const reader = borrower();

    const outcome = await loadAs(reader);

    if (!isHttpError(outcome)) throw new Error('Erreur HTTP attendue.');
    expect(outcome.status).toBe(403);
    expect(outcome.body.message).toBe(BOOKSELLER_ONLY_MESSAGE);
  });

  it('n’exporte aucune action : la route est en lecture seule', () => {
    // Sans export `actions`, SvelteKit refuse tout POST vers /libraire/journal.
    for (const name of ['actions', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(journalPageServer).not.toHaveProperty(name);
    }
    expect(journalPageServer).toHaveProperty('load');

    const source = readFileSync(
      fileURLToPath(new URL('./+page.server.ts', import.meta.url)),
      'utf8'
    );
    expect(source).not.toMatch(/export\s+const\s+actions/);
  });

  it('ignore les paramètres d’URL et n’écrit rien', async () => {
    const seller = bookseller();
    logEvent({ type: 'login_success', userId: seller.id, subject: seller.email }, SUMMER);
    logEvent({ type: 'login_failure', subject: 'inconnu@example.fr' }, WINTER);

    const plain = await journalData(seller);
    const filtered = await journalData(
      seller,
      `?limit=1&type=login_success&userId=${seller.id}&q=Camille`
    );

    expect(filtered).toEqual(plain);
    expect(filtered.events).toHaveLength(2);
    expect(eventCount()).toBe(2);
  });
});

describe('load /libraire/journal', () => {
  it('rend les derniers événements, du plus récent au plus ancien, en heure de Paris', async () => {
    const seller = bookseller();
    logEvent({ type: 'login_failure', subject: 'inconnu@example.fr' }, WINTER);
    logEvent({ type: 'login_success', userId: seller.id, subject: seller.email }, SUMMER);

    const data = await journalData(seller);

    expect(data.limit).toBe(SECURITY_EVENT_LIST_LIMIT);
    expect(data.events).toEqual([
      {
        id: expect.any(Number),
        label: SECURITY_EVENT_LABELS.login_success,
        // Heure d'été : 12 h UTC affichée 14 h à Paris.
        when: { iso: '2026-09-18T12:00:00.000Z', label: '18/09/2026 à 14:00' },
        userName: 'Camille Roy',
        subject: 'libraire@example.fr'
      },
      {
        id: expect.any(Number),
        label: SECURITY_EVENT_LABELS.login_failure,
        // Heure d'hiver : 23 h 30 UTC bascule au lendemain à Paris.
        when: { iso: '2026-01-05T23:30:00.000Z', label: '06/01/2026 à 00:30' },
        userName: null,
        subject: 'inconnu@example.fr'
      }
    ]);
  });

  it('renvoie une liste vide quand aucun événement n’a été enregistré', async () => {
    const seller = bookseller();

    const data = await journalData(seller);

    expect(data.events).toEqual([]);
  });
});

describe('rendu de /libraire/journal', () => {
  it('affiche les lignes dans la table .data, sans jamais interpréter le contenu stocké', async () => {
    const seller = bookseller();
    const hostile = insertUser('hostile@example.fr', 'borrower', HOSTILE_DISPLAY_NAME);
    logEvent({ type: 'access_denied', userId: hostile.id, subject: '/libraire/vente' }, WINTER);
    logEvent({ type: 'login_failure', subject: HOSTILE_SUBJECT }, SUMMER);
    logEvent({ type: 'signup', userId: seller.id }, SUMMER - 1000);

    const data = await journalData(seller);
    const body = renderJournal(data);

    expect(body).toContain('Journal de sécurité');
    expect(body).toContain(`Les ${SECURITY_EVENT_LIST_LIMIT} derniers événements`);
    expect(body).toMatch(/class="data data--stack journal[^"]*"/);
    expect(body).toContain(SECURITY_EVENT_LABELS.access_denied);
    expect(body).toContain(SECURITY_EVENT_LABELS.login_failure);
    expect(body).toContain(SECURITY_EVENT_LABELS.signup);
    expect(body).toContain('18/09/2026 à 14:00');
    expect(body).toContain('datetime="2026-09-18T12:00:00.000Z"');
    expect(body).toContain('/libraire/vente');

    // Contenu hostile : présent comme texte, jamais comme balisage.
    expect(body).not.toContain('<script');
    expect(body).not.toContain('<img');
    expect(body).toMatch(/&lt;script(>|&gt;)alert\(1\)&lt;\/script(>|&gt;)/);
    expect(body).toMatch(/&lt;img src=x onerror=alert\(1\)(>|&gt;)/);

    // Événement sans compte ni détail : tiret visible doublé d'un texte lu à voix haute.
    expect(body).toContain('Aucun compte');
    expect(body).toContain('Aucun détail');
  });

  it('affiche l’état vide .empty plutôt qu’une table sans ligne', () => {
    const body = renderJournal({ events: [], limit: SECURITY_EVENT_LIST_LIMIT });

    expect(body).toMatch(/class="empty[\s"]/);
    expect(body).toContain('Aucun événement enregistré.');
    expect(body).not.toContain('<table');
  });

  it('n’ajoute ni {@html}, ni famille de polices, ni jeton', () => {
    const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8');

    expect(source).not.toContain('{@html');
    expect(source).not.toContain('@font-face');
    // Les polices et les couleurs viennent des jetons d'app.css, jamais d'une valeur littérale.
    expect(source).not.toMatch(/font-family:(?!\s*var\(--sans\))/);
    expect(source).not.toMatch(/^\s*--[\w-]+:/m);
  });
});

describe('navigation libraire', () => {
  it('porte le lien « Journal » avec aria-current sur la page courante', () => {
    const layout = readFileSync(
      fileURLToPath(new URL('../../+layout.svelte', import.meta.url)),
      'utf8'
    );

    expect(layout).toContain(
      '<a href="/libraire/journal" aria-current={current(\'/libraire/journal\')}>Journal</a>'
    );
  });
});
