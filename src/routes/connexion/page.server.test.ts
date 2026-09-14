import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOGIN_FAILED_MESSAGE,
  SESSION_COOKIE_NAME,
  createBookseller,
  createBorrower,
  createSession,
  hashSessionToken,
  validateSessionToken
} from '$lib/server/auth';
import { closeDb, getDb } from '$lib/server/db';
import { actions as logoutActions, load as logoutLoad } from '../deconnexion/+page.server';
import { actions, load } from './+page.server';

type Failure = { status: number; data: { email: string; message: string } };

const PASSWORD = 'mot de passe solide';
// 14 septembre 2026, 12 h UTC = 14 h à Paris (heure d'été).
const T0 = Date.UTC(2026, 8, 14, 12, 0, 0);

function fakeEvent(path: string, fields: Record<string, string> = {}, jar: Record<string, string> = {}) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const url = new URL(path, 'http://localhost');
  const cookies = {
    get: vi.fn((name: string) => jar[name]),
    set: vi.fn(),
    delete: vi.fn()
  };
  const request = new Request(url, { method: 'POST', body });
  return { event: { request, url, cookies, locals: { user: null } }, cookies };
}

/** Exécute une action ou un load et capture la redirection levée, le cas échéant. */
async function outcomeOf(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (thrown) {
    if (isRedirect(thrown)) return thrown;
    throw thrown;
  }
}

function asFailure(outcome: unknown): Failure {
  if (!isActionFailure(outcome)) throw new Error('Échec d’action attendu.');
  return outcome as unknown as Failure;
}

function asRedirect(outcome: unknown) {
  if (!isRedirect(outcome)) throw new Error('Redirection attendue.');
  return outcome;
}

async function signIn(fields: Record<string, string>, jar: Record<string, string> = {}) {
  const { event, cookies } = fakeEvent('/connexion', fields, jar);
  const outcome = await outcomeOf(() =>
    actions.default(event as unknown as Parameters<typeof actions.default>[0])
  );
  return { outcome, cookies };
}

async function borrowerId(email = 'lecteur@example.fr'): Promise<number> {
  const created = await createBorrower(getDb(), { email, displayName: 'Lecteur', password: PASSWORD });
  if (!created.ok) throw new Error('Compte de test non créé.');
  return created.user.id;
}

afterEach(() => {
  vi.useRealTimers();
  closeDb();
});

describe('load /connexion', () => {
  it('annonce la création du compte seulement si inscription vaut exactement 1', async () => {
    const accountCreated = async (search: string) => {
      const url = new URL(`http://localhost/connexion${search}`);
      const data = await load({ url } as unknown as Parameters<typeof load>[0]);
      return (data as { accountCreated: boolean }).accountCreated;
    };

    expect(await accountCreated('?inscription=1')).toBe(true);
    expect(await accountCreated('')).toBe(false);
    expect(await accountCreated('?inscription=true')).toBe(false);
    expect(await accountCreated('?inscription=1%3Cscript%3E')).toBe(false);
  });
});

