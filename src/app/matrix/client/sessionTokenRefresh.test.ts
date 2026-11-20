// @vitest-environment jsdom

import {
  HttpApiEvent,
  MatrixError,
  TokenRefreshError,
  TokenRefreshLogoutError,
  createClient,
  type IRefreshTokenResponse,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMatrixClient } from './matrixClientFactory';
import { getSessionStore, putSession, updateSessionCredentials } from '../session/sessions';
import {
  TOKEN_REFRESH_TIMEOUT_MS,
  createSessionTokenRefresh,
  createStoredSessionTokenRefresh,
} from './sessionTokenRefresh';

vi.mock('./matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

const createRefresh = (
  refresh: (refreshToken: string) => Promise<IRefreshTokenResponse> = vi.fn()
) =>
  createSessionTokenRefresh({
    sessionId: 'session-a',
    deviceId: 'DEVICE',
    refresh,
  });

const storeSession = (tokens: { accessToken: string; refreshToken: string; deviceId?: string }) =>
  putSession({
    baseUrl: 'https://example.com',
    userId: '@alice:example.com',
    deviceId: tokens.deviceId ?? 'DEVICE',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });

// Minimal Web Locks double: one exclusive holder per name, shared by every
// refresher in this realm, like tabs of one origin.
const installWebLocks = () => {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn((name: string, callback: () => Promise<unknown>) => {
    const previous = tails.get(name) ?? Promise.resolve();
    const result = previous.then(callback, callback);
    tails.set(
      name,
      result.catch(() => undefined)
    );
    return result;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return request;
};

const removeWebLocks = () => {
  Reflect.deleteProperty(navigator, 'locks');
};

describe('createSessionTokenRefresh', () => {
  it.each([
    {
      name: 'rate limiting',
      error: new MatrixError(
        { errcode: 'M_LIMIT_EXCEEDED', error: 'Slow down', retry_after_ms: 1_000 },
        429
      ),
    },
    {
      name: 'a homeserver failure',
      error: new MatrixError({ errcode: 'M_UNKNOWN', error: 'Unavailable' }, 503),
    },
  ])('classifies $name as a retryable SDK refresh failure', async ({ error }) => {
    const refresh = createRefresh(vi.fn().mockRejectedValue(error));

    const result = refresh('refresh-a');

    await expect(result).rejects.toBeInstanceOf(TokenRefreshError);
    await expect(result).rejects.not.toBeInstanceOf(TokenRefreshLogoutError);
  });

  it('leaves network failures retryable', async () => {
    const networkError = new Error('Network unavailable');
    const refresh = createRefresh(vi.fn().mockRejectedValue(networkError));

    await expect(refresh('refresh-a')).rejects.toBe(networkError);
  });

  it.each([
    { errcode: 'M_UNKNOWN_TOKEN', status: 401 },
    { errcode: 'M_FORBIDDEN', status: 403 },
  ])('classifies $errcode from refresh as a definitive SDK logout', async ({ errcode, status }) => {
    const invalidToken = new MatrixError({ errcode, error: 'Invalid refresh token' }, status);
    const refresh = createRefresh(vi.fn().mockRejectedValue(invalidToken));

    const result = refresh('refresh-a');

    await expect(result).rejects.toBeInstanceOf(TokenRefreshLogoutError);
    await expect(result).rejects.not.toBeInstanceOf(TokenRefreshError);
  });

  it.each([
    { errcode: 'M_UNKNOWN_TOKEN', status: 401, logout: true },
    { errcode: 'M_FORBIDDEN', status: 403, logout: true },
    { errcode: 'M_LIMIT_EXCEEDED', status: 429, logout: false },
    { errcode: 'M_UNKNOWN', status: 503, logout: false },
  ])(
    'SDK emits logout only for a rejected session: $errcode',
    async ({ errcode, status, logout }) => {
      const invalidAccessToken = { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown access token.' };
      const refresh = vi
        .fn()
        .mockRejectedValue(new MatrixError({ errcode, error: 'Refresh failed.' }, status));
      const mx = createClient({
        baseUrl: 'https://example.com',
        accessToken: 'access-a',
        refreshToken: 'refresh-a',
        tokenRefreshFunction: createRefresh(refresh),
        fetchFn: vi.fn(
          async () =>
            new Response(JSON.stringify(invalidAccessToken), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
        ),
      });
      const onLogout = vi.fn();
      mx.on(HttpApiEvent.SessionLoggedOut, onLogout);

      const result = mx.getPushRules();

      await expect(result).rejects.toBeInstanceOf(logout ? MatrixError : TokenRefreshError);
      expect(refresh).toHaveBeenCalledWith('refresh-a');
      expect(onLogout).toHaveBeenCalledTimes(logout ? 1 : 0);
    }
  );
});

describe('cross-tab refresh-token rotation', () => {
  afterEach(() => {
    removeWebLocks();
    localStorage.clear();
  });

  it('adopts a rotation another tab stored instead of spending a stale refresh token', async () => {
    const session = storeSession({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    const refresh = vi.fn();

    const tokens = await createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    })('refresh-a');

    expect(refresh).not.toHaveBeenCalled();
    expect(tokens).toEqual({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      expiry: undefined,
    });
  });

  it('adopts a rotation another tab stored while this tab spent the same token', async () => {
    const session = storeSession({ accessToken: 'access-a', refreshToken: 'refresh-a' });
    const refresh = vi.fn(async () => {
      // Without Web Locks, the other tab wins the race and stores its rotation.
      updateSessionCredentials(session.sessionId, {
        accessToken: 'access-b',
        refreshToken: 'refresh-b',
      });
      throw new MatrixError(
        { errcode: 'M_FORBIDDEN', error: 'Refresh token is unrecognized.' },
        403
      );
    });

    const tokens = await createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    })('refresh-a');

    expect(refresh).toHaveBeenCalledWith('refresh-a');
    expect(tokens).toEqual({ accessToken: 'access-b', refreshToken: 'refresh-b' });
  });

  /** A homeserver that answers `whoami` for the access tokens in `accepted` and rejects the rest. */
  const serverAccepting = (accepted: Set<string>) =>
    vi.fn<typeof fetch>(async (_input, init) => {
      const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '');
      const known = token !== undefined && accepted.has(token);
      return new Response(
        JSON.stringify(
          known
            ? { user_id: '@alice:example.com' }
            : { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown access token.' }
        ),
        { status: known ? 200 : 401, headers: { 'Content-Type': 'application/json' } }
      );
    });

  /** A client of the stored session whose first request refreshed, so it knows its token lasts an hour. */
  const clientAfterFirstRefresh = async (refresh: () => Promise<IRefreshTokenResponse>) => {
    const session = storeSession({ accessToken: 'access-a', refreshToken: 'refresh-a' });
    const accepted = new Set(['access-b']);
    const mx = createClient({
      baseUrl: 'https://example.com',
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      tokenRefreshFunction: createSessionTokenRefresh({
        sessionId: session.sessionId,
        deviceId: 'DEVICE',
        refresh,
      }),
      fetchFn: serverAccepting(accepted),
    });
    const onLogout = vi.fn();
    mx.on(HttpApiEvent.SessionLoggedOut, onLogout);
    await expect(mx.whoami()).resolves.toEqual({ user_id: '@alice:example.com' });
    expect(mx.getAccessToken()).toBe('access-b');
    return { session, accepted, mx, onLogout };
  };

  it('adopts a rotation another tab stored when the server rejects an access token before its expiry', async () => {
    const refresh = vi.fn(async () => ({
      access_token: 'access-b',
      refresh_token: 'refresh-b',
      expires_in_ms: 3_600_000,
    }));
    const { session, accepted, mx, onLogout } = await clientAfterFirstRefresh(refresh);

    // Another tab rotates the tokens, which ends this tab's access token with most of its hour left.
    updateSessionCredentials(session.sessionId, {
      accessToken: 'access-c',
      refreshToken: 'refresh-c',
    });
    accepted.clear();
    accepted.add('access-c');

    await expect(mx.whoami()).resolves.toEqual({ user_id: '@alice:example.com' });
    expect(mx.getAccessToken()).toBe('access-c');
    expect(mx.getRefreshToken()).toBe('refresh-c');
    // The rotation was adopted, not spent, and the account stays.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('logs out once when the tokens it got for a rejected access token are rejected too', async () => {
    const refresh = vi
      .fn<() => Promise<IRefreshTokenResponse>>()
      .mockResolvedValueOnce({
        access_token: 'access-b',
        refresh_token: 'refresh-b',
        expires_in_ms: 3_600_000,
      })
      .mockResolvedValue({
        access_token: 'access-c',
        refresh_token: 'refresh-c',
        expires_in_ms: 3_600_000,
      });
    const { accepted, mx, onLogout } = await clientAfterFirstRefresh(refresh);

    // The server ends the session: it takes no access token of it any more.
    accepted.clear();

    await expect(mx.whoami()).rejects.toBeInstanceOf(MatrixError);
    // One refresh for the rejected token, none for the one that refresh returned.
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('logs out once when the rotation it adopted for a rejected access token is rejected too', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // A later refresh returns tokens that say nothing of how long they last (a server may leave
      // `expires_in_ms` out, whatever the SDK's type says), as an adopted rotation does.
      let refreshes = 0;
      const refresh = vi.fn(async () => {
        refreshes += 1;
        return (
          refreshes === 1
            ? { access_token: 'access-b', refresh_token: 'refresh-b', expires_in_ms: 3_600_000 }
            : { access_token: `access-${refreshes}`, refresh_token: `refresh-${refreshes}` }
        ) as IRefreshTokenResponse;
      });
      const { session, accepted, mx, onLogout } = await clientAfterFirstRefresh(refresh);

      // Another tab's rotation is stored, and the server ends the session.
      updateSessionCredentials(session.sessionId, {
        accessToken: 'access-c',
        refreshToken: 'refresh-c',
      });
      accepted.clear();

      const outcome = mx.whoami().then(
        () => 'accepted',
        (error: unknown) => error
      );
      // Longer than every wait the SDK makes between two refreshes of one request.
      await vi.advanceTimersByTimeAsync(300_000);

      await expect(outcome).resolves.toBeInstanceOf(MatrixError);
      expect(mx.getAccessToken()).toBe('access-c');
      // The rotation was adopted for the rejected token; nothing was asked for the rejected rotation.
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(onLogout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A client whose `whoami` requests the test answers one by one (`answer`, in the order they were
   * sent), while the server answers its other requests at once: accepted for the access tokens in
   * `accepted`. Each refresh returns the next access token, good for an hour.
   */
  const clientWithHeldRequests = () => {
    const session = storeSession({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    const accepted = new Set<string>();
    const held: Array<{ token: string | undefined; respond: (response: Response) => void }> = [];
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    const rejected = () =>
      json({ errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown access token.' }, 401);
    let refreshes = 1;
    const refresh = vi.fn(async (): Promise<IRefreshTokenResponse> => {
      refreshes += 1;
      return {
        access_token: `access-${refreshes}`,
        refresh_token: `refresh-${refreshes}`,
        expires_in_ms: 3_600_000,
      };
    });
    const mx = createClient({
      baseUrl: 'https://example.com',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenRefreshFunction: createSessionTokenRefresh({
        sessionId: session.sessionId,
        deviceId: 'DEVICE',
        refresh,
      }),
      fetchFn: async (input, init) => {
        const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '');
        if (String(input).includes('/account/whoami')) {
          return new Promise<Response>((respond) => {
            held.push({ token, respond });
          });
        }
        return token !== undefined && accepted.has(token) ? json({ devices: [] }, 200) : rejected();
      },
    });
    const onLogout = vi.fn();
    mx.on(HttpApiEvent.SessionLoggedOut, onLogout);
    /** Answers the held request number `index`, once it was sent. */
    const answer = async (index: number, accept: boolean) => {
      await vi.waitFor(() => expect(held).toHaveLength(index + 1));
      held[index]?.respond(accept ? json({ user_id: '@alice:example.com' }, 200) : rejected());
    };
    /** Another request finds the current access token ended and refreshes it. */
    const refreshThroughAnotherRequest = async () => {
      accepted.clear();
      accepted.add(`access-${refreshes + 1}`);
      await mx.getDevices();
    };
    /** Another tab rotates the session's tokens and stores them; the server takes the new ones only. */
    const rotateInAnotherTab = (name: string) => {
      updateSessionCredentials(session.sessionId, {
        accessToken: `access-${name}`,
        refreshToken: `refresh-${name}`,
      });
      accepted.clear();
      accepted.add(`access-${name}`);
    };
    return {
      mx,
      held,
      refresh,
      onLogout,
      answer,
      refreshThroughAnotherRequest,
      rotateInAnotherTab,
    };
  };

  it('retries, and keeps the account, when a retry is rejected for a token another request has replaced since', async () => {
    const { mx, held, onLogout, answer, refreshThroughAnotherRequest } = clientWithHeldRequests();

    const whoami = mx.whoami();
    // Its first token is rejected, so it refreshes and tries again with the second.
    await answer(0, false);
    await vi.waitFor(() => expect(held).toHaveLength(2));
    // Before that try is answered, another request replaces the second token.
    await refreshThroughAnotherRequest();
    await answer(1, false);
    await answer(2, true);

    await expect(whoami).resolves.toEqual({ user_id: '@alice:example.com' });
    expect(held.map((request) => request.token)).toEqual(['access-1', 'access-2', 'access-3']);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('fails a request, and keeps the account, when each of its tries is rejected for a token replaced since', async () => {
    const { mx, held, refresh, onLogout, answer, refreshThroughAnotherRequest } =
      clientWithHeldRequests();

    const whoami = mx.whoami();
    const failure = whoami.then(
      () => undefined,
      (error: unknown) => error
    );
    for (const attempt of [0, 1, 2]) {
      // eslint-disable-next-line no-await-in-loop -- each try follows the answer to the one before.
      await vi.waitFor(() => expect(held).toHaveLength(attempt + 1));
      // eslint-disable-next-line no-await-in-loop
      await refreshThroughAnotherRequest();
      // eslint-disable-next-line no-await-in-loop
      await answer(attempt, false);
    }

    await expect(failure).resolves.toBeInstanceOf(TokenRefreshError);
    // It gave up after three tries, asked for no refresh itself, and the session stays.
    expect(held.map((request) => request.token)).toEqual(['access-1', 'access-2', 'access-3']);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(mx.getAccessToken()).toBe('access-4');
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('adopts the rotation another tab stored while the retry with an adopted rotation was on its way', async () => {
    const { mx, held, refresh, onLogout, answer, rotateInAnotherTab } = clientWithHeldRequests();

    // Another tab rotates before this tab's token is rejected, so this tab adopts that rotation.
    rotateInAnotherTab('b');
    const whoami = mx.whoami();
    await answer(0, false);
    await vi.waitFor(() => expect(held).toHaveLength(2));
    // It rotates again before the retry is answered.
    rotateInAnotherTab('c');
    await answer(1, false);
    await answer(2, true);

    await expect(whoami).resolves.toEqual({ user_id: '@alice:example.com' });
    expect(held.map((request) => request.token)).toEqual(['access-1', 'access-b', 'access-c']);
    expect(mx.getRefreshToken()).toBe('refresh-c');
    // Both rotations were adopted; no refresh token was spent, and the account stays.
    expect(refresh).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('fails a request, and keeps the account, when another tab rotates during each of its tries', async () => {
    const { mx, held, refresh, onLogout, answer, rotateInAnotherTab } = clientWithHeldRequests();

    const failure = mx.whoami().then(
      () => undefined,
      (error: unknown) => error
    );
    for (const [attempt, rotation] of ['b', 'c', 'd'].entries()) {
      // eslint-disable-next-line no-await-in-loop -- each try follows the answer to the one before.
      await vi.waitFor(() => expect(held).toHaveLength(attempt + 1));
      rotateInAnotherTab(rotation);
      // eslint-disable-next-line no-await-in-loop
      await answer(attempt, false);
    }

    await expect(failure).resolves.toBeInstanceOf(TokenRefreshError);
    expect(held.map((request) => request.token)).toEqual(['access-1', 'access-b', 'access-c']);
    // The newest rotation is adopted for the next request.
    expect(mx.getAccessToken()).toBe('access-d');
    expect(refresh).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('does not adopt credentials stored for a different device of the same account', async () => {
    const session = storeSession({
      accessToken: 'access-new-device',
      refreshToken: 'refresh-new-device',
      deviceId: 'NEWDEVICE',
    });
    const refresh = vi
      .fn()
      .mockResolvedValue({ access_token: 'access-b', refresh_token: 'refresh-b' });

    const tokens = await createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    })('refresh-a');

    expect(refresh).toHaveBeenCalledWith('refresh-a');
    expect(tokens).toMatchObject({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    expect(getSessionStore().sessions[0]).toMatchObject({ accessToken: 'access-new-device' });
  });

  it('performs one network refresh when two tabs refresh the same session at once', async () => {
    const locks = installWebLocks();
    const session = storeSession({ accessToken: 'access-a', refreshToken: 'refresh-a' });
    let finishRefresh: (value: IRefreshTokenResponse) => void = () => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<IRefreshTokenResponse>((resolve) => {
          finishRefresh = resolve;
        })
    );
    const firstTab = createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    });
    const secondTab = createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    });

    const first = firstTab('refresh-a');
    const second = secondTab('refresh-a');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    finishRefresh({ access_token: 'access-b', refresh_token: 'refresh-b', expires_in_ms: 60_000 });

    await expect(first).resolves.toMatchObject({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });
    await expect(second).resolves.toMatchObject({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(locks).toHaveBeenCalledWith(
      `mindroom-token-refresh:${session.sessionId}`,
      expect.any(Function)
    );
  });
});

describe('hung token refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
    removeWebLocks();
    localStorage.clear();
  });

  it('times out a hung holder so the next tab can refresh', async () => {
    vi.useFakeTimers();
    installWebLocks();
    const session = storeSession({ accessToken: 'access-a', refreshToken: 'refresh-a' });
    const hungRefresh = vi.fn(
      () =>
        new Promise<IRefreshTokenResponse>(() => {
          // Never settles, like a request stuck behind a dead connection.
        })
    );
    const workingRefresh = vi.fn().mockResolvedValue({
      access_token: 'access-b',
      refresh_token: 'refresh-b',
      expires_in_ms: 60_000,
    });

    const hung = createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh: hungRefresh,
    })('refresh-a');
    const hungOutcome = hung.catch((error: unknown) => error);
    const next = createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh: workingRefresh,
    })('refresh-a');

    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_TIMEOUT_MS);

    const hungError = await hungOutcome;
    expect(hungError).toBeInstanceOf(Error);
    expect(hungError).not.toBeInstanceOf(TokenRefreshLogoutError);
    await expect(next).resolves.toMatchObject({ accessToken: 'access-b' });
    expect(workingRefresh).toHaveBeenCalledWith('refresh-a');
  });
});

describe('createStoredSessionTokenRefresh', () => {
  afterEach(() => {
    vi.mocked(createMatrixClient).mockReset();
    localStorage.clear();
  });

  it('returns no refresh function for sessions without a refresh token', () => {
    expect(
      createStoredSessionTokenRefresh({
        sessionId: 'session-a',
        baseUrl: 'https://example.com',
        deviceId: 'DEVICE',
        refreshToken: undefined,
      })
    ).toBeUndefined();
    expect(createMatrixClient).not.toHaveBeenCalled();
  });

  it('refreshes through an unauthenticated client and persists the rotated credentials', async () => {
    const session = putSession({
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const refreshToken = vi.fn().mockResolvedValue({
      access_token: 'access-b',
      refresh_token: 'refresh-b',
    });
    vi.mocked(createMatrixClient).mockReturnValue({ refreshToken } as never);

    const refresh = createStoredSessionTokenRefresh(session);
    const tokens = await refresh?.('refresh-a');

    expect(createMatrixClient).toHaveBeenCalledWith({
      baseUrl: 'https://example.com',
      localTimeoutMs: TOKEN_REFRESH_TIMEOUT_MS,
    });
    expect(refreshToken).toHaveBeenCalledWith('refresh-a');
    expect(tokens).toMatchObject({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    expect(getSessionStore().sessions[0]).toMatchObject({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });
  });
});
