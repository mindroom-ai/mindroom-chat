import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

import {
  createAuthCallback,
  isSignInUrl,
  registerSignInHandlers,
  returnToken,
  type PendingSignIn,
} from './authCallback';
import { APP_ORIGIN } from './bundleProtocol';

const rawRequest = (
  port: number,
  options: { method?: string; host?: string; path: string }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: options.host !== undefined ? { host: options.host } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });

/** A request written by hand, so it can carry the `Host` header more than once. */
const statusWithHosts = (port: number, path: string, hosts: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        ...hosts.map((h) => `Host: ${h}`),
        'Connection: close',
      ];
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    let text = '';
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    socket.on('end', () => resolve(Number(text.split(' ')[1])));
    socket.on('error', reject);
  });

const PENDING: PendingSignIn = {
  homeserver: 'https://matrix.example.org',
  redirectUrl:
    'http://127.0.0.1:43210/auth/deadbeef/login/matrix.example.org/?ssoNonce=nonce123&addAccount=1',
};

describe('isSignInUrl', () => {
  it('accepts v3 and r0 SSO redirect URLs for the pending homeserver and exact redirectUrl', () => {
    const redirect = encodeURIComponent(PENDING.redirectUrl);
    expect(
      isSignInUrl(
        `https://matrix.example.org/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}`,
        PENDING
      )
    ).toBe(true);
    expect(
      isSignInUrl(
        `https://matrix.example.org/_matrix/client/r0/login/sso/redirect/apple?redirectUrl=${redirect}&action=login`,
        PENDING
      )
    ).toBe(true);
    const subpathPending: PendingSignIn = {
      homeserver: 'http://127.0.0.1:28008/sub/',
      redirectUrl: PENDING.redirectUrl,
    };
    expect(
      isSignInUrl(
        `http://127.0.0.1:28008/sub/_matrix/client/v3/login/sso/redirect/oidc-e2e?redirectUrl=${redirect}`,
        subpathPending
      )
    ).toBe(true);
  });

  it('refuses another host, another path, credentials, duplicate or altered redirectUrl, and non-http schemes', () => {
    const redirect = encodeURIComponent(PENDING.redirectUrl);
    const base = 'https://matrix.example.org/_matrix/client/v3/login/sso/redirect';
    const cases = [
      // Another host / port / scheme
      `https://evil.example/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}`,
      `http://matrix.example.org/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}`,
      `https://matrix.example.org:8448/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}`,
      // Another path or extra segments or traversal
      `https://matrix.example.org/_matrix/client/v3/login?redirectUrl=${redirect}`,
      `https://matrix.example.org/_matrix/client/v3/login/sso/redirect/apple/extra?redirectUrl=${redirect}`,
      `https://matrix.example.org/_matrix/client/v3/login/sso/redirect/..?redirectUrl=${redirect}`,
      `https://matrix.example.org/_matrix/client/v3/login/sso/redirect/a%2fb?redirectUrl=${redirect}`,
      `https://matrix.example.org/_matrix/client/v1/media/download/a/b?redirectUrl=${redirect}`,
      // Credentials
      `https://user:pass@matrix.example.org/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}`,
      `https://user@matrix.example.org/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}`,
      // Two redirectUrls
      `${base}?redirectUrl=${redirect}&redirectUrl=${redirect}`,
      `${base}?redirectUrl=${redirect}&redirectUrl=${encodeURIComponent('https://evil.example/')}`,
      // Missing or altered redirectUrl (route, query, nonce)
      `${base}`,
      `${base}?redirectUrl=${encodeURIComponent(
        'http://127.0.0.1:43210/auth/deadbeef/other/?ssoNonce=nonce123&addAccount=1'
      )}`,
      `${base}?redirectUrl=${encodeURIComponent(
        'http://127.0.0.1:43210/auth/deadbeef/login/matrix.example.org/?ssoNonce=nonce123'
      )}`,
      `${base}?redirectUrl=${encodeURIComponent(
        'http://127.0.0.1:43210/auth/deadbeef/login/matrix.example.org/?ssoNonce=other&addAccount=1'
      )}`,
      // Backslash authority/path tricks, whitespace, dot segments, javascript:
      `https://matrix.example.org\\@evil.example/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}`,
      `https://matrix.example.org/_matrix/client/v3/login/sso/redirect\\?redirectUrl=${redirect}`,
      ` https://matrix.example.org/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}`,
      `https://matrix.example.org/_matrix/client/v3/login/sso/redirect/./apple?redirectUrl=${redirect}`,
      `https://matrix.example.org/_matrix/client/v3/login/sso/redirect?redirectUrl=${redirect}#frag`,
      'javascript:alert(1)',
    ];
    for (const candidate of cases) {
      expect(isSignInUrl(candidate, PENDING), candidate).toBe(false);
    }
  });
});

