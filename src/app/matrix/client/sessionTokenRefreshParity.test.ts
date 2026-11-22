// @vitest-environment jsdom

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpApiEvent, MatrixError, createClient, type IRefreshTokenResponse } from 'matrix-js-sdk';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { putSession, updateSessionCredentials } from '../session/sessions';
import { createSessionTokenRefresh } from './sessionTokenRefresh';
import fixture from './fixtures/tokenRefreshOutcomes.sdk-41.7.0.json';

// What a request does when the server rejects its access token must stay what it was with
// matrix-js-sdk 41.7.0: every difference found in the upgrade to 45 was a session logged out, or a
// request repeated, that main handled otherwise. The fixture holds what the client of main (41.7.0
// with its patch) did in each case below, with the app's own refresh function, and this file
// asserts the same of the client it runs with.
//
// The fixture is recorded by running this file on a checkout of main with
// RECORD_TOKEN_REFRESH_OUTCOMES=1, which writes it instead of comparing with it. Two rows are flaws
// main has, kept as they are until a change of their own: the retries without end when every
// refreshed token is rejected, and the logout when another holder rotates tokens that had time left.

const FIXTURE_PATH = 'src/app/matrix/client/fixtures/tokenRefreshOutcomes.sdk-41.7.0.json';
const RECORDING = process.env.RECORD_TOKEN_REFRESH_OUTCOMES === '1';

type Outcome = {
  /** `ok`, or the name and code of the error the request failed with. */
  result: string;
  /** The access token of each request the server received, in order. */
  sends: string[];
  /** The refresh tokens spent at the server's `/refresh`, in order. */
  refreshSpends: string[];
  /** How often the client reported the session logged out. */
  logouts: number;
  /** How long the client waited between its tries. */
  backoffMs: number;
};

type Grant = Partial<IRefreshTokenResponse> & Pick<IRefreshTokenResponse, 'access_token'>;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * One tab of a stored session, whose access token `A` the server no longer takes, and its
 * homeserver: it takes the access tokens in `accepted` and refreshes for `refreshToken` only.
 */
