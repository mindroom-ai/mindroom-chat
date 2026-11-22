import crypto from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isAllowedHomeserverBaseUrl } from '../../src/app/matrix/cs-api';
import { handle } from './ipc';
import { isOpenable } from './security';

export type PendingSignIn = { homeserver: string; redirectUrl: string };
export type SignInRequest = { homeserver: string; callback: string };

/**
 * The one sign-in attempt: `started` (the page has its `redirectUrl`), `opened` (the browser has
 * the sign-in URL), `returned` (the listener holds the return for the page). Taking it ends it.
 */
type Attempt = {
  state: 'started' | 'opened' | 'returned';
  pending: PendingSignIn;
  callback: string;
  expiresAt: number;
  appUrl?: string;
};

const LIFETIME_MS = 30 * 60 * 1000;
const GESTURE_MS = 10_000;
const SSO_ROUTE = /^\/_matrix\/client\/(?:v3|r0)\/login\/sso\/redirect(?:\/[^/]+)?$/;
const DONE_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>MindRoom</title></head><body><p>Sign-in complete. You can close this tab and return to MindRoom.</p></body></html>';
const DONE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
};

const toUrl = (raw: string, base?: string): URL | undefined => {
  try {
    return new URL(raw, base);
  } catch {
    return undefined;
  }
};

const toHomeserver = (raw: string): URL | undefined => {
  const u = isAllowedHomeserverBaseUrl(raw) ? toUrl(raw) : undefined;
  return u && !u.username && !u.password && !u.search && !u.hash ? u : undefined;
};

/** A `.` or `..` segment, also one that only shows once an encoded slash is decoded. */
const hasDotSegment = (pathname: string): boolean => {
  if (/%(?:2e|5c)/i.test(pathname)) return true;
  try {
    const segments = decodeURIComponent(pathname).split('/');
    return segments.some((segment) => segment === '.' || segment === '..');
  } catch {
    return true;
  }
};