describe('returnToken', () => {
  const HOST = '127.0.0.1:43210';
  const PATH = '/auth/deadbeef/login/matrix.example.org/';
  const QUERY = 'ssoNonce=nonce123&addAccount=1';
  const get = (url: string, host = HOST, method = 'GET') =>
    returnToken({ method, host, url }, PENDING);

  it('yields the one loginToken of a GET with the exact Host, path and stored query', () => {
    expect(get(`${PATH}?${QUERY}&loginToken=tok_ok`)).toBe('tok_ok');
    // Stored parameters in another order still match; the token comes back decoded.
    expect(get(`${PATH}?loginToken=tok%2B1&addAccount=1&ssoNonce=nonce123`)).toBe('tok+1');
  });

  it.each([
    ['POST', () => get(`${PATH}?${QUERY}&loginToken=tok_ok`, HOST, 'POST')],
    ['HEAD', () => get(`${PATH}?${QUERY}&loginToken=tok_ok`, HOST, 'HEAD')],
    ['another host', () => get(`${PATH}?${QUERY}&loginToken=tok_ok`, 'localhost:43210')],
    ['another port', () => get(`${PATH}?${QUERY}&loginToken=tok_ok`, '127.0.0.1:9999')],
    ['no Host', () => get(`${PATH}?${QUERY}&loginToken=tok_ok`, '')],
    ['another path', () => get(`/auth/other/login/matrix.example.org/?${QUERY}&loginToken=tok_ok`)],
    [
      'a dot segment',
      () => get(`/auth/x/../deadbeef/login/matrix.example.org/?${QUERY}&loginToken=t`),
    ],
    ['a doubled slash', () => get(`/${PATH}?${QUERY}&loginToken=tok_ok`)],
    ['an absolute URL', () => get(`http://${HOST}${PATH}?${QUERY}&loginToken=tok_ok`)],
    [
      'a changed stored parameter',
      () => get(`${PATH}?ssoNonce=wrong&addAccount=1&loginToken=tok_ok`),
    ],
    ['a missing stored parameter', () => get(`${PATH}?ssoNonce=nonce123&loginToken=tok_ok`)],
    ['an added parameter', () => get(`${PATH}?${QUERY}&loginToken=tok_ok&extra=1`)],
    ['a stored parameter twice', () => get(`${PATH}?${QUERY}&loginToken=tok_ok&ssoNonce=nonce123`)],
    ['two loginTokens', () => get(`${PATH}?${QUERY}&loginToken=tok_ok&loginToken=tok_second`)],
    ['no loginToken', () => get(`${PATH}?${QUERY}`)],
    ['no query', () => get(PATH)],
    ['an empty loginToken', () => get(`${PATH}?${QUERY}&loginToken=`)],
    ['a blank loginToken', () => get(`${PATH}?${QUERY}&loginToken=%20`)],
  ])('refuses %s', (_label, run) => {
    expect(run()).toBeUndefined();
  });
});

