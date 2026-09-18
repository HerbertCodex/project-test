import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  createBookseller,
  createBorrower,
  createSession,
  deleteSession
} from '$lib/server/auth';
import { BOOKSELLER_ONLY_MESSAGE } from '$lib/server/catalogue';
import { closeDb, getDb, type Db } from '$lib/server/db';
import { BORROWER_ONLY_MESSAGE } from '$lib/server/loans';
import {
  SECURITY_EVENT_LABELS,
  SECURITY_SUBJECT_MAX_LENGTH,
  listRecentSecurityEvents
} from '$lib/server/security-log';
import config from '../svelte.config.js';
import { handle, init } from './hooks.server';

const EXPECTED_TABLES = [
  'books',
  'loans',
  'login_failures',
  'sales',
  'security_events',
  'sessions',
  'users'
];

function fakeEvent(cookies: Record<string, string> = {}, path = '/') {
  const cookieJar = {
    get: vi.fn((name: string) => cookies[name]),
    delete: vi.fn()
  };
  const event = {
    cookies: cookieJar,
    locals: {},
    url: new URL(path, 'http://localhost')
  } as unknown as RequestEvent;
  return { event, cookieJar };
}

async function borrowerSessionToken(createdAt = new Date()): Promise<string> {
  const created = await createBorrower(getDb(), {
    email: 'lecteur@example.fr',
    displayName: 'Lecteur',
    password: 'mot de passe solide'
  });
  if (!created.ok) throw new Error('compte de test non créé');
  return createSession(getDb(), created.user.id, () => createdAt).token;
}

async function booksellerSessionToken(): Promise<string> {
  const created = await createBookseller(getDb(), {
    email: 'libraire@example.fr',
    displayName: 'Libraire',
    password: 'mot de passe solide'
  });
  if (!created.ok) throw new Error('compte de test non créé');
  return createSession(getDb(), created.user.id).token;
}

/** Colonnes brutes des événements, pour vérifier ce qui est réellement stocké. */
function storedEventColumns(): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM security_events ORDER BY id').all() as Record<
    string,
    unknown
  >[];
}

function tableNames(): string[] {
  return (
    getDb()
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

const forbidden = (message: string) => new Response(message, { status: 403 });

/**
 * Charge une copie neuve de `./hooks.server` avec un module de rétention doublé,
 * seule façon d'observer ce que fait le chargement du module lui-même, séparément
 * de l'appel explicite à `init`. La copie a son propre graphe de modules, donc sa
 * propre connexion, que `close` referme.
 */
async function loadHooksModule(purge: (db: Db) => void = () => {}) {
  vi.resetModules();
  const runRetentionPurgesSafely = vi.fn((db: Db, failureMessage: string) => {
    try {
      purge(db);
    } catch {
      console.error(failureMessage);
    }
  });
  vi.doMock('$lib/server/retention', () => ({ runRetentionPurgesSafely }));

  const { handle: freshHandle, init: freshInit } = await import('./hooks.server');
  const { closeDb: closeFresh, getDb: freshDb } = await import('$lib/server/db');
  return {
    handle: freshHandle,
    init: freshInit,
    runRetentionPurgesSafely,
    db: freshDb(),
    close: closeFresh
  };
}

afterEach(() => {
  closeDb();
});

describe('handle', () => {
  it('ajoute les en-têtes de sécurité à la réponse', async () => {
    const { event } = fakeEvent();
    const response = await handle({ event, resolve: async () => new Response('ok') });

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it("n'écrase pas un en-tête déjà défini par la route", async () => {
    const { event } = fakeEvent();
    const response = await handle({
      event,
      resolve: async () => new Response('ok', { headers: { 'referrer-policy': 'no-referrer' } })
    });

    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('laisse un visiteur sans cookie anonyme', async () => {
    const { event, cookieJar } = fakeEvent();
    await handle({ event, resolve: async () => new Response('ok') });

    expect(event.locals.user).toBeNull();
    expect(cookieJar.delete).not.toHaveBeenCalled();
  });

  it('charge l’utilisateur d’une session valide avant la route et garde les en-têtes', async () => {
    const token = await borrowerSessionToken();
    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token });

    let userSeenByRoute: App.Locals['user'] | undefined;
    const response = await handle({
      event,
      resolve: async (resolved) => {
        userSeenByRoute = resolved.locals.user;
        return new Response('ok');
      }
    });

    expect(userSeenByRoute).toEqual({
      id: expect.any(Number),
      email: 'lecteur@example.fr',
      displayName: 'Lecteur',
      role: 'borrower'
    });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('traite un cookie inconnu ou altéré comme anonyme et l’efface', async () => {
    const token = await borrowerSessionToken();
    const altered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    for (const value of [altered, 'inconnu', `${token}x`]) {
      const { event, cookieJar } = fakeEvent({ [SESSION_COOKIE_NAME]: value });
      await handle({ event, resolve: async () => new Response('ok') });

      expect(event.locals.user).toBeNull();
      expect(cookieJar.delete).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        expect.objectContaining({ path: '/' })
      );
    }
  });

  it('refuse un cookie réutilisé après déconnexion', async () => {
    const token = await borrowerSessionToken();
    deleteSession(getDb(), token);

    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token });
    await handle({ event, resolve: async () => new Response('ok') });

    expect(event.locals.user).toBeNull();
  });

  it('refuse une session expirée', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const token = await borrowerSessionToken(eightDaysAgo);

    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token });
    await handle({ event, resolve: async () => new Response('ok') });

    expect(event.locals.user).toBeNull();
  });
});

