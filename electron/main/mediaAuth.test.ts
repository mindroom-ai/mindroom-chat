import { afterEach, describe, expect, it, vi } from 'vitest';

const ipcMainMock = vi.hoisted(() => ({
  on: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

import { APP_ORIGIN } from './bundleProtocol';
import { createMediaAuth, installMediaAuth, type MediaRequest } from './mediaAuth';

const makeReq = (overrides: Partial<MediaRequest> = {}): MediaRequest => ({
  id: 1,
  url: 'https://hs.example/_matrix/client/v1/media/download/hs.example/abc',
  method: 'GET',
  authorization: undefined,
  fromMainFrameOf: 10,
  ...overrides,
});

describe('createMediaAuth', () => {
  it('authorizes GET media requests for the window active session homeserver', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://hs.example', userId: '@a:hs', accessToken: 'tok-a' });

    expect(auth.authorize(makeReq())).toBe('Bearer tok-a');
    expect(
      auth.authorize(
        makeReq({
          id: 2,
          url: 'https://hs.example/_matrix/client/v1/media/thumbnail/hs.example/abc?width=64',
        })
      )
    ).toBe('Bearer tok-a');
  });

  it('refuses another origin, another base path on the same origin, and paths only containing the media path', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://hs.example/matrix', userId: '@a:hs', accessToken: 'tok-a' });

    expect(
      auth.authorize(
        makeReq({
          id: 1,
          url: 'https://hs.example/matrix/_matrix/client/v1/media/download/hs.example/abc',
        })
      )
    ).toBe('Bearer tok-a');
    expect(
      auth.authorize(
        makeReq({
          id: 2,
          url: 'https://other.example/matrix/_matrix/client/v1/media/download/hs.example/abc',
        })
      )
    ).toBeUndefined();
    expect(
      auth.authorize(
        makeReq({
          id: 3,
          url: 'https://hs.example/other/_matrix/client/v1/media/download/hs.example/abc',
        })
      )
    ).toBeUndefined();
    expect(
      auth.authorize(
        makeReq({
          id: 4,
          url: 'https://hs.example/matrix/proxy/_matrix/client/v1/media/download/hs.example/abc',
        })
      )
    ).toBeUndefined();
    expect(
      auth.authorize(
        makeReq({
          id: 5,
          url: 'https://hs.example/matrix/_matrix/client/v1/media/download-extra/abc',
        })
      )
    ).toBeUndefined();
  });

  it('refuses ambiguous media paths (encoded slashes/backslashes/dots, dot segments, wrong route shape) and allows optional filename', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://hs.example/base', userId: '@a:hs', accessToken: 'tok-a' });

    expect(
      auth.authorize(
        makeReq({
          id: 1,
          url: 'https://hs.example/base/_matrix/client/v1/media/download/hs.example/abc/photo.png',
        })
      )
    ).toBe('Bearer tok-a');

    const refused = [
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/a%2fb',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/a%2Fb',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/a%5cb',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/a%5Cb',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/%2e%2e/other',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/%2E/other',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/id/../other',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/./id',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/id\\evil',
      'https://hs.example/base/_matrix/client/v1/media/download',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example/id/name/extra',
      'https://hs.example/base/_matrix/client/v1/media/thumbnail/hs.example/id/name.png',
      'https://hs.example/base/_matrix/client/v1/media/thumbnail/hs.example/id/name.png?width=64',
      'https://hs.example/base/_matrix/client/v1/media/download/hs.example//id',
      'https://hs.example/other/../base/_matrix/client/v1/media/download/hs.example/id',
    ];
    refused.forEach((url, idx) => {
      expect(auth.authorize(makeReq({ id: 20 + idx, url })), url).toBeUndefined();
    });
  });

  it('refuses non-GET methods such as POST and OPTIONS', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://hs.example', userId: '@a:hs', accessToken: 'tok-a' });

    expect(auth.authorize(makeReq({ id: 1, method: 'POST' }))).toBeUndefined();
    expect(auth.authorize(makeReq({ id: 2, method: 'OPTIONS' }))).toBeUndefined();
  });

  it('never answers or strips a request that already carries Authorization', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://hs.example', userId: '@a:hs', accessToken: 'tok-a' });

    const syncReq = makeReq({
      id: 1,
      url: 'https://hs.example/_matrix/client/v3/sync',
      authorization: 'Bearer sdk-tok',
    });
    expect(auth.authorize(syncReq)).toBeUndefined();
    auth.redirected(1);
    expect(auth.ownedHeaderToRemove(syncReq)).toBe(false);

    const explicitMediaReq = makeReq({
      id: 2,
      authorization: 'Bearer account-b-explicit',
    });
    expect(auth.authorize(explicitMediaReq)).toBeUndefined();
    auth.redirected(2);
    expect(auth.ownedHeaderToRemove(explicitMediaReq)).toBe(false);
  });

  it('refuses requests without fromMainFrameOf and isolates sessions per window', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://a.example', userId: '@a:hs', accessToken: 'tok-a' });
    auth.set(20, { baseUrl: 'https://b.example', userId: '@a:hs', accessToken: 'tok-b' });

    expect(
      auth.authorize(
        makeReq({
          id: 1,
          url: 'https://a.example/_matrix/client/v1/media/download/a.example/1',
          fromMainFrameOf: undefined,
        })
      )
    ).toBeUndefined();
    expect(
      auth.authorize(
        makeReq({
          id: 2,
          url: 'https://b.example/_matrix/client/v1/media/download/b.example/1',
          fromMainFrameOf: 10,
        })
      )
    ).toBeUndefined();
    expect(
      auth.authorize(
        makeReq({
          id: 3,
          url: 'https://b.example/_matrix/client/v1/media/download/b.example/1',
          fromMainFrameOf: 20,
        })
      )
    ).toBe('Bearer tok-b');
  });

  it('never answers a redirected id even when redirected to the same or another signed-in homeserver', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://a.example', userId: '@a:hs', accessToken: 'tok-a' });
    auth.set(20, { baseUrl: 'https://b.example', userId: '@a:hs', accessToken: 'tok-b' });

    expect(
      auth.authorize(
        makeReq({
          id: 7,
          url: 'https://a.example/_matrix/client/v1/media/download/a.example/1',
          fromMainFrameOf: 10,
        })
      )
    ).toBe('Bearer tok-a');
    auth.redirected(7);

    expect(
      auth.authorize(
        makeReq({
          id: 7,
          url: 'https://a.example/_matrix/client/v1/media/download/a.example/2',
          fromMainFrameOf: 10,
        })
      )
    ).toBeUndefined();
    expect(
      auth.authorize(
        makeReq({
          id: 7,
          url: 'https://b.example/_matrix/client/v1/media/download/b.example/2',
          fromMainFrameOf: 20,
        })
      )
    ).toBeUndefined();
  });

  it('removes only its own exact header on a redirected hop and forgets ids on done', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://a.example', userId: '@a:hs', accessToken: 'tok-a' });

    expect(
      auth.authorize(
        makeReq({
          id: 9,
          url: 'https://a.example/_matrix/client/v1/media/download/a.example/1',
        })
      )
    ).toBe('Bearer tok-a');
    auth.redirected(9);

    expect(
      auth.ownedHeaderToRemove(
        makeReq({
          id: 9,
          url: 'https://cdn.example/file',
          authorization: 'Bearer tok-a',
        })
      )
    ).toBe(true);
    expect(
      auth.ownedHeaderToRemove(
        makeReq({
          id: 9,
          url: 'https://cdn.example/file',
          authorization: 'Bearer different-caller-token',
        })
      )
    ).toBe(false);
    expect(
      auth.ownedHeaderToRemove(
        makeReq({
          id: 9,
          url: 'https://cdn.example/file',
          authorization: undefined,
        })
      )
    ).toBe(false);

    auth.done(9);
    expect(
      auth.ownedHeaderToRemove(
        makeReq({
          id: 9,
          url: 'https://cdn.example/file',
          authorization: 'Bearer tok-a',
        })
      )
    ).toBe(false);
    expect(
      auth.authorize(
        makeReq({
          id: 9,
          url: 'https://a.example/_matrix/client/v1/media/download/a.example/1',
        })
      )
    ).toBe('Bearer tok-a');
  });

  it('switches tokens on the same homeserver and clears on logout', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://hs.example', userId: '@a:hs', accessToken: 'tok-1' });
    expect(auth.authorize(makeReq({ id: 1 }))).toBe('Bearer tok-1');

    auth.set(10, { baseUrl: 'https://hs.example', userId: '@a:hs', accessToken: 'tok-2' });
    expect(auth.authorize(makeReq({ id: 2 }))).toBe('Bearer tok-2');

    auth.set(10, undefined);
    expect(auth.authorize(makeReq({ id: 3 }))).toBeUndefined();
  });
});

