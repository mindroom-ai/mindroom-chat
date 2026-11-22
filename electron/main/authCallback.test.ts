import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthCallback, isReturn, isSignInUrl, type PendingSignIn } from './authCallback';

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
      // javascript:
      'javascript:alert(1)',
    ];
    for (const candidate of cases) {
      expect(isSignInUrl(candidate, PENDING), candidate).toBe(false);
    }
  });
});

describe('isReturn', () => {
  const validPath =
    '/auth/deadbeef/login/matrix.example.org/?ssoNonce=nonce123&addAccount=1&loginToken=tok_ok';

  it('accepts a GET with exact Host, path, stored query params, and one loginToken', () => {
    expect(isReturn({ method: 'GET', host: '127.0.0.1:43210', url: validPath }, PENDING)).toBe(
      true
    );
    // Stored params in another order still match.
    expect(
      isReturn(
        {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: '/auth/deadbeef/login/matrix.example.org/?loginToken=tok_ok&addAccount=1&ssoNonce=nonce123',
        },
        PENDING
      )
    ).toBe(true);
  });

  it('refuses wrong method, Host, path, altered/missing/extra/duplicate params, and missing or duplicate loginToken', () => {
    const cases: Array<{ label: string; req: { method: string; host: string; url: string } }> = [
      { label: 'POST', req: { method: 'POST', host: '127.0.0.1:43210', url: validPath } },
      { label: 'HEAD', req: { method: 'HEAD', host: '127.0.0.1:43210', url: validPath } },
      { label: 'wrong host', req: { method: 'GET', host: 'localhost:43210', url: validPath } },
      { label: 'wrong port', req: { method: 'GET', host: '127.0.0.1:9999', url: validPath } },
      {
        label: 'wrong path',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: '/auth/other/login/matrix.example.org/?ssoNonce=nonce123&addAccount=1&loginToken=tok_ok',
        },
      },
      {
        label: 'dot segment path',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: '/auth/x/../deadbeef/login/matrix.example.org/?ssoNonce=nonce123&addAccount=1&loginToken=tok_ok',
        },
      },
      {
        label: 'changed stored param',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: '/auth/deadbeef/login/matrix.example.org/?ssoNonce=wrong&addAccount=1&loginToken=tok_ok',
        },
      },
      {
        label: 'missing stored param',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: '/auth/deadbeef/login/matrix.example.org/?ssoNonce=nonce123&loginToken=tok_ok',
        },
      },
      {
        label: 'added param',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: `${validPath}&extra=1`,
        },
      },
      {
        label: 'duplicate stored param',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: `${validPath}&ssoNonce=nonce123`,
        },
      },
      {
        label: 'two loginTokens',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: `${validPath}&loginToken=tok_second`,
        },
      },
      {
        label: 'no loginToken',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: '/auth/deadbeef/login/matrix.example.org/?ssoNonce=nonce123&addAccount=1',
        },
      },
      {
        label: 'empty loginToken',
        req: {
          method: 'GET',
          host: '127.0.0.1:43210',
          url: '/auth/deadbeef/login/matrix.example.org/?ssoNonce=nonce123&addAccount=1&loginToken=',
        },
      },
    ];
    for (const { label, req } of cases) {
      expect(isReturn(req, PENDING), label).toBe(false);
    }
  });
});

