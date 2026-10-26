import { useEffect, useReducer } from 'react';
import { Capacitor } from '@capacitor/core';
import { authenticateInNativeBrowser, isNativeIOS } from './nativeSso';

/**
 * Homeservers behind Cloudflare Access reject requests without an Access session, and the
 * app's web view never holds the Access cookie. A server opts in by publishing a handoff
 * page at this public path; the app opens it in the system browser, receives the Access
 * token, and sends it as `cf-access-token` with every Matrix request to that server.
 */
const DISCOVERY_PATH = '/.well-known/mindroom/cloudflare-access';
const CALLBACK_SCHEME = 'mindroom';
const CALLBACK_HOST = 'cloudflare-access';
const STORAGE_KEY_PREFIX = 'mindroom_cloudflare_access:';
const DISCOVERY_TIMEOUT_MS = 5_000;
// setTimeout runs at once for longer delays, so a longer session waits in steps.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

type AccessRecord = { handoffUrl: string; token?: string };

const listeners = new Set<() => void>();

const originOf = (url: string | URL): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

const readRecord = (url: string | URL): AccessRecord | undefined => {
  const origin = originOf(url);
  try {
    const stored = origin ? localStorage.getItem(STORAGE_KEY_PREFIX + origin) : null;
    return stored ? (JSON.parse(stored) as AccessRecord) : undefined;
  } catch {
    return undefined;
  }
};

const writeRecord = (origin: string, record: AccessRecord | undefined): void => {
  try {
    if (record) localStorage.setItem(STORAGE_KEY_PREFIX + origin, JSON.stringify(record));
    else localStorage.removeItem(STORAGE_KEY_PREFIX + origin);
  } catch {
    // Without storage the user signs in again on the next request.
  }
  listeners.forEach((listener) => listener());
};

const tokenExpiresAt = (token: string): number | undefined => {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const { exp } = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: unknown;
    };
    return typeof exp === 'number' ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
};

// Safari keeps the same Access session until it expires, so the sign-in page hands back
// the same token until then: treat it as valid up to its expiry.
const isUsable = (token: string, now: number): boolean => {
  const expiresAt = tokenExpiresAt(token);
  return expiresAt !== undefined && expiresAt > now;
};

export const isCloudflareAccessSupported = (): boolean =>
  isNativeIOS() && Capacitor.isPluginAvailable('MindRoomAuth');

export const hasCloudflareAccess = (baseUrl: string): boolean => Boolean(readRecord(baseUrl));

/**
 * Looks for the server's handoff page and records it. A response without a valid
 * same-origin HTTPS handoff URL clears the record; an unreachable advert keeps it.
 */
export const discoverCloudflareAccess = async (
  baseUrl: string,
  request: typeof fetch = fetch
): Promise<boolean> => {
  const origin = originOf(baseUrl);
  if (!origin || !isCloudflareAccessSupported()) return false;

  let body: { handoff_url?: unknown } | undefined;
  try {
    const response = await request(`${origin}${DISCOVERY_PATH}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    body = response.ok ? await response.json().catch(() => undefined) : undefined;
  } catch {
    return hasCloudflareAccess(origin);
  }

  const handoffUrl = typeof body?.handoff_url === 'string' ? body.handoff_url : undefined;
  const current = readRecord(origin);
  if (!handoffUrl || originOf(handoffUrl) !== origin || !origin.startsWith('https:')) {
    if (current) writeRecord(origin, undefined);
    return false;
  }
  if (current?.handoffUrl !== handoffUrl) writeRecord(origin, { handoffUrl });
  return true;
};

export const getCloudflareAccessToken = (
  url: string | URL,
  now: number = Date.now()
): string | undefined => {
  const token = readRecord(url)?.token;
  return token && isUsable(token, now) ? token : undefined;
};

export const parseCloudflareAccessCallback = (
  url: string,
  now: number = Date.now()
): string | undefined => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${CALLBACK_SCHEME}:` || parsed.host !== CALLBACK_HOST) {
      return undefined;
    }
    const token = new URLSearchParams(parsed.hash.slice(1)).get('token');
    return token && isUsable(token, now) ? token : undefined;
  } catch {
    return undefined;
  }
};

export const signInToCloudflareAccess = async (baseUrl: string): Promise<void> => {
  const origin = originOf(baseUrl);
  const record = readRecord(baseUrl);
  if (!origin || !record) throw new Error('This server does not use Cloudflare Access.');

  const callbackUrl = await authenticateInNativeBrowser(record.handoffUrl, CALLBACK_SCHEME);
  const token = callbackUrl ? parseCloudflareAccessCallback(callbackUrl) : undefined;
  if (!token) throw new Error('Cloudflare Access sign-in returned no valid token.');
  writeRecord(origin, { ...record, token });
};

/** Drops the token on sign-out; other accounts on the server can still sign in again. */
export const forgetCloudflareAccessToken = (baseUrl: string): void => {
  const origin = originOf(baseUrl);
  const record = readRecord(baseUrl);
  if (origin && record?.token) writeRecord(origin, { handoffUrl: record.handoffUrl });
};

/** True while a server behind Access has no usable token; updates when the token expires. */
export const useCloudflareAccessSignInRequired = (baseUrl: string | undefined): boolean => {
  const [, update] = useReducer((count: number) => count + 1, 0);
  const token = baseUrl ? readRecord(baseUrl)?.token : undefined;

  useEffect(() => {
    listeners.add(update);
    // Timers stall while iOS suspends the app, so check again when it returns.
    document.addEventListener('visibilitychange', update);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waitForExpiry = () => {
      const delay = token ? (tokenExpiresAt(token) ?? 0) - Date.now() : 0;
      if (delay <= 0) return;
      timer = setTimeout(() => {
        update();
        waitForExpiry();
      }, Math.min(delay, MAX_TIMER_DELAY_MS));
    };
    waitForExpiry();
    return () => {
      listeners.delete(update);
      document.removeEventListener('visibilitychange', update);
      clearTimeout(timer);
    };
  }, [token]);

  return Boolean(baseUrl && hasCloudflareAccess(baseUrl) && !getCloudflareAccessToken(baseUrl));
};