describe('installMediaAuth', () => {
  afterEach(() => {
    ipcMainMock.on.mockReset();
  });

  const mainFrame = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN };
  const owner = {
    id: 42,
    mainFrame,
    isDestroyed: () => false,
  } as unknown as Electron.WebContents;
  const validEvent = { sender: owner, senderFrame: mainFrame };
  type PushResult = { ok: boolean; code?: string };

  /** The synchronous channel's listener; the promise settles when it sets `event.returnValue`. */
  const pushChannel = () => {
    const call = ipcMainMock.on.mock.calls.find((c) => c[0] === 'desktop:set-media-session');
    expect(call).toBeDefined();
    const listener = call![1] as (event: object, ...args: unknown[]) => void;
    return (source: { sender: unknown; senderFrame: unknown }, ...args: unknown[]) =>
      new Promise<PushResult>((resolve) => {
        listener(
          {
            ...source,
            set returnValue(value: PushResult) {
              resolve(value);
            },
          },
          ...args
        );
      });
  };

  it('clears the HTTP cache before answering a logout, a switch, and a rejected push, not a sign-in or a same-account refresh', async () => {
    let cleared!: () => void;
    const clearCache = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          cleared = resolve;
        })
    );
    const noop = vi.fn();
    const ses = {
      clearCache,
      webRequest: {
        onBeforeSendHeaders: noop,
        onBeforeRedirect: noop,
        onCompleted: noop,
        onErrorOccurred: noop,
      },
    } as unknown as Electron.Session;
    installMediaAuth(ses, () => [owner]);
    const push = pushChannel();
    const alice = { baseUrl: 'https://hs.example', userId: '@alice:hs', accessToken: 'tok-1' };
    const ok = { ok: true, value: undefined };

    // First sign-in and a same-account token refresh answer at once and keep the cache.
    expect(await push(validEvent, alice)).toEqual(ok);
    expect(await push(validEvent, { ...alice, accessToken: 'tok-2' })).toEqual(ok);
    expect(clearCache).not.toHaveBeenCalled();

    // A forbidden sender changes nothing.
    expect(await push({ sender: {}, senderFrame: mainFrame }, null)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(clearCache).not.toHaveBeenCalled();

    // Each of these answers only once the cache is cleared.
    const expectClearedBeforeAnswer = async (session: unknown, expected: PushResult) => {
      clearCache.mockClear();
      const answered = vi.fn();
      const answer = push(validEvent, session).then((result) => {
        answered();
        return result;
      });
      await Promise.resolve();
      expect(clearCache).toHaveBeenCalledOnce();
      expect(answered).not.toHaveBeenCalled();
      cleared();
      expect(await answer).toEqual(expected);
    };
    // Switch to another account on the same homeserver.
    await expectClearedBeforeAnswer({ ...alice, userId: '@bob:hs', accessToken: 'tok-3' }, ok);
    // Switch to the same user id on another homeserver.
    await expectClearedBeforeAnswer({ ...alice, baseUrl: 'https://other.example' }, ok);
    // Logout.
    await expectClearedBeforeAnswer(null, ok);
    // A rejected push clears the session it replaces.
    expect(await push(validEvent, alice)).toEqual(ok);
    await expectClearedBeforeAnswer(
      { ...alice, accessToken: '' },
      { ok: false, code: 'BAD_ARGUMENTS' }
    );

    // A second logout has no account to forget; a failed clear still answers.
    clearCache.mockClear();
    expect(await push(validEvent, null)).toEqual(ok);
    expect(clearCache).not.toHaveBeenCalled();
    expect(await push(validEvent, alice)).toEqual(ok);
    clearCache.mockImplementationOnce(() => Promise.reject(new Error('cache')));
    expect(await push(validEvent, null)).toEqual(ok);
  });

  it('validates IPC, clears previous session on rejected push from owner, leaves it on forbidden sender, handles throwing frame getters, and forgets on cleanup', async () => {
    const forbiddenSender = {
      id: 99,
      mainFrame: { url: 'https://evil.example/', origin: 'https://evil.example' },
      isDestroyed: () => false,
    } as unknown as Electron.WebContents;

    let beforeSend!: (
      details: Electron.OnBeforeSendHeadersListenerDetails,
      cb: (response: Electron.BeforeSendResponse) => void
    ) => void;
    let beforeRedirect!: (details: { id: number }) => void;
    let completed!: (details: { id: number }) => void;
    let errored!: (details: { id: number }) => void;

    const fakeSession = {
      clearCache: vi.fn(async () => undefined),
      webRequest: {
        onBeforeSendHeaders: vi.fn((_filter, fn) => {
          beforeSend = fn;
        }),
        onBeforeRedirect: vi.fn((_filter, fn) => {
          beforeRedirect = fn;
        }),
        onCompleted: vi.fn((_filter, fn) => {
          completed = fn;
        }),
        onErrorOccurred: vi.fn((_filter, fn) => {
          errored = fn;
        }),
      },
    } as unknown as Electron.Session;

    const forget = installMediaAuth(fakeSession, () => [owner]);

    const handler = pushChannel();

    const sendReq = (
      id: number,
      url = 'http://127.0.0.1:8008/_matrix/client/v1/media/download/hs/1',
      requestHeaders: Record<string, string> = { Accept: 'image/*' }
    ): Electron.BeforeSendResponse => {
      let response: Electron.BeforeSendResponse = {};
      beforeSend(
        {
          id,
          url,
          method: 'GET',
          webContentsId: 42,
          frame: mainFrame as unknown as Electron.WebFrameMain,
          resourceType: 'image',
          referrer: '',
          timestamp: 0,
          requestHeaders,
        },
        (res) => {
          response = res;
        }
      );
      return response;
    };

    // Bad arguments return BAD_ARGUMENTS.
    expect(
      await handler(validEvent, {
        baseUrl: 'http://remote.example',
        userId: '@a:hs',
        accessToken: 'tok',
      })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(
      await handler(validEvent, { baseUrl: 'https://hs.example', userId: '@a:hs', accessToken: '' })
    ).toEqual({
      ok: false,
      code: 'BAD_ARGUMENTS',
    });
    expect(
      await handler(validEvent, {
        baseUrl: 'https://hs.example',
        userId: '@a:hs',
        accessToken: '   ',
      })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(
      await handler(validEvent, {
        baseUrl: 'https://hs.example',
        userId: '@a:hs',
        accessToken: 'a\r\nb',
      })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(
      await handler(validEvent, {
        baseUrl: 'https://user:pass@hs.example',
        userId: '@a:hs',
        accessToken: 'tok',
      })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(await handler(validEvent, 'bad')).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(
      await handler(validEvent, { baseUrl: 'https://hs.example', accessToken: 'tok' })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(await handler(validEvent, null, 'extra')).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });

    // Valid local HTTP homeserver succeeds and injects header.
    expect(
      await handler(validEvent, {
        baseUrl: 'http://127.0.0.1:8008',
        userId: '@a:hs',
        accessToken: 'tok-local',
      })
    ).toEqual({ ok: true, value: undefined });
    expect(sendReq(100).requestHeaders?.Authorization).toBe('Bearer tok-local');

    // Strips owned header on redirect hop.
    beforeRedirect({ id: 100 });
    expect(
      sendReq(100, 'https://evil.example/steal', {
        authorization: 'Bearer tok-local',
        Accept: 'image/*',
      }).requestHeaders
    ).toEqual({ Accept: 'image/*' });
    completed({ id: 100 });
    errored({ id: 100 });

    // Forbidden sender push is rejected and does NOT disturb owner's active session.
    expect(
      await handler(
        { sender: forbiddenSender, senderFrame: forbiddenSender.mainFrame },
        { baseUrl: 'http://remote.example', userId: '@a:hs', accessToken: 'bad' }
      )
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(sendReq(101).requestHeaders?.Authorization).toBe('Bearer tok-local');

    // A rejected replacement push from the owner clears the owner's previous session.
    expect(
      await handler(validEvent, {
        baseUrl: 'http://remote.example',
        userId: '@a:hs',
        accessToken: 'tok-b',
      })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(sendReq(102).requestHeaders).toBeUndefined();

    // Restore, then verify throwing frame getter still invokes callback with {}.
    expect(
      await handler(validEvent, {
        baseUrl: 'http://127.0.0.1:8008',
        userId: '@a:hs',
        accessToken: 'tok-local',
      })
    ).toEqual({ ok: true, value: undefined });
    const cb = vi.fn();
    beforeSend(
      {
        id: 103,
        url: 'http://127.0.0.1:8008/_matrix/client/v1/media/download/hs/1',
        method: 'GET',
        webContentsId: 42,
        get frame(): Electron.WebFrameMain {
          throw new Error('frame disposed');
        },
        resourceType: 'image',
        referrer: '',
        timestamp: 0,
        requestHeaders: {},
      },
      cb
    );
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({});

    // Redirected request carrying main's header still strips it even if frame getter throws.
    expect(sendReq(105).requestHeaders?.Authorization).toBe('Bearer tok-local');
    beforeRedirect({ id: 105 });
    const stripCb = vi.fn();
    beforeSend(
      {
        id: 105,
        url: 'https://evil.example/steal',
        method: 'GET',
        webContentsId: 42,
        get frame(): Electron.WebFrameMain {
          throw new Error('frame disposed');
        },
        resourceType: 'image',
        referrer: '',
        timestamp: 0,
        requestHeaders: { Authorization: 'Bearer tok-local', Accept: 'image/*' },
      },
      stripCb
    );
    expect(stripCb).toHaveBeenCalledOnce();
    expect(stripCb).toHaveBeenCalledWith({ requestHeaders: { Accept: 'image/*' } });

    // Redirected request carrying a caller's bearer with a throwing frame getter stays unchanged.
    const callerCb = vi.fn();
    beforeSend(
      {
        id: 105,
        url: 'https://evil.example/steal',
        method: 'GET',
        webContentsId: 42,
        get frame(): Electron.WebFrameMain {
          throw new Error('frame disposed');
        },
        resourceType: 'image',
        referrer: '',
        timestamp: 0,
        requestHeaders: { Authorization: 'Bearer caller-tok', Accept: 'image/*' },
      },
      callerCb
    );
    expect(callerCb).toHaveBeenCalledOnce();
    expect(callerCb).toHaveBeenCalledWith({});
    completed({ id: 105 });

    // Forgetting the window clears its session.
    forget(42);
    expect(sendReq(104).requestHeaders).toBeUndefined();
  });
});
