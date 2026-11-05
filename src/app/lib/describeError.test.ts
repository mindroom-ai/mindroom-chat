import { createInstance, type TFunction } from 'i18next';
import {
  ConnectionError,
  HTTPError,
  MatrixError,
  TokenRefreshError,
  TokenRefreshLogoutError,
} from 'matrix-js-sdk';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { englishCatalog } from '../i18n/englishResources';
import { SessionStoreWriteError } from '../matrix/session/sessions';
import { describeError, describeKnownError, errorDetail } from './describeError';

let t: TFunction;

beforeAll(async () => {
  const instance = createInstance();
  await instance.init({
    lng: 'en',
    resources: { en: { translation: englishCatalog } },
    interpolation: { escapeValue: false },
  });
  t = instance.t;
});

const matrixError = (errcode: string | undefined, error: string | undefined, status?: number) =>
  new MatrixError(
    { ...(errcode && { errcode }), ...(error && { error }) },
    status,
    'https://example.org/_matrix/client/v3/rooms/!room:example.org/invite'
  );

const domError = (name: string) => Object.assign(new Error('The operation was aborted.'), { name });

describe('describeError', () => {
  it.each([
    ['M_FORBIDDEN', 403, "You don't have permission to do this."],
    ['M_GUEST_ACCESS_FORBIDDEN', 403, "You don't have permission to do this."],
    ['M_UNKNOWN_TOKEN', 401, 'Your session has ended. Sign in again.'],
    ['M_MISSING_TOKEN', 401, 'Your session has ended. Sign in again.'],
    ['M_USER_DEACTIVATED', 403, 'This account has been deactivated.'],
    [
      'M_USER_SUSPENDED',
      403,
      "This account has been suspended. Contact the server's administrator.",
    ],
    ['M_USER_LOCKED', 401, "This account has been locked. Contact the server's administrator."],
    ['M_WEAK_PASSWORD', 400, 'This password is too weak. Choose a longer or less common one.'],
    [
      'M_CANNOT_LEAVE_SERVER_NOTICE_ROOM',
      403,
      "You can't leave the room where the server sends its notices.",
    ],
    ['M_NOT_FOUND', 404, "The server couldn't find this. It may have been removed."],
    ['M_UNRECOGNIZED', 404, "This server doesn't support this."],
    ['M_TOO_LARGE', 413, 'This is too large for the server.'],
    ['M_UNSUPPORTED_ROOM_VERSION', 400, "The server doesn't support this room version."],
    ['M_INCOMPATIBLE_ROOM_VERSION', 400, "The server doesn't support this room version."],
    ['M_ROOM_IN_USE', 400, 'This address is already in use. Choose another one.'],
    ['M_USER_IN_USE', 400, 'This address is already in use. Choose another one.'],
    ['M_THREEPID_IN_USE', 400, 'This address is already in use. Choose another one.'],
    ['M_EXCLUSIVE', 400, 'This address is already in use. Choose another one.'],
    ['M_BAD_JSON', 400, "The server didn't accept this request."],
    ['M_INVALID_PARAM', 400, "The server didn't accept this request."],
    [
      'M_RESOURCE_LIMIT_EXCEEDED',
      403,
      'The server has reached a usage limit. Contact its administrator.',
    ],
  ])('says what %s means', (errcode, status, sentence) => {
    expect(describeError(t, matrixError(errcode, 'Server text', status))).toBe(sentence);
  });

  it('prefers the error code to the HTTP status', () => {
    // M_NOT_FOUND normally comes with 404; the code is what the specification defines.
    expect(describeError(t, matrixError('M_NOT_FOUND', undefined, 400))).toBe(
      "The server couldn't find this. It may have been removed."
    );
  });

  it('reads the HTTP status when the code is unknown or missing', () => {
    expect(describeError(t, matrixError('M_UNKNOWN', 'boom', 502))).toBe(
      'The server ran into a problem. Try again later.'
    );
    expect(describeError(t, new HTTPError('Server returned 503 error', 503))).toBe(
      'The server ran into a problem. Try again later.'
    );
    expect(describeError(t, matrixError('M_UNKNOWN', undefined, 403))).toBe(
      "You don't have permission to do this."
    );
    expect(describeError(t, matrixError('M_UNKNOWN', undefined, 405))).toBe(
      "This server doesn't support this."
    );
    expect(describeError(t, matrixError('ORG_EXAMPLE_CUSTOM', 'custom', 409))).toBe(
      "The server couldn't complete this request."
    );
  });

  it('says how long a rate limit lasts, in seconds and then whole minutes', () => {
    const limited = (retryAfterMs?: number, headers?: Headers) =>
      new MatrixError(
        {
          errcode: 'M_LIMIT_EXCEEDED',
          error: 'Too Many Requests',
          ...(retryAfterMs !== undefined && { retry_after_ms: retryAfterMs }),
        },
        429,
        undefined,
        undefined,
        headers
      );
    expect(describeError(t, limited())).toBe('Too many requests. Wait a moment and try again.');
    expect(describeError(t, limited(1))).toBe('Too many requests. Try again in 1 second.');
    expect(describeError(t, limited(12_300))).toBe('Too many requests. Try again in 13 seconds.');
    expect(describeError(t, limited(60_000))).toBe('Too many requests. Try again in 1 minute.');
    expect(describeError(t, limited(61_000))).toBe('Too many requests. Try again in 2 minutes.');
    // The header wins over the deprecated body field, as in the SDK.
    expect(describeError(t, limited(1_000, new Headers({ 'Retry-After': '5' })))).toBe(
      'Too many requests. Try again in 5 seconds.'
    );
    expect(describeError(t, new HTTPError('Too many', 429))).toBe(
      'Too many requests. Wait a moment and try again.'
    );
  });

  it('tells a dropped connection from a request that did not finish', () => {
    expect(describeError(t, new ConnectionError('fetch failed', new TypeError('x')))).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
    expect(
      describeError(t, new TokenRefreshError(new ConnectionError('fetch failed', new TypeError())))
    ).toBe("Couldn't reach the server. Check your connection and try again.");
    for (const message of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
    ]) {
      expect(describeError(t, new TypeError(message)), message).toBe(
        "Couldn't reach the server. Check your connection and try again."
      );
    }
    expect(describeError(t, domError('AbortError'))).toBe("The request didn't finish. Try again.");
    expect(describeError(t, domError('TimeoutError'))).toBe(
      "The request didn't finish. Try again."
    );
  });

  describe('a build file that did not load', () => {
    const NEW_VERSION = 'A new version of MindRoom is available. Reload to use it.';
    // Chromium, Firefox and WebKit for a module, and Vite's preload helper for a style sheet.
    const failures = [
      new TypeError(
        'Failed to fetch dynamically imported module: https://chat.example.org/assets/RoomCall-a1.js'
      ),
      new TypeError(
        'error loading dynamically imported module: https://chat.example.org/assets/RoomCall-a1.js'
      ),
      new TypeError('Importing a module script failed.'),
      new Error('Unable to preload CSS for /assets/RoomCall-a1.css'),
    ];

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('says a new version is waiting, and keeps which file it was, while online', () => {
      for (const failure of failures) {
        expect(describeError(t, failure), failure.message).toBe(NEW_VERSION);
        expect(errorDetail(failure)).toBe(failure.message);
      }
    });

    it('is a dropped connection while the browser is offline', () => {
      vi.stubGlobal('navigator', { onLine: false });
      expect(describeError(t, failures[0])).toBe(
        "Couldn't reach the server. Check your connection and try again."
      );
      expect(errorDetail(failures[0])).toBeUndefined();
    });
  });

  it('reads a failed token refresh by its cause, which is not always the connection', () => {
    // The SDK keeps only the cause's text: here a server error at the token endpoint.
    const refresh = new TokenRefreshError(new HTTPError('Server returned 502 error', 502));

    expect(describeError(t, refresh)).toBe('Something went wrong.');
    expect(errorDetail(refresh)).toBe('Server returned 502 error');
    expect(errorDetail(new TokenRefreshError(new ConnectionError('fetch failed')))).toBe(
      'fetch failed'
    );
  });

  it('knows a session the server ended and an account list the browser would not store', () => {
    expect(describeError(t, new TokenRefreshLogoutError(new Error('x')))).toBe(
      'Your session has ended. Sign in again.'
    );
    expect(describeError(t, new SessionStoreWriteError(new Error('QuotaExceededError')))).toBe(
      "This browser couldn't save the account list. Check the site's storage permissions and try again."
    );
  });

  it('says something went wrong for anything else, programming errors included', () => {
    expect(describeError(t, new Error('Olm machine not ready'))).toBe('Something went wrong.');
    expect(
      describeError(t, new TypeError("Cannot read properties of undefined (reading 'x')"))
    ).toBe('Something went wrong.');
    expect(describeError(t, 'offline')).toBe('Something went wrong.');
    expect(describeError(t, undefined)).toBe('Something went wrong.');
    expect(describeKnownError(t, new Error('Olm machine not ready'))).toBeUndefined();
    expect(describeKnownError(t, null)).toBeUndefined();
  });

  it('follows the language of the translation function it is given', async () => {
    const german = createInstance();
    await german.init({
      lng: 'de',
      fallbackLng: 'en',
      resources: {
        en: { translation: englishCatalog },
        de: { translation: { errors: { forbidden: 'Dazu hast du keine Berechtigung.' } } },
      },
    });
    expect(describeError(german.t, matrixError('M_FORBIDDEN', 'nope', 403))).toBe(
      'Dazu hast du keine Berechtigung.'
    );
    // A key the language lacks falls back to English rather than showing the key.
    expect(describeError(german.t, new Error('x'))).toBe('Something went wrong.');
  });
});