describe('purges de rétention au hook init', () => {
  let closeFreshDb: (() => void) | undefined;

  afterEach(() => {
    closeFreshDb?.();
    closeFreshDb = undefined;
    vi.doUnmock('$lib/server/retention');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("n'exécute aucune purge à la simple évaluation du module", async () => {
    const loaded = await loadHooksModule();
    closeFreshDb = loaded.close;

    expect(loaded.runRetentionPurgesSafely).not.toHaveBeenCalled();
  });

  it('exécute les purges sur la base de l’application quand `init` est appelé', async () => {
    const loaded = await loadHooksModule();
    closeFreshDb = loaded.close;

    await loaded.init();

    expect(loaded.runRetentionPurgesSafely).toHaveBeenCalledTimes(1);
    // La base purgée est bien la connexion partagée que le hook utilise ensuite.
    expect(loaded.runRetentionPurgesSafely.mock.calls[0][0]).toBe(loaded.db);
  });

  it('ne relance pas les purges aux requêtes suivantes', async () => {
    const loaded = await loadHooksModule();
    closeFreshDb = loaded.close;

    await loaded.init();

    for (const path of ['/', '/mes-prets', '/libraire/vente']) {
      const { event } = fakeEvent({}, path);
      const response = await loaded.handle({ event, resolve: async () => new Response('ok') });

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }

    expect(loaded.runRetentionPurgesSafely).toHaveBeenCalledTimes(1);
  });

  it('répond malgré un échec de purge au démarrage, sans divulguer l’erreur', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = "SELECT password_hash FROM users; échec de purge illisible pour l'exploitant";
    const loaded = await loadHooksModule(() => {
      throw new Error(failure);
    });
    closeFreshDb = loaded.close;

    await loaded.init();

    const { event } = fakeEvent();
    const response = await loaded.handle({ event, resolve: async () => new Response('ok') });

    expect(loaded.runRetentionPurgesSafely).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(event.locals.user).toBeNull();
    // L'échec est signalé à l'exploitant, mais sans SQL ni pile.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls.flat().map(String).join(' ')).not.toContain(failure);
  });
});

describe('journalisation des refus d’accès', () => {
  it('journalise la 403 rendue à un emprunteur sur /libraire/** une seule fois', async () => {
    const token = await borrowerSessionToken();
    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token }, '/libraire/vente');

    const response = await handle({
      event,
      resolve: async () => forbidden(BOOKSELLER_ONLY_MESSAGE)
    });

    expect(response.status).toBe(403);
    expect(event.locals.user).not.toBeNull();
    expect(listRecentSecurityEvents(getDb()).items).toEqual([
      {
        id: expect.any(Number),
        createdAt: expect.any(Number),
        type: 'access_denied',
        label: SECURITY_EVENT_LABELS.access_denied,
        userId: event.locals.user?.id,
        userName: 'Lecteur',
        subject: '/libraire/vente'
      }
    ]);
  });

  it('journalise la 403 rendue au libraire sur /mes-prets avec l’identifiant de sa session', async () => {
    const token = await booksellerSessionToken();
    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token }, '/mes-prets');

    await handle({ event, resolve: async () => forbidden(BORROWER_ONLY_MESSAGE) });

    expect(event.locals.user).not.toBeNull();
    expect(listRecentSecurityEvents(getDb()).items).toMatchObject([
      {
        type: 'access_denied',
        userId: event.locals.user?.id,
        userName: 'Libraire',
        subject: '/mes-prets'
      }
    ]);
  });

  it('ne journalise rien pour un visiteur anonyme redirigé vers /connexion', async () => {
    const { event } = fakeEvent({}, '/libraire/vente');

    const response = await handle({
      event,
      resolve: async () => new Response(null, { status: 303, headers: { location: '/connexion' } })
    });

    expect(response.status).toBe(303);
    expect(event.locals.user).toBeNull();
    expect(storedEventColumns()).toEqual([]);
  });

  it('ne journalise rien pour une 403 sans utilisateur de session', async () => {
    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: 'inconnu' }, '/libraire/vente');

    await handle({ event, resolve: async () => forbidden(BOOKSELLER_ONLY_MESSAGE) });

    expect(event.locals.user).toBeNull();
    expect(storedEventColumns()).toEqual([]);
  });

  it.each([200, 204, 302, 400, 401, 404, 500])(
    'ne journalise rien pour le statut %i rendu à un utilisateur connecté',
    async (status) => {
      const token = await borrowerSessionToken();
      const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token }, '/libraire/vente');

      await handle({
        event,
        resolve: async () => new Response(status === 204 ? null : 'corps', { status })
      });

      expect(event.locals.user).not.toBeNull();
      expect(storedEventColumns()).toEqual([]);
    }
  );

  it.each([
    "/libraire/livres/1'; DROP TABLE security_events;--",
    '/libraire/<script>alert(1)</script>'
  ])('stocke littéralement le chemin hostile %s sans l’interpréter', async (path) => {
    const token = await borrowerSessionToken();
    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token }, path);

    await handle({ event, resolve: async () => forbidden(BOOKSELLER_ONLY_MESSAGE) });

    const [stored] = storedEventColumns();
    // Le chemin est stocké tel que SvelteKit le présente, encodage d'URL compris.
    expect(stored.subject).toBe(event.url.pathname);
    expect(decodeURIComponent(String(stored.subject))).toBe(path);
    expect(tableNames()).toEqual(EXPECTED_TABLES);
  });

  it('borne le chemin journalisé à la longueur maximale du sujet', async () => {
    const token = await borrowerSessionToken();
    const path = `/libraire/${'a'.repeat(2 * SECURITY_SUBJECT_MAX_LENGTH)}`;
    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token }, path);

    await handle({ event, resolve: async () => forbidden(BOOKSELLER_ONLY_MESSAGE) });

    const [stored] = storedEventColumns();
    expect(stored.subject).toBe(path.slice(0, SECURITY_SUBJECT_MAX_LENGTH));
  });

  it('n’écrit aucun secret dans les colonnes de l’événement', async () => {
    const token = await borrowerSessionToken();
    const { event } = fakeEvent({ [SESSION_COOKIE_NAME]: token }, '/libraire/vente');

    await handle({ event, resolve: async () => forbidden(BOOKSELLER_ONLY_MESSAGE) });

    const [stored] = storedEventColumns();
    expect(Object.keys(stored).sort()).toEqual(['created_at', 'id', 'subject', 'type', 'user_id']);
    expect(Number.isInteger(stored.created_at)).toBe(true);

    const hash = getDb().prepare('SELECT password_hash FROM users LIMIT 1').get() as {
      password_hash: string;
    };
    const written = Object.values(stored).map(String).join(' ');
    for (const secret of [token, hash.password_hash, 'mot de passe solide', '$argon2']) {
      expect(written).not.toContain(secret);
    }
  });
});

describe('CSP de svelte.config.js', () => {
  it('conserve les directives restrictives existantes', () => {
    expect(config.kit?.csp?.mode).toBe('auto');
    expect(config.kit?.csp?.directives).toMatchObject({
      'script-src': ['self'],
      'object-src': ['none'],
      'base-uri': ['self'],
      'form-action': ['self']
    });
  });
});