describe('createAuthCallback', () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    while (closers.length > 0) closers.pop()?.();
    vi.restoreAllMocks();
  });

  const make = (focus: () => void = () => undefined) => {
    const notify = vi.fn();
    const focused = vi.fn(focus);
    const cb = createAuthCallback(notify, focused);
    closers.push(() => cb.close());
    return { cb, notify, focus: focused };
  };

  /** A start after a gesture, with the sign-in URL the page would open and a way to return. */
  const begin = async (cb: ReturnType<typeof make>['cb'], name: string) => {
    cb.noteGesture();
    const pending = await cb.start({
      homeserver: `https://${name}.example`,
      callback: `/login/${name}.example/?ssoNonce=${name}`,
    });
    if (!pending) throw new Error('start was refused');
    const redirect = new URL(pending.redirectUrl);
    return {
      redirect,
      signInUrl: `https://${name}.example/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(
        pending.redirectUrl
      )}`,
      appUrl: `mindroom://auth/login/${name}.example/?ssoNonce=${name}&loginToken=tok_${name}`,
      sendReturn: async () =>
        (
          await rawRequest(Number(redirect.port), {
            host: redirect.host,
            path: `${redirect.pathname}${redirect.search}&loginToken=tok_${name}`,
          })
        ).status,
    };
  };

  it('refuses a non-local HTTP homeserver, a fragment, two nonces, or a loginToken in callback', async () => {
    const { cb } = make();
    const hs = 'https://matrix.example.org';
    for (const request of [
      { homeserver: 'http://matrix.example.org', callback: '/login/a/?ssoNonce=n1' },
      { homeserver: 'https://user:pass@matrix.example.org', callback: '/login/a/?ssoNonce=n1' },
      { homeserver: hs, callback: '/login/a/?ssoNonce=n1#frag' },
      { homeserver: hs, callback: '/login/a/?ssoNonce=n1&ssoNonce=n2' },
      { homeserver: hs, callback: '/login/a/?ssoNonce=n1&loginToken=tok' },
      { homeserver: hs, callback: 'login/a/?ssoNonce=n1' },
      { homeserver: hs, callback: '//evil.example/?ssoNonce=n1' },
      { homeserver: hs, callback: '/login/a/' },
      { homeserver: hs, callback: '/../evil?ssoNonce=n1' },
      { homeserver: hs, callback: '/./login?ssoNonce=n1' },
      { homeserver: hs, callback: '/login/../../evil?ssoNonce=n1' },
      { homeserver: hs, callback: '/%2e%2e/evil?ssoNonce=n1' },
      { homeserver: hs, callback: '/%2E/evil?ssoNonce=n1' },
      { homeserver: hs, callback: '/..%2fevil?ssoNonce=n1' },
    ]) {
      cb.noteGesture();
      await expect(cb.start(request), request.callback).rejects.toThrow(RangeError);
    }
  });

  it('starts only after a gesture of the last 10 seconds, and uses it up', async () => {
    const { cb } = make();
    const request = { homeserver: 'https://a.example', callback: '/login/a.example/?ssoNonce=a' };
    expect(await cb.start(request)).toBeUndefined();

    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    cb.noteGesture();
    clock.mockReturnValue(now + 10_001);
    expect(await cb.start(request)).toBeUndefined();

    cb.noteGesture();
    clock.mockReturnValue(now + 20_000);
    const first = await cb.start(request);
    expect(first?.redirectUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/[0-9a-f]{32}\/login\/a\.example\/\?ssoNonce=a$/
    );
    // The gesture is spent: a second start is refused and leaves the first attempt as it was.
    expect(await cb.start(request)).toBeUndefined();
    expect(
      cb.open(
        `https://a.example/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(
          first?.redirectUrl ?? ''
        )}`
      )
    ).toBe(true);
  });

  it('opens once per attempt, only its own openable sign-in URL', async () => {
    const { cb } = make();
    expect(cb.open('https://a.example/_matrix/client/v3/login/sso/redirect')).toBe(false);
    const a = await begin(cb, 'a');
    // Refused URLs leave the attempt waiting for its own.
    expect(cb.open('https://example.org/')).toBe(false);
    expect(cb.open(a.signInUrl.replace('a.example', 'b.example'))).toBe(false);
    expect(cb.open(`${a.signInUrl}&access_token=syt_placeholder`)).toBe(false);
    expect(cb.open(`${a.signInUrl}&action=login`)).toBe(true);
    expect(cb.open(a.signInUrl)).toBe(false);
    expect(await a.sendReturn()).toBe(200);
    expect(cb.open(a.signInUrl)).toBe(false);
  });

  it('takes one valid return, only once opened, after any wrong requests, and hands it over once', async () => {
    const { cb, notify, focus } = make();
    const a = await begin(cb, 'a');
    const port = Number(a.redirect.port);
    const path = `${a.redirect.pathname}${a.redirect.search}&loginToken=tok_a`;

    // Started but not opened: the browser cannot have the URL yet.
    expect(await a.sendReturn()).toBe(404);
    expect(cb.open(a.signInUrl)).toBe(true);

    expect((await rawRequest(port, { path: '/wrong' })).status).toBe(404);
    expect((await rawRequest(port, { method: 'POST', host: a.redirect.host, path })).status).toBe(
      404
    );
    expect((await rawRequest(port, { host: `localhost:${port}`, path })).status).toBe(404);
    // The Host header twice, even with the right value both times.
    expect(await statusWithHosts(port, path, [a.redirect.host, a.redirect.host])).toBe(404);
    expect(await statusWithHosts(port, path, ['evil.example', a.redirect.host])).toBe(404);
    expect(notify).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(cb.take()).toBeUndefined();

    const ok = await rawRequest(port, { host: a.redirect.host, path });
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith();
    expect(focus).toHaveBeenCalledTimes(1);

    // The same return again changes nothing; the first take gets the URL, the second nothing.
    expect(await a.sendReturn()).toBe(404);
    expect(cb.take()).toBe(a.appUrl);
    expect(cb.take()).toBeUndefined();
    expect(await a.sendReturn()).toBe(404);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('still notifies when the window cannot be focused', async () => {
    const { cb, notify } = make(() => {
      throw new Error('window is gone');
    });
    const a = await begin(cb, 'a');
    expect(cb.open(a.signInUrl)).toBe(true);
    expect(await a.sendReturn()).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(cb.take()).toBe(a.appUrl);
  });

  it('replaces an earlier attempt in any state on a new start, its untaken return included', async () => {
    const { cb } = make();
    // A returned but was not taken; then B starts.
    const a = await begin(cb, 'a');
    expect(cb.open(a.signInUrl)).toBe(true);
    expect(await a.sendReturn()).toBe(200);
    const b = await begin(cb, 'b');
    expect(cb.take()).toBeUndefined();
    expect(b.redirect.port).toBe(a.redirect.port);
    expect(b.redirect.pathname).not.toBe(a.redirect.pathname);

    // B is open in the browser; then C starts: B's return and B's sign-in URL are dead.
    expect(cb.open(b.signInUrl)).toBe(true);
    const c = await begin(cb, 'c');
    expect(await b.sendReturn()).toBe(404);
    expect(cb.open(b.signInUrl)).toBe(false);
    expect(cb.open(a.signInUrl)).toBe(false);

    expect(cb.open(c.signInUrl)).toBe(true);
    expect(await a.sendReturn()).toBe(404);
    expect(await c.sendReturn()).toBe(200);
    expect(cb.take()).toBe(c.appUrl);
  });

  it('ends an attempt in any state 30 minutes after its start, an untaken return included', async () => {
    const { cb } = make();
    const HALF_HOUR = 30 * 60 * 1000;
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const a = await begin(cb, 'a');
    now += HALF_HOUR;
    expect(cb.open(a.signInUrl)).toBe(false);

    const b = await begin(cb, 'b');
    now += HALF_HOUR - 1;
    expect(cb.open(b.signInUrl)).toBe(true);
    now += 1;
    expect(await b.sendReturn()).toBe(404);

    const c = await begin(cb, 'c');
    expect(cb.open(c.signInUrl)).toBe(true);
    now += HALF_HOUR - 1;
    expect(await c.sendReturn()).toBe(200);
    now += 1;
    expect(cb.take()).toBeUndefined();
  });

  it('forgets everything and refuses a start once closed', async () => {
    const { cb } = make();
    const a = await begin(cb, 'a');
    expect(cb.open(a.signInUrl)).toBe(true);
    expect(await a.sendReturn()).toBe(200);
    cb.close();
    expect(cb.take()).toBeUndefined();
    cb.noteGesture();
    await expect(
      cb.start({ homeserver: 'https://a.example', callback: '/login/a.example/?ssoNonce=a' })
    ).rejects.toThrow();
  });
});