export const parseSignInRequest = (raw: unknown): SignInRequest | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { homeserver, callback } = raw as Record<string, unknown>;
  if (typeof homeserver !== 'string' || typeof callback !== 'string' || !toHomeserver(homeserver))
    return undefined;
  if (!callback.startsWith('/') || callback.startsWith('//') || /[\\#\r\n\0]/.test(callback))
    return undefined;
  const rawPath = callback.split('?', 1)[0] ?? '';
  if (hasDotSegment(rawPath)) return undefined;
  const parsed = toUrl(callback, 'http://127.0.0.1');
  if (!parsed || parsed.origin !== 'http://127.0.0.1' || parsed.pathname !== rawPath)
    return undefined;
  const keys = Array.from(parsed.searchParams.keys());
  if (
    new Set(keys).size !== keys.length ||
    keys.includes('loginToken') ||
    !parsed.searchParams.get('ssoNonce')
  )
    return undefined;
  return { homeserver, callback };
};

/** `url`, already in canonical form, is the pending homeserver's SSO route with its `redirectUrl`. */
export const isSignInUrl = (url: string, pending: PendingSignIn): boolean => {
  const hs = toHomeserver(pending.homeserver);
  const target = toUrl(url);
  if (!hs || !target || url !== target.href || target.origin !== hs.origin) return false;
  if (target.username || target.password || target.hash) return false;
  const base = hs.pathname.replace(/\/+$/, '');
  const route = target.pathname.startsWith(base) ? target.pathname.slice(base.length) : '';
  const redirects = target.searchParams.getAll('redirectUrl');
  return (
    SSO_ROUTE.test(route) &&
    !/%(?:2f|5c|2e)/i.test(route) &&
    redirects.length === 1 &&
    redirects[0] === pending.redirectUrl
  );
};

/** The `loginToken` of a request that is the pending sign-in's return, else `undefined`. */
export const returnToken = (
  { method, host, url }: { method: string; host: string; url: string },
  pending: PendingSignIn
): string | undefined => {
  const expected = toUrl(pending.redirectUrl);
  const queryAt = url.indexOf('?');
  if (!expected || method !== 'GET' || host !== expected.host || queryAt < 0) return undefined;
  if (url.slice(0, queryAt) !== expected.pathname) return undefined;
  const query = new URLSearchParams(url.slice(queryAt + 1));
  const tokens = query.getAll('loginToken');
  query.delete('loginToken');
  // The stored query has no key twice, so an equal sorted query has none twice either.
  query.sort();
  expected.searchParams.sort();
  if (tokens.length !== 1 || query.toString() !== expected.searchParams.toString())
    return undefined;
  return tokens[0]?.trim() ? tokens[0] : undefined;
};

export const createAuthCallback = (notify: () => void, focus: () => void) => {
  let server: http.Server | undefined;
  let listening: Promise<number | undefined> | undefined;
  let attempt: Attempt | undefined;
  let gestureAt = -Infinity;
  let closed = false;

  /** The attempt, in whatever state, until 30 minutes after its start. */
  const current = (): Attempt | undefined => {
    if (attempt && Date.now() >= attempt.expiresAt) attempt = undefined;
    return attempt;
  };

  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const live = current();
    const hosts = req.headersDistinct.host ?? [];
    const token =
      live?.state === 'opened' && hosts.length === 1
        ? returnToken(
            { method: req.method ?? '', host: hosts[0] ?? '', url: req.url ?? '' },
            live.pending
          )
        : undefined;
    if (!live || token === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Not Found');
      return;
    }
    live.state = 'returned';
    live.appUrl = `mindroom://auth${live.callback}&loginToken=${encodeURIComponent(token)}`;
    res.writeHead(200, DONE_HEADERS);
    res.end(DONE_HTML);
    try {
      focus();
    } catch {
      // The window is gone: the page takes the return when it next loads.
    }
    notify();
  };

  /** Binds once, for the life of the app; a failed bind is tried again by the next start. */
  const listen = async (): Promise<number | undefined> => {
    server = http.createServer(onRequest).listen(0, '127.0.0.1');
    server.on('error', () => undefined); // A later accept error must not take the app down.
    try {
      await once(server, 'listening');
    } catch (error) {
      listening = undefined;
      throw error;
    }
    return (server.address() as AddressInfo | null)?.port;
  };

  return {
    /** Main itself saw a click or a key press in the main window. */
    noteGesture(): void {
      gestureAt = Date.now();
    },
    /** Replaces any earlier attempt. Needs, and uses up, a gesture of the last 10 seconds. */
    async start(request: SignInRequest): Promise<PendingSignIn | undefined> {
      if (closed || !parseSignInRequest(request)) throw new RangeError('Invalid sign-in request');
      if (Date.now() - gestureAt > GESTURE_MS) return undefined;
      gestureAt = -Infinity;
      attempt = undefined;
      listening ??= listen();
      const port = await listening;
      if (closed || port === undefined) throw new Error('Auth callback listener is closed');
      const random = crypto.randomBytes(16).toString('hex');
      const redirectUrl = `http://127.0.0.1:${port}/auth/${random}${request.callback}`;
      if (!new URL(redirectUrl).pathname.startsWith(`/auth/${random}/`))
        throw new RangeError('Invalid sign-in callback path');
      const pending = { homeserver: request.homeserver, redirectUrl };
      const expiresAt = Date.now() + LIFETIME_MS;
      attempt = { state: 'started', pending, callback: request.callback, expiresAt };
      return pending;
    },
    /** Whether `url` may open now: once per attempt, and only its own sign-in URL. */
    open(url: string): boolean {
      const live = current();
      if (live?.state !== 'started' || !isOpenable(url) || !isSignInUrl(url, live.pending))
        return false;
      live.state = 'opened';
      return true;
    },
    /** The return, once, to the page that asks while one waits. */
    take(): string | undefined {
      const live = current();
      if (live?.state !== 'returned') return undefined;
      attempt = undefined;
      return live.appUrl;
    },
    close(): void {
      closed = true;
      attempt = undefined;
      server?.closeAllConnections();
      server?.close();
    },
  };
};

export const registerSignInHandlers = (
  owners: () => readonly Electron.WebContents[],
  signIn: Pick<ReturnType<typeof createAuthCallback>, 'start' | 'open' | 'take'>,
  openUrl: (url: string) => Promise<void>
): void => {
  handle(
    'desktop:start-sign-in',
    owners,
    (args) => (args.length === 1 ? parseSignInRequest(args[0]) : undefined),
    async (request) => {
      const pending = await signIn.start(request);
      return pending
        ? { ok: true, value: pending.redirectUrl }
        : { ok: false, code: 'NO_USER_GESTURE' };
    }
  );
  handle(
    'desktop:open-sign-in',
    owners,
    (args) => (args.length === 1 && typeof args[0] === 'string' ? args[0] : undefined),
    async (url) =>
      signIn.open(url)
        ? { ok: true, value: await openUrl(url) }
        : { ok: false, code: 'BAD_ARGUMENTS' }
  );
  handle(
    'desktop:take-app-url',
    owners,
    (args) => (args.length === 0 ? true : undefined),
    async () => ({ ok: true, value: signIn.take() })
  );
};
