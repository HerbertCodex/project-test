import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME, createBorrower, createSession, deleteSession } from '$lib/server/auth';
import { closeDb, getDb } from '$lib/server/db';
import config from '../svelte.config.js';
import { handle } from './hooks.server';

function fakeEvent(cookies: Record<string, string> = {}) {
  const cookieJar = {
    get: vi.fn((name: string) => cookies[name]),
    delete: vi.fn()
  };
  const event = { cookies: cookieJar, locals: {} } as unknown as RequestEvent;
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
