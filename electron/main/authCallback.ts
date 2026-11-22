import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isAllowedHomeserverBaseUrl } from '../../src/app/matrix/cs-api';

export type PendingSignIn = { homeserver: string; redirectUrl: string };
export type SignInRequest = { homeserver: string; callback: string };

const LIFETIME_MS = 30 * 60 * 1000;
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

const hasDuplicateKeys = (params: URLSearchParams): boolean => {
  const keys = Array.from(params.keys());
  return new Set(keys).size !== keys.length;
};

const sortedQuery = (params: URLSearchParams): string => {
  const copy = new URLSearchParams(params);
  copy.sort();
  return copy.toString();
};

const hasDotSegment = (pathname: string): boolean => {
  if (/%(?:2e|5c)/i.test(pathname)) return true;
  if (pathname.split('/').some((s) => s === '.' || s === '..')) return true;
  try {
    return decodeURIComponent(pathname)
      .split('/')
      .some((s) => s === '.' || s === '..');
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
  if (
    hasDuplicateKeys(parsed.searchParams) ||
    parsed.searchParams.has('loginToken') ||
    !parsed.searchParams.get('ssoNonce')
  )
    return undefined;
  return { homeserver, callback };
};

export const isSignInUrl = (url: string, pending: PendingSignIn): boolean => {
  const hs = toHomeserver(pending.homeserver);
  const target = !hs || !pending.redirectUrl || /[\r\n\0]/.test(url) ? undefined : toUrl(url);
  if (
    !hs ||
    !target ||
    url !== target.href ||
    target.hash ||
    target.origin !== hs.origin ||
    target.username ||
    target.password
  )
    return false;
  const basePath = hs.pathname.replace(/\/+$/, '');
  if (!target.pathname.startsWith(basePath)) return false;
  const suffix = target.pathname.slice(basePath.length);
  if (
    /%(?:2f|5c|2e)/i.test(suffix) ||
    suffix.includes('\\') ||
    suffix.split('/').some((s) => s === '.' || s === '..') ||
    !SSO_ROUTE.test(suffix)
  )
    return false;
  const redirects = target.searchParams.getAll('redirectUrl');
  return redirects.length === 1 && redirects[0] === pending.redirectUrl;
};

export const isReturn = (
  { method, host, url }: { method: string; host: string; url: string },
  pending: PendingSignIn
): boolean => {
  if (method !== 'GET' || !url.startsWith('/') || url.startsWith('//') || /[\\#]/.test(url))
    return false;
  const exp = toUrl(pending.redirectUrl);
  if (
    !exp ||
    exp.protocol !== 'http:' ||
    exp.hostname !== '127.0.0.1' ||
    !exp.port ||
    host !== exp.host ||
    (url.split('?', 1)[0] ?? '') !== exp.pathname
  )
    return false;
  const act = toUrl(url, exp.origin);
  if (!act || exp.searchParams.has('loginToken')) return false;
  if (hasDuplicateKeys(exp.searchParams) || hasDuplicateKeys(act.searchParams)) return false;
  const tokens = act.searchParams.getAll('loginToken');
  if (tokens.length !== 1 || !tokens[0]?.trim()) return false;
  act.searchParams.delete('loginToken');
  return sortedQuery(act.searchParams) === sortedQuery(exp.searchParams);
};

export const createAuthCallback = (deliver: (nativeUrl: string) => void, focus: () => void) => {
  let server: http.Server | undefined;
  let listening: Promise<number> | undefined;
  let current: { pending: PendingSignIn; callback: string; expiresAt: number } | undefined;
  let undelivered: string | undefined;
  let seq = 0;
  let closed = false;

  const active = () =>
    current && Date.now() >= current.expiresAt ? (current = undefined) : current;
  const ensureServer = (): Promise<number> => {
    if (listening) return listening;
    const srv = http.createServer((req, res) => {
      const entry = active();
      const rawUrl = req.url ?? '';
      const host = typeof req.headers.host === 'string' ? req.headers.host : '';
      if (!entry || !isReturn({ method: req.method ?? '', host, url: rawUrl }, entry.pending)) {
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('Not Found');
        return;
      }
      current = undefined;
      const token = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('loginToken') ?? '';
      const nativeUrl = `mindroom://auth${entry.callback}&loginToken=${encodeURIComponent(token)}`;
      undelivered = nativeUrl;
      res.writeHead(200, DONE_HEADERS);
      res.end(DONE_HTML);
      try {
        focus();
      } finally {
        deliver(nativeUrl);
      }
    });
    server = srv;
    listening = new Promise<number>((resolve, reject) => {
      srv.once('error', (err) => {
        if (server === srv) [server, listening] = [undefined, undefined];
        reject(err);
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as AddressInfo | null;
        if (!addr || typeof addr === 'string' || closed) {
          srv.close();
          reject(new Error('Auth callback listener unavailable'));
        } else resolve(addr.port);
      });
    });
    return listening;
  };

  return {
    async start(request: SignInRequest): Promise<PendingSignIn> {
      if (closed) throw new Error('Auth callback listener is closed');
      if (!parseSignInRequest(request)) throw new RangeError('Invalid sign-in callback request');
      const mySeq = ++seq;
      const port = await ensureServer();
      if (closed || mySeq !== seq) throw new Error('Sign-in start was superseded');
      const rand = crypto.randomBytes(16).toString('hex');
      const redirectUrl = `http://127.0.0.1:${port}/auth/${rand}${request.callback}`;
      if (!new URL(redirectUrl).pathname.startsWith(`/auth/${rand}/`)) {
        throw new RangeError('Invalid sign-in callback path');
      }
      const pending = { homeserver: request.homeserver, redirectUrl };
      current = { pending, callback: request.callback, expiresAt: Date.now() + LIFETIME_MS };
      return pending;
    },
    pending: (): PendingSignIn | undefined => active()?.pending,
    hasUndelivered: (): boolean => undelivered !== undefined,
    takeUndelivered(): string | undefined {
      const url = undelivered;
      undelivered = undefined;
      return url;
    },
    close(): void {
      closed = true;
      seq += 1;
      current = undefined;
      undelivered = undefined;
      const srv = server;
      [server, listening] = [undefined, undefined];
      if (srv) {
        srv.closeAllConnections();
        srv.close();
      }
    },
  };
};
