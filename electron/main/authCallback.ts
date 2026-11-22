import crypto from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import type { DesktopSignInRequest } from '../../src/app/lib/desktopBridge';
import { isAllowedHomeserverBaseUrl } from '../../src/app/matrix/cs-api';
import { handle } from './ipc';
import { isOpenable } from './security';

export type PendingSignIn = { homeserver: string; redirectUrl: string };

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
// An encoded dot or backslash, or a `.`/`..` segment between slashes, plain or encoded (`%2f`).
const UNSAFE_CALLBACK_PATH = /%(?:2e|5c)|(?:^|\/|%2f)\.\.?(?:\/|%2f|$)/i;
const DONE_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>MindRoom</title></head><body><p>Sign-in complete. You can close this tab and return to MindRoom.</p></body></html>';
const DONE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
};

const toHomeserver = (raw: string): URL | undefined => {
  const u = isAllowedHomeserverBaseUrl(raw) ? URL.parse(raw) : null;
  return u && !u.username && !u.password && !u.search && !u.hash ? u : undefined;
};

/** The one validation of a sign-in request, at the IPC door. */
export const parseSignInRequest = (raw: unknown): DesktopSignInRequest | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { homeserver, callback } = raw as Record<string, unknown>;
  if (typeof homeserver !== 'string' || typeof callback !== 'string' || !toHomeserver(homeserver))
    return undefined;
  // A path and query that parsing leaves exactly as written: no other host, no fragment,
  // backslash, white space or control character.
  const parsed = URL.parse(callback, 'http://127.0.0.1');
  if (!parsed || parsed.pathname + parsed.search !== callback) return undefined;
  const keys = Array.from(parsed.searchParams.keys());
  const valid =
    !UNSAFE_CALLBACK_PATH.test(parsed.pathname) &&
    new Set(keys).size === keys.length &&
    !keys.includes('loginToken') &&
    !!parsed.searchParams.get('ssoNonce');
  return valid ? { homeserver, callback } : undefined;
};

/** `url`, already in canonical form, is the pending homeserver's SSO route with its `redirectUrl`. */
export const isSignInUrl = (url: string, pending: PendingSignIn): boolean => {
  const hs = toHomeserver(pending.homeserver);
  const target = URL.parse(url);
  if (!hs || !target || url !== target.href || target.origin !== hs.origin) return false;
  if (target.username || target.password || target.hash) return false;
  const base = hs.pathname.replace(/\/+$/, '');
  const route = target.pathname.startsWith(base) ? target.pathname.slice(base.length) : '';
  if (!SSO_ROUTE.test(route) || /%(?:2f|5c|2e)/i.test(route)) return false;
  const redirects = target.searchParams.getAll('redirectUrl');
  return redirects.length === 1 && redirects[0] === pending.redirectUrl;
};

/** The `loginToken` of a request that is the pending sign-in's return, else `undefined`. */
export const returnToken = (
  request: Pick<http.IncomingMessage, 'method' | 'url' | 'headersDistinct'>,
  pending: PendingSignIn
): string | undefined => {
  const { method, url = '', headersDistinct } = request;
  const expected = new URL(pending.redirectUrl);
  const hosts = headersDistinct.host ?? [];
  const queryAt = url.indexOf('?');
  if (method !== 'GET' || hosts.length !== 1 || hosts[0] !== expected.host) return undefined;
  // eslint-disable-next-line no-control-regex
  if (queryAt < 0 || /[#\0-\x1f\x7f]/.test(url)) return undefined;
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
    const token = live?.state === 'opened' ? returnToken(req, live.pending) : undefined;
    if (!live || token === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Not Found');
      return;
    }
    live.state = 'returned';
    live.appUrl = `mindroom://auth${live.callback}&loginToken=${encodeURIComponent(token)}`;
    res.writeHead(200, DONE_HEADERS);
    res.end(DONE_HTML);
    [focus, notify].forEach((step) => {
      try {
        step();
      } catch {
        // The window is gone: the page takes the return when it next loads.
      }
    });
  };

  /** Binds once, for the life of the app; a failed bind is tried again by the next start. */
  const listen = async (): Promise<number | undefined> => {
    server = http.createServer(onRequest);
    // No header may go unseen, so that `headersDistinct.host` shows every `Host`. Node's limit
    // on the headers' bytes still holds.
    server.maxHeadersCount = 0;
    server.on('error', () => undefined); // A later accept error must not take the app down.
    server.listen(0, '127.0.0.1');
    await once(server, 'listening').catch((error) => {
      listening = undefined;
      throw error;
    });
    return (server.address() as AddressInfo | null)?.port;
  };

  return {
    /** Main itself saw a click or a key press in the main window. */
    noteGesture(): void {
      gestureAt = Date.now();
    },
    /** Replaces any earlier attempt and answers its `redirectUrl`. Needs, and uses up, a gesture. */
    async start(request: DesktopSignInRequest): Promise<string | undefined> {
      if (closed) throw new Error('Auth callback listener is closed');
      if (Date.now() - gestureAt > GESTURE_MS) return undefined;
      gestureAt = -Infinity;
      attempt = undefined;
      listening ??= listen();
      const port = await listening;
      if (port === undefined) throw new Error('Auth callback listener is closed');
      const random = crypto.randomBytes(16).toString('hex');
      const redirectUrl = `http://127.0.0.1:${port}/auth/${random}${request.callback}`;
      const pending = { homeserver: request.homeserver, redirectUrl };
      const expiresAt = Date.now() + LIFETIME_MS;
      attempt = { state: 'started', pending, callback: request.callback, expiresAt };
      return redirectUrl;
    },
    /** Opens `url`, once per attempt and only its own sign-in URL. A failed open ends the attempt. */
    async open(url: string, openUrl: (url: string) => Promise<void>): Promise<boolean> {
      const live = current();
      if (live?.state !== 'started' || !isOpenable(url) || !isSignInUrl(url, live.pending))
        return false;
      live.state = 'opened';
      await openUrl(url).catch((error) => {
        if (attempt === live) attempt = undefined;
        throw error;
      });
      return true;
    },
    /** The return, once, to the page that asks while one waits. */
    take(): string | undefined {
      const live = current();
      if (live?.state !== 'returned') return undefined;
      attempt = undefined;
      return live.appUrl;
    },
    // At Quit only. The random path does not prove to a browser who listens: once the port is
    // free another process can take it, and a tab that returns after Quit reaches that process.
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
      const value = await signIn.start(request);
      return value ? { ok: true, value } : { ok: false, code: 'NO_USER_GESTURE' };
    }
  );
  handle(
    'desktop:open-sign-in',
    owners,
    (args) => (args.length === 1 && typeof args[0] === 'string' ? args[0] : undefined),
    async (url) =>
      (await signIn.open(url, openUrl))
        ? { ok: true, value: undefined }
        : { ok: false, code: 'BAD_ARGUMENTS' }
  );
  handle(
    'desktop:take-app-url',
    owners,
    (args) => (args.length === 0 ? true : undefined),
    async () => ({ ok: true, value: signIn.take() })
  );
};