describe('errorDetail', () => {
  it("keeps a Matrix error's code and the server's explanation, without status or URL", () => {
    const failure = matrixError('M_FORBIDDEN', 'You are not invited to this room.', 403);
    expect(failure.message).toContain('https://');
    expect(errorDetail(failure)).toBe('M_FORBIDDEN: You are not invited to this room.');
    expect(errorDetail(matrixError('M_FORBIDDEN', undefined, 403))).toBe('M_FORBIDDEN');
    expect(errorDetail(matrixError(undefined, 'Only text', 400))).toBe('Only text');
    // Tuwunel starts its explanation with the code; it is not repeated.
    expect(
      errorDetail(matrixError('M_ROOM_IN_USE', 'M_ROOM_IN_USE: Room alias already exists.', 400))
    ).toBe('M_ROOM_IN_USE: Room alias already exists.');
  });

  it('keeps the message of other errors and the text of a thrown string', () => {
    expect(errorDetail(new HTTPError('Server returned 502 error', 502))).toBe(
      'Server returned 502 error'
    );
    expect(errorDetail(new Error('Olm machine not ready'))).toBe('Olm machine not ready');
    expect(errorDetail('offline')).toBe('offline');
  });

  it('has nothing to add for a dropped connection, an unfinished request or a bare value', () => {
    expect(errorDetail(new ConnectionError('fetch failed', new TypeError('x')))).toBeUndefined();
    expect(errorDetail(new TypeError('Failed to fetch'))).toBeUndefined();
    expect(errorDetail(domError('AbortError'))).toBeUndefined();
    expect(errorDetail(new Error(''))).toBeUndefined();
    expect(errorDetail(' ')).toBeUndefined();
    expect(errorDetail(undefined)).toBeUndefined();
    expect(errorDetail(42)).toBeUndefined();
  });
});