describe('action /connexion', () => {
  it('ouvre une session avec un cookie conforme et redirige un emprunteur vers /', async () => {
    await borrowerId();
    const { outcome, cookies } = await signIn({ email: ' Lecteur@Example.fr ', password: PASSWORD });

    const redirect = asRedirect(outcome);
    expect(redirect.status).toBe(303);
    expect(redirect.location).toBe('/');

    expect(cookies.set).toHaveBeenCalledTimes(1);
    const [name, token, options] = cookies.set.mock.calls[0];
    expect(name).toBe(SESSION_COOKIE_NAME);
    expect(options).toEqual({
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 604800
    });

    const stored = getDb().prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(stored).toEqual([{ token_hash: hashSessionToken(token) }]);
    expect(stored[0].token_hash).not.toBe(token);
    expect(validateSessionToken(getDb(), token)?.role).toBe('borrower');
  });

  it('redirige le libraire vers /libraire/retours', async () => {
    await createBookseller(getDb(), {
      email: 'libraire@example.fr',
      displayName: 'Libraire',
      password: PASSWORD
    });

    const { outcome } = await signIn({ email: 'libraire@example.fr', password: PASSWORD });

    expect(asRedirect(outcome).location).toBe('/libraire/retours');
  });

  it('remplace un cookie de session préexistant', async () => {
    const id = await borrowerId();
    const previous = createSession(getDb(), id).token;

    const { cookies } = await signIn(
      { email: 'lecteur@example.fr', password: PASSWORD },
      { [SESSION_COOKIE_NAME]: previous }
    );

    const newToken = cookies.set.mock.calls[0][1];
    expect(newToken).not.toBe(previous);
    expect(validateSessionToken(getDb(), previous)).toBeNull();
    expect(validateSessionToken(getDb(), newToken)).not.toBeNull();
  });

  it('renvoie le même message pour un e-mail inconnu et un mauvais mot de passe', async () => {
    await borrowerId();

    const unknown = await signIn({ email: 'inconnu@example.fr', password: PASSWORD });
    const wrong = await signIn({ email: 'lecteur@example.fr', password: 'mauvais mot de passe' });

    for (const { outcome, cookies } of [unknown, wrong]) {
      const failure = asFailure(outcome);
      expect(failure.status).toBe(400);
      expect(failure.data.message).toBe(LOGIN_FAILED_MESSAGE);
      expect(Object.keys(failure.data).sort()).toEqual(['email', 'message']);
      expect(cookies.set).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(asFailure(wrong.outcome).data)).not.toContain('mauvais mot de passe');
  });

  it('refuse le bon mot de passe après 5 échecs et indique l’heure de fin à Paris', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await borrowerId();

    for (let attempt = 0; attempt < 5; attempt++) {
      await signIn({ email: 'lecteur@example.fr', password: 'mauvais mot de passe' });
    }
    const { outcome, cookies } = await signIn({ email: 'LECTEUR@example.fr', password: PASSWORD });

    const failure = asFailure(outcome);
    expect(failure.status).toBe(429);
    expect(failure.data.message).toBe(
      'Trop de tentatives pour cet e-mail. Réessayez à partir de 14 h 15.'
    );
    expect(cookies.set).not.toHaveBeenCalled();

    vi.setSystemTime(T0 + 15 * 60 * 1000);
    const { outcome: later } = await signIn({ email: 'lecteur@example.fr', password: PASSWORD });
    expect(asRedirect(later).location).toBe('/');
  }, 30_000);

  it('bloque aussi un e-mail sans compte', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);

    for (let attempt = 0; attempt < 5; attempt++) {
      await signIn({ email: 'personne@example.fr', password: PASSWORD });
    }
    const { outcome } = await signIn({ email: 'personne@example.fr', password: PASSWORD });

    expect(asFailure(outcome).status).toBe(429);
  }, 30_000);
});

describe('/deconnexion', () => {
  it('supprime la session en base et le cookie sur POST', async () => {
    const token = createSession(getDb(), await borrowerId()).token;
    const { event, cookies } = fakeEvent('/deconnexion', {}, { [SESSION_COOKIE_NAME]: token });

    const outcome = await outcomeOf(() =>
      logoutActions.default(event as unknown as Parameters<typeof logoutActions.default>[0])
    );

    expect(asRedirect(outcome)).toMatchObject({ status: 303, location: '/' });
    expect(validateSessionToken(getDb(), token)).toBeNull();
    expect(cookies.delete).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({ path: '/', httpOnly: true, secure: true })
    );
  });

  it('ne déconnecte pas sur GET', async () => {
    const token = createSession(getDb(), await borrowerId()).token;
    const { event, cookies } = fakeEvent('/deconnexion', {}, { [SESSION_COOKIE_NAME]: token });

    const outcome = await outcomeOf(() =>
      logoutLoad(event as unknown as Parameters<typeof logoutLoad>[0])
    );

    expect(asRedirect(outcome).location).toBe('/');
    expect(validateSessionToken(getDb(), token)).not.toBeNull();
    expect(cookies.delete).not.toHaveBeenCalled();
  });
});
