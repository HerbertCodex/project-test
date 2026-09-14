import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';

const event = {} as RequestEvent;

describe('handle', () => {
  it('ajoute les en-têtes de sécurité à la réponse', async () => {
    const response = await handle({ event, resolve: async () => new Response('ok') });

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it("n'écrase pas un en-tête déjà défini par la route", async () => {
    const response = await handle({
      event,
      resolve: async () => new Response('ok', { headers: { 'referrer-policy': 'no-referrer' } })
    });

    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});