const world = (refreshToken = 'R1') => {
  const session = putSession({
    baseUrl: 'https://example.com',
    userId: '@alice:example.com',
    deviceId: 'DEVICE',
    accessToken: 'A',
    refreshToken,
  });
  const server = {
    accepted: new Set<string>(),
    refreshToken,
    /** After this many requests the server answers with an error that is not about the token. */
    failsAfter: Number.POSITIVE_INFINITY,
    grants: 0,
    /** The tokens of a refresh; by default a new pair that says nothing of how long it lasts. */
    grant: (): Grant => {
      server.grants += 1;
      server.accepted = new Set([`S${server.grants}`]);
      server.refreshToken = `SR${server.grants}`;
      return { access_token: `S${server.grants}`, refresh_token: `SR${server.grants}` };
    },
  };
  const sends: string[] = [];
  const refreshSpends: string[] = [];
  let logouts = 0;
  const hooks: { onSend?: (accessToken: string) => void } = {};

  const mx = createClient({
    baseUrl: 'https://example.com',
    accessToken: 'A',
    refreshToken,
    tokenRefreshFunction: createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh: async (spent) => {
        refreshSpends.push(spent);
        if (spent !== server.refreshToken) {
          throw new MatrixError(
            { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown refresh token.' },
            401
          );
        }
        // A server may leave `refresh_token` and `expires_in_ms` out, whatever the SDK's type says.
        return server.grant() as IRefreshTokenResponse;
      },
    }),
    fetchFn: async (_input, init) => {
      const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
      sends.push(token);
      if (sends.length > server.failsAfter) {
        return json({ errcode: 'M_UNKNOWN', error: 'Internal server error.' }, 500);
      }
      hooks.onSend?.(token);
      return server.accepted.has(token)
        ? json({ user_id: '@alice:example.com' }, 200)
        : json({ errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown access token.' }, 401);
    },
  });
  mx.on(HttpApiEvent.SessionLoggedOut, () => {
    logouts += 1;
  });

  /** Another tab of the session stores the tokens of a rotation; the server takes only those. */
  const storeInAnotherTab = (accessToken: string, storedRefreshToken: string) => {
    updateSessionCredentials(session.sessionId, {
      accessToken,
      refreshToken: storedRefreshToken,
    });
    server.accepted = new Set([accessToken]);
    server.refreshToken = storedRefreshToken;
  };

  const whoami = (): Promise<string> =>
    mx.whoami().then(
      () => 'ok',
      (error: unknown) =>
        error instanceof MatrixError
          ? `${error.name}: ${error.errcode}`
          : `${(error as Error).name}: ${(error as Error).message}`
    );

  /** Runs `requests` to their end, moving the clock over the waits between their tries. */
  const outcomeOf = async (requests: Promise<string>[]): Promise<Outcome> => {
    let results: string[] | undefined;
    void Promise.all(requests).then((settled) => {
      results = settled;
    });
    let backoffMs = 0;
    const turns = async () => {
      for (let turn = 0; turn < 50 && !results; turn += 1) {
        // eslint-disable-next-line no-await-in-loop -- lets the requests run on.
        await new Promise((next) => {
          setImmediate(next);
        });
      }
    };
    await turns();
    while (!results && backoffMs < 600_000) {
      // eslint-disable-next-line no-await-in-loop -- one second of waiting after another.
      await vi.advanceTimersByTimeAsync(1_000);
      backoffMs += 1_000;
      // eslint-disable-next-line no-await-in-loop
      await turns();
    }
    return {
      result: [...new Set(results ?? ['pending'])].join(' | '),
      sends,
      refreshSpends,
      logouts,
      backoffMs,
    };
  };

  return { server, hooks, storeInAnotherTab, whoami, outcomeOf };
};

const six = <T>(make: () => T): T[] => Array.from({ length: 6 }, make);

const scenarios: Record<string, () => Promise<Outcome>> = {
  'six requests rejected at once share one refresh': async () => {
    const tab = world();
    return tab.outcomeOf(six(tab.whoami));
  },

  'another tab rotates before the rejection, and again while the retry is on its way': async () => {
    const tab = world();
    tab.storeInAnotherTab('B', 'R2');
    tab.hooks.onSend = (token) => {
      if (token === 'B') tab.storeInAnotherTab('C', 'R3');
    };
    return tab.outcomeOf([tab.whoami()]);
  },

  'a refresh that keeps the refresh token, then another tab stores a newer access token':
    async () => {
      const tab = world('R');
      const accessTokens = ['B', 'D', 'E'];
      tab.server.grant = () => {
        const accessToken = accessTokens.shift() ?? 'none';
        tab.server.accepted = new Set([accessToken]);
        return { access_token: accessToken };
      };
      tab.hooks.onSend = (token) => {
        if (token === 'B') tab.storeInAnotherTab('C', 'R');
      };
      return tab.outcomeOf([tab.whoami()]);
    },

  'the stored sessions cannot be read once, while another tab has rotated': async () => {
    const tab = world();
    tab.storeInAnotherTab('B', 'R2');
    tab.hooks.onSend = (token) => {
      if (token !== 'B') return;
      tab.storeInAnotherTab('C', 'R3');
      vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
    };
    return tab.outcomeOf([tab.whoami()]);
  },

  'the server has ended the session': async () => {
    const tab = world();
    tab.server.refreshToken = 'revoked';
    return tab.outcomeOf([tab.whoami()]);
  },

  'six requests made just before the token expires share one refresh': async () => {
    const tab = world();
    const defaultGrant = tab.server.grant;
    // The first refresh says how long its token lasts; the client refreshes ahead of that time.
    tab.server.grant = () => {
      tab.server.grant = defaultGrant;
      return { ...defaultGrant(), expires_in_ms: 60_000 };
    };
    const first = await tab.outcomeOf([tab.whoami()]);
    await vi.advanceTimersByTimeAsync(59_800);
    const rest = await tab.outcomeOf(six(tab.whoami));
    return { ...rest, result: `${first.result}, then ${rest.result}` };
  },

  'known flaw: every refresh succeeds and every token it returns is rejected': async () => {
    const tab = world();
    // The client would go on without end; the server answers the sixth request with another error.
    tab.server.failsAfter = 5;
    tab.server.grant = () => {
      tab.server.grants += 1;
      tab.server.refreshToken = `SR${tab.server.grants}`;
      return { access_token: `S${tab.server.grants}`, refresh_token: `SR${tab.server.grants}` };
    };
    return tab.outcomeOf([tab.whoami()]);
  },

  'known flaw: another tab rotates tokens that had five minutes left': async () => {
    const tab = world();
    tab.server.grant = () => {
      tab.server.accepted = new Set(['B']);
      tab.server.refreshToken = 'R2';
      return { access_token: 'B', refresh_token: 'R2', expires_in_ms: 300_000 };
    };
    tab.hooks.onSend = (token) => {
      if (token === 'B') tab.storeInAnotherTab('C', 'R3');
    };
    return tab.outcomeOf([tab.whoami()]);
  },
};

describe('a rejected access token, compared with what matrix-js-sdk 41.7.0 did', () => {
  const recorded: Record<string, Outcome> = {};

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterAll(() => {
    if (!RECORDING) return;
    const { version } = JSON.parse(
      readFileSync(resolve('node_modules/matrix-js-sdk/package.json'), 'utf8')
    ) as { version: string };
    writeFileSync(
      resolve(FIXTURE_PATH),
      `${JSON.stringify({ sdkVersion: version, outcomes: recorded }, null, 2)}\n`
    );
  });

  it.each(Object.keys(scenarios))('%s', async (name) => {
    const outcome = await scenarios[name]?.();

    if (RECORDING) {
      if (outcome) recorded[name] = outcome;
      return;
    }
    expect(outcome).toEqual((fixture.outcomes as Record<string, Outcome>)[name]);
  });

  it.skipIf(RECORDING)('compares with a recording of 41.7.0 that has every case', () => {
    expect(fixture.sdkVersion).toBe('41.7.0');
    expect(Object.keys(fixture.outcomes)).toEqual(Object.keys(scenarios));
  });
});
