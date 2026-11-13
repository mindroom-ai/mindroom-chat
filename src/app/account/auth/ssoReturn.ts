import { isNativeApp } from '../../native/nativeSso';

// Single sign-on leaves the app and comes back with a `loginToken` in the address. The address
// alone proves nothing: anyone can link to `/login/<any server>/?loginToken=...`, and a homeserver
// sends its token to whatever `redirectUrl` the link that started the flow named. So before a
// sign-in button leaves for the homeserver, this tab notes the homeserver it goes to under a
// random nonce, and the nonce travels in the return address. The login page exchanges a token
// only for a noted sign-in, and only at the homeserver noted for it.

/** The search parameter of the return address that carries the nonce. */
export const SSO_NONCE_PARAM = 'ssoNonce';

const STORAGE_KEY = 'mindroom_sso_attempts';
/** How long a sign-in may take at the identity provider before its return is refused. */
export const SSO_ATTEMPT_LIFETIME_MS = 30 * 60 * 1000;
/** Sign-ins noted at once; starting one more forgets the oldest. */
const MAX_ATTEMPTS = 5;

/** A sign-in this tab started. */
type SsoAttempt = {
  /** The homeserver base URL the sign-in went to, where its token is exchanged. */
  baseUrl: string;
  startedAt: number;
  /** For browser sign-ins: the nonce the return address carries. */
  nonce?: string;
  /** For a token the app received itself (native Apple sign-in): that token. */
  loginToken?: string;
};

// The web keeps the note in this tab only. The native apps have a single web view, which the
// system may reload while the sign-in browser is in front, so they keep it in the app's storage.
const attemptStorage = (): Storage | undefined => {
  try {
    if (typeof window === 'undefined') return undefined;
    return isNativeApp() ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
};

const isAttempt = (value: unknown): value is SsoAttempt => {
  if (!value || typeof value !== 'object') return false;
  const { baseUrl, startedAt, nonce, loginToken } = value as Record<string, unknown>;
  return (
    typeof baseUrl === 'string' &&
    typeof startedAt === 'number' &&
    (typeof nonce === 'string' || typeof loginToken === 'string')
  );
};

const readAttempts = (storage: Storage, now: number): SsoAttempt[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is SsoAttempt =>
      isAttempt(item) && item.startedAt <= now && now - item.startedAt < SSO_ATTEMPT_LIFETIME_MS
  );
};

const writeAttempts = (storage: Storage, attempts: SsoAttempt[]) => {
  try {
    if (attempts.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(attempts.slice(-MAX_ATTEMPTS)));
  } catch {
    // Storage is full or blocked: the return is refused, and the user can sign in another way.
  }
};

const addAttempt = (attempt: SsoAttempt) => {
  const storage = attemptStorage();
  if (!storage) return;
  const kept = readAttempts(storage, attempt.startedAt).filter(
    (item) =>
      (attempt.nonce === undefined || item.nonce !== attempt.nonce) &&
      (attempt.loginToken === undefined || item.loginToken !== attempt.loginToken)
  );
  writeAttempts(storage, [...kept, attempt]);
};

/** A fresh random nonce for one sign-in page. */
export const createSsoNonce = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const setSearchParam = (pathWithSearch: string, name: string, value: string): string => {
  const queryAt = pathWithSearch.indexOf('?');
  const path = queryAt < 0 ? pathWithSearch : pathWithSearch.slice(0, queryAt);
  const params = new URLSearchParams(queryAt < 0 ? '' : pathWithSearch.slice(queryAt + 1));
  params.set(name, value);
  return `${path}?${params.toString()}`;
};

/**
 * `redirectUrl` with the nonce among the app route's search parameters, where the login page
 * reads them: in the hash with a hash router (`https://chat.example/#/login/...`), in the query
 * otherwise, including the native `mindroom://auth/login/...` address.
 */
export const withSsoNonce = (redirectUrl: string, nonce: string): string => {
  const hashAt = redirectUrl.indexOf('#');
  if (hashAt >= 0 && redirectUrl.startsWith('#/', hashAt)) {
    const route = redirectUrl.slice(hashAt + 1);
    return `${redirectUrl.slice(0, hashAt + 1)}${setSearchParam(route, SSO_NONCE_PARAM, nonce)}`;
  }
  const beforeHash = hashAt < 0 ? redirectUrl : redirectUrl.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : redirectUrl.slice(hashAt);
  return `${setSearchParam(beforeHash, SSO_NONCE_PARAM, nonce)}${hash}`;
};

/** Notes, just before the page leaves for `baseUrl`'s SSO, the sign-in that returns with `nonce`. */
export const rememberSsoAttempt = (nonce: string, baseUrl: string, now = Date.now()) =>
  addAttempt({ baseUrl, nonce, startedAt: now });

/**
 * Notes a login token the app received from `baseUrl` itself (native Sign in with Apple
 * exchanges Apple's credential for one), whose return address has no nonce.
 */
export const rememberIssuedLoginToken = (loginToken: string, baseUrl: string, now = Date.now()) =>
  addAttempt({ baseUrl, loginToken, startedAt: now });

/**
 * The homeserver base URL to exchange `loginToken` at, when a sign-in this tab started returned
 * it: one noted under `nonce`, or the token itself. Each sign-in is used once. Undefined means
 * nobody here asked for the token, so it must not be sent anywhere.
 */
export const claimSsoLogin = (
  loginToken: string,
  nonce: string | null | undefined,
  now = Date.now()
): string | undefined => {
  const storage = attemptStorage();
  if (!storage || !loginToken) return undefined;
  const attempts = readAttempts(storage, now);
  const match = attempts.find(
    (attempt) =>
      (!!nonce && attempt.nonce === nonce) ||
      (attempt.loginToken !== undefined && attempt.loginToken === loginToken)
  );
  writeAttempts(
    storage,
    attempts.filter((attempt) => attempt !== match)
  );
  return match?.baseUrl;
};