describe('createAuthCallback', () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    vi.useRealTimers();
    while (closers.length > 0) closers.pop()?.();
  });

  const make = () => {
    const delivered: string[] = [];
    const focus = vi.fn();
    const cb = createAuthCallback((url) => delivered.push(url), focus);
    closers.push(() => cb.close());
    return { cb, delivered, focus };
  };

  it('refuses a non-local HTTP homeserver, a fragment, two nonces, or a loginToken in callback', async () => {
    const { cb } = make();
    await expect(
      cb.start({ homeserver: 'http://matrix.example.org', callback: '/login/a/?ssoNonce=n1' })
    ).rejects.toThrow();
    await expect(
      cb.start({
        homeserver: 'https://user:pass@matrix.example.org',
        callback: '/login/a/?ssoNonce=n1',
      })
    ).rejects.toThrow();
    await expect(
      cb.start({
        homeserver: 'https://matrix.example.org',
        callback: '/login/a/?ssoNonce=n1#frag',
      })
    ).rejects.toThrow();
    await expect(
      cb.start({
        homeserver: 'https://matrix.example.org',
        callback: '/login/a/?ssoNonce=n1&ssoNonce=n2',
      })
    ).rejects.toThrow();
    await expect(
      cb.start({
        homeserver: 'https://matrix.example.org',
        callback: '/login/a/?ssoNonce=n1&loginToken=tok',
      })
    ).rejects.toThrow();
    await expect(
      cb.start({
        homeserver: 'https://matrix.example.org',
        callback: 'login/a/?ssoNonce=n1',
      })
    ).rejects.toThrow();
    await expect(
      cb.start({
        homeserver: 'https://matrix.example.org',
        callback: '/login/a/',
      })
    ).rejects.toThrow();
    expect(cb.pending()).toBeUndefined();
  });

  it('delivers a valid return once and focuses, even after wrong requests', async () => {
    const { cb, delivered, focus } = make();
    const started = await cb.start({
      homeserver: 'http://127.0.0.1:28008',
      callback: '/login/http%3A%2F%2F127.0.0.1%3A28008/?ssoNonce=abc',
    });
    const redirect = new URL(started.redirectUrl);
    const port = Number(redirect.port);
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(port).toBeGreaterThan(0);

    // Wrong requests first: 404 and pending sign-in stays intact.
    const wrong1 = await rawRequest(port, { path: '/wrong' });
    expect(wrong1.status).toBe(404);
    const wrong2 = await rawRequest(port, {
      method: 'POST',
      host: redirect.host,
      path: `${redirect.pathname}${redirect.search}&loginToken=tok1`,
    });
    expect(wrong2.status).toBe(404);
    const wrong3 = await rawRequest(port, {
      host: `localhost:${port}`,
      path: `${redirect.pathname}${redirect.search}&loginToken=tok1`,
    });
    expect(wrong3.status).toBe(404);
    expect(delivered).toEqual([]);
    expect(focus).not.toHaveBeenCalled();
    expect(cb.pending()).toEqual(started);

    // Valid return after the wrong requests succeeds once.
    const ok = await rawRequest(port, {
      host: redirect.host,
      path: `${redirect.pathname}${redirect.search}&loginToken=tok%2B1`,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(delivered).toEqual([
      'mindroom://auth/login/http%3A%2F%2F127.0.0.1%3A28008/?ssoNonce=abc&loginToken=tok%2B1',
    ]);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(cb.pending()).toBeUndefined();

    // Replaying the same valid return gets 404 and delivers nothing.
    const replay = await rawRequest(port, {
      host: redirect.host,
      path: `${redirect.pathname}${redirect.search}&loginToken=tok%2B1`,
    });
    expect(replay.status).toBe(404);
    expect(delivered).toHaveLength(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('reuses the port on a second start and forgets the first sign-in', async () => {
    const { cb, delivered, focus } = make();
    const first = await cb.start({
      homeserver: 'https://hs1.example',
      callback: '/login/hs1.example/?ssoNonce=first',
    });
    const second = await cb.start({
      homeserver: 'https://hs2.example',
      callback: '/login/hs2.example/?ssoNonce=second',
    });
    const firstUrl = new URL(first.redirectUrl);
    const secondUrl = new URL(second.redirectUrl);
    expect(secondUrl.port).toBe(firstUrl.port);
    expect(secondUrl.pathname).not.toBe(firstUrl.pathname);

    const port = Number(secondUrl.port);
    const stale = await rawRequest(port, {
      host: firstUrl.host,
      path: `${firstUrl.pathname}${firstUrl.search}&loginToken=old`,
    });
    expect(stale.status).toBe(404);
    expect(delivered).toEqual([]);

    const fresh = await rawRequest(port, {
      host: secondUrl.host,
      path: `${secondUrl.pathname}${secondUrl.search}&loginToken=new`,
    });
    expect(fresh.status).toBe(200);
    expect(delivered).toEqual([
      'mindroom://auth/login/hs2.example/?ssoNonce=second&loginToken=new',
    ]);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('expires the pending sign-in after 30 minutes', async () => {
    const { cb, delivered } = make();
    const started = await cb.start({
      homeserver: 'https://matrix.example.org',
      callback: '/login/matrix.example.org/?ssoNonce=expiring',
    });
    const redirect = new URL(started.redirectUrl);
    const port = Number(redirect.port);

    // Advance system time past 30 minutes without blocking socket I/O.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    // Start again under fake timers so the expiry timer is scheduled on the fake clock.
    const timed = await cb.start({
      homeserver: 'https://matrix.example.org',
      callback: '/login/matrix.example.org/?ssoNonce=expiring2',
    });
    const timedUrl = new URL(timed.redirectUrl);
    expect(cb.pending()).toEqual(timed);

    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(cb.pending()).toBeUndefined();

    const late = await rawRequest(port, {
      host: timedUrl.host,
      path: `${timedUrl.pathname}${timedUrl.search}&loginToken=late`,
    });
    expect(late.status).toBe(404);
    expect(delivered).toEqual([]);
  });
});
