import { afterEach, describe, expect, it, vi } from 'vitest';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
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
    auth.set(10, { baseUrl: 'https://hs.example', accessToken: 'tok-a' });

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
    auth.set(10, { baseUrl: 'https://hs.example/matrix', accessToken: 'tok-a' });

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

  it('refuses non-GET methods such as POST and OPTIONS', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://hs.example', accessToken: 'tok-a' });

    expect(auth.authorize(makeReq({ id: 1, method: 'POST' }))).toBeUndefined();
    expect(auth.authorize(makeReq({ id: 2, method: 'OPTIONS' }))).toBeUndefined();
  });

  it('never answers or strips a request that already carries Authorization', () => {
    const auth = createMediaAuth();
    auth.set(10, { baseUrl: 'https://hs.example', accessToken: 'tok-a' });

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
    auth.set(10, { baseUrl: 'https://a.example', accessToken: 'tok-a' });
    auth.set(20, { baseUrl: 'https://b.example', accessToken: 'tok-b' });

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
    auth.set(10, { baseUrl: 'https://a.example', accessToken: 'tok-a' });
    auth.set(20, { baseUrl: 'https://b.example', accessToken: 'tok-b' });

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
    auth.set(10, { baseUrl: 'https://a.example', accessToken: 'tok-a' });

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
    auth.set(10, { baseUrl: 'https://hs.example', accessToken: 'tok-1' });
    expect(auth.authorize(makeReq({ id: 1 }))).toBe('Bearer tok-1');

    auth.set(10, { baseUrl: 'https://hs.example', accessToken: 'tok-2' });
    expect(auth.authorize(makeReq({ id: 2 }))).toBe('Bearer tok-2');

    auth.set(10, undefined);
    expect(auth.authorize(makeReq({ id: 3 }))).toBeUndefined();
  });
});

describe('installMediaAuth', () => {
  afterEach(() => {
    ipcMainMock.handle.mockReset();
  });

  it('validates IPC, clears previous session on rejected push from owner, leaves it on forbidden sender, handles throwing frame getters, and forgets on cleanup', async () => {
    const mainFrame = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN };
    const owner = {
      id: 42,
      mainFrame,
      isDestroyed: () => false,
    } as unknown as Electron.WebContents;
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

    const ipcCall = ipcMainMock.handle.mock.calls.find(
      (call) => call[0] === 'desktop:set-media-session'
    );
    expect(ipcCall).toBeDefined();
    const handler = ipcCall![1] as (
      event: { sender: unknown; senderFrame: unknown },
      ...args: unknown[]
    ) => Promise<{ ok: boolean; code?: string }>;
    const validEvent = { sender: owner, senderFrame: mainFrame };

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
      await handler(validEvent, { baseUrl: 'http://remote.example', accessToken: 'tok' })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(await handler(validEvent, { baseUrl: 'https://hs.example', accessToken: '' })).toEqual({
      ok: false,
      code: 'BAD_ARGUMENTS',
    });
    expect(
      await handler(validEvent, { baseUrl: 'https://hs.example', accessToken: '   ' })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(
      await handler(validEvent, { baseUrl: 'https://hs.example', accessToken: 'a\r\nb' })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(
      await handler(validEvent, { baseUrl: 'https://user:pass@hs.example', accessToken: 'tok' })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(await handler(validEvent, 'bad')).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });

    // Valid local HTTP homeserver succeeds and injects header.
    expect(
      await handler(validEvent, { baseUrl: 'http://127.0.0.1:8008', accessToken: 'tok-local' })
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
        { baseUrl: 'http://remote.example', accessToken: 'bad' }
      )
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(sendReq(101).requestHeaders?.Authorization).toBe('Bearer tok-local');

    // A rejected replacement push from the owner clears the owner's previous session.
    expect(
      await handler(validEvent, { baseUrl: 'http://remote.example', accessToken: 'tok-b' })
    ).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(sendReq(102).requestHeaders).toBeUndefined();

    // Restore, then verify throwing frame getter still invokes callback with {}.
    expect(
      await handler(validEvent, { baseUrl: 'http://127.0.0.1:8008', accessToken: 'tok-local' })
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

    // Forgetting the window clears its session.
    forget(42);
    expect(sendReq(104).requestHeaders).toBeUndefined();
  });
});