describe('sign-in IPC channels', () => {
  it('check the sender and the arguments, and pass through the one attempt', async () => {
    ipcHandlers.clear();
    const opened: string[] = [];
    const mainFrame = { url: `${APP_ORIGIN}/login`, origin: APP_ORIGIN };
    const owner = { isDestroyed: () => false, mainFrame } as unknown as Electron.WebContents;
    const cb = createAuthCallback(
      () => undefined,
      () => undefined
    );
    registerSignInHandlers(
      () => [owner],
      cb,
      async (url) => {
        opened.push(url);
      }
    );
    const event = { sender: owner, senderFrame: mainFrame };
    const frameEvent = {
      sender: owner,
      senderFrame: { url: `${APP_ORIGIN}/canvas-frame.html`, origin: APP_ORIGIN },
    };
    const start = ipcHandlers.get('desktop:start-sign-in')!;
    const open = ipcHandlers.get('desktop:open-sign-in')!;
    const take = ipcHandlers.get('desktop:take-app-url')!;
    const request = {
      homeserver: 'https://hs.example',
      callback: '/login/hs.example/?ssoNonce=n1',
    };
    const forbidden = { ok: false, code: 'FORBIDDEN' };
    const badArguments = { ok: false, code: 'BAD_ARGUMENTS' };
    try {
      cb.noteGesture();
      expect(await start(frameEvent, request)).toEqual(forbidden);
      expect(await open(frameEvent, 'https://hs.example/')).toEqual(forbidden);
      expect(await take(frameEvent)).toEqual(forbidden);

      expect(await start(event)).toEqual(badArguments);
      expect(await start(event, request, request)).toEqual(badArguments);
      expect(await start(event, { ...request, homeserver: 'http://hs.example' })).toEqual(
        badArguments
      );
      expect(await open(event)).toEqual(badArguments);
      expect(await open(event, 123)).toEqual(badArguments);
      expect(await take(event, 'extra')).toEqual(badArguments);

      const started = (await start(event, request)) as { ok: true; value: string };
      expect(started.ok).toBe(true);
      // No gesture since: the page cannot start another one by itself.
      expect(await start(event, request)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

      const signInUrl = `https://hs.example/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(
        started.value
      )}`;
      expect(await open(event, 'https://example.org/')).toEqual(badArguments);
      expect(await open(event, `${signInUrl}&access_token=syt_placeholder`)).toEqual(badArguments);
      expect(opened).toEqual([]);
      expect(await open(event, signInUrl)).toEqual({ ok: true, value: undefined });
      expect(await open(event, signInUrl)).toEqual(badArguments);
      expect(opened).toEqual([signInUrl]);

      expect(await take(event)).toEqual({ ok: true, value: undefined });
      const redirect = new URL(started.value);
      const sent = await rawRequest(Number(redirect.port), {
        host: redirect.host,
        path: `${redirect.pathname}${redirect.search}&loginToken=tok_1`,
      });
      expect(sent.status).toBe(200);
      expect(await take(event)).toEqual({
        ok: true,
        value: 'mindroom://auth/login/hs.example/?ssoNonce=n1&loginToken=tok_1',
      });
      expect(await take(event)).toEqual({ ok: true, value: undefined });
    } finally {
      cb.close();
    }
  });
});
