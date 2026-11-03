/**
 * The account registry: every Matrix login this browser keeps, and which one is active.
 *
 * Stored as one JSON document under `SESSION_STORE_KEY`:
 * `{ version: 1, sessions: StoredSession[], activeSessionId?: string }`.
 * A session ID names an account (homeserver base URL and user ID), so signing the same
 * account in again replaces its record instead of adding a second one; the Matrix device
 * of that login lives in `deviceId`.
 */
import {
  MINDROOM_SESSION_STORE_EVENT,
  MINDROOM_SESSION_STORE_KEY,
} from '../mindroom/cache/sessionStoreConfig';
import { getSafeLocalStorage, getStorageItemSafe } from '../utils/safeLocalStorage';
import { isRecord } from '../utils/isRecord';

export const SESSION_STORE_KEY = MINDROOM_SESSION_STORE_KEY;
const SESSION_STORE_VERSION = 1;

/** Single-account credentials written by builds before the account registry existed. */
export const LEGACY_SESSION_STORAGE_KEYS = [
  'mindroom_client_access_token',
  'mindroom_client_device_id',
  'mindroom_client_user_id',
  'mindroom_client_hs_base_url',
] as const;

export type StoredSession = {
  sessionId: string;
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken?: string;
  /** Lifetime of `accessToken` as the homeserver reported it at login or refresh. */
  expiresInMs?: number;
  /** When the account was last made active; the account list sorts by it, newest first. */
  lastUsedAt: number;
  /** The app route this account last showed, restored when it becomes active again. */
  lastKnownPath?: string;
  lastKnownDisplayName?: string;
  lastKnownAvatarUrl?: string;
  lastKnownAvatarDataUrl?: string;
  /**
   * Whether this browser created the Rust crypto store of the current device. Reset when a new
   * Matrix device replaces the login.
   */
  cryptoStoreInitialized?: boolean;
};

export type SessionStore = {
  version: typeof SESSION_STORE_VERSION;
  sessions: StoredSession[];
  activeSessionId?: string;
};

export type SessionInput = Pick<StoredSession, 'baseUrl' | 'userId' | 'deviceId' | 'accessToken'> &
  Partial<Omit<StoredSession, 'sessionId' | 'baseUrl' | 'userId' | 'deviceId' | 'accessToken'>>;

export type PutSessionOptions = {
  /** Make the account active (the default). An inactive account keeps the current one active. */
  setActive?: boolean;
};

export type SessionProfile = Partial<
  Pick<StoredSession, 'lastKnownDisplayName' | 'lastKnownAvatarUrl' | 'lastKnownAvatarDataUrl'>
>;

export type SessionCredentials = Pick<StoredSession, 'accessToken'> &
  Partial<Pick<StoredSession, 'refreshToken' | 'expiresInMs'>>;

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Thrown when the browser refuses to save the account registry (quota, blocked storage). */
export class SessionStoreWriteError extends Error {
  constructor(cause?: unknown) {
    super('The account list could not be saved in this browser.');
    this.name = 'SessionStoreWriteError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '');

/** The account ID for a homeserver and user; trailing slashes on the base URL do not matter. */
export const createSessionId = (baseUrl: string, userId: string): string =>
  `${encodeURIComponent(normalizeBaseUrl(baseUrl))}::${encodeURIComponent(userId)}`;

/** A localStorage key that belongs to one account. */
export const getSessionScopedStorageKey = (sessionId: string, key: string): string =>
  `${key}::${sessionId}`;

/** Names passed to the SDK's IndexedDB sync store and legacy crypto store. */
export const getSessionStoreName = (session: Pick<StoredSession, 'sessionId'>) => ({
  sync: `web-sync-store::${session.sessionId}`,
  crypto: `crypto-store::${session.sessionId}`,
});

/** The IndexedDB database names those stores create (the sync store adds its own prefix). */
export const getSessionIndexedDbStoreName = (session: Pick<StoredSession, 'sessionId'>) => {
  const names = getSessionStoreName(session);
  return {
    sync: `matrix-js-sdk:${names.sync}`,
    crypto: names.crypto,
  };
};

const RUST_CRYPTO_DB_SUFFIXES = ['matrix-sdk-crypto', 'matrix-sdk-crypto-meta'] as const;

const rustCryptoStoreNames = (prefix: string): [string, string] => [
  `${prefix}::${RUST_CRYPTO_DB_SUFFIXES[0]}`,
  `${prefix}::${RUST_CRYPTO_DB_SUFFIXES[1]}`,
];

/** The Rust crypto prefix builds used before stores were scoped to the Matrix device. */
export const getLegacySessionRustCryptoStorePrefix = (
  session: Pick<StoredSession, 'sessionId'>
): string => `matrix-js-sdk::${session.sessionId}`;

/**
 * The `cryptoDatabasePrefix` for `initRustCrypto`. It includes the device, so a new login of
 * the same account never opens the previous device's keys.
 */
export const getSessionRustCryptoStorePrefix = (
  session: Pick<StoredSession, 'sessionId' | 'deviceId'>
): string => {
  const legacyPrefix = getLegacySessionRustCryptoStorePrefix(session);
  if (!session.deviceId) return legacyPrefix;
  return `${legacyPrefix}::${encodeURIComponent(session.deviceId)}`;
};

/** The main store first, then the metadata store that exists only for a protected store. */
export const getSessionRustCryptoStoreNames = (
  session: Pick<StoredSession, 'sessionId' | 'deviceId'>
): [string, string] => rustCryptoStoreNames(getSessionRustCryptoStorePrefix(session));

export const getLegacySessionRustCryptoStoreNames = (
  session: Pick<StoredSession, 'sessionId'>
): [string, string] => rustCryptoStoreNames(getLegacySessionRustCryptoStorePrefix(session));

const OPTIONAL_STRING_FIELDS = [
  'refreshToken',
  'lastKnownPath',
  'lastKnownDisplayName',
  'lastKnownAvatarUrl',
  'lastKnownAvatarDataUrl',
] as const;

const parseStoredSession = (value: unknown): StoredSession | undefined => {
  if (!isRecord(value)) return undefined;
  const {
    sessionId,
    baseUrl,
    userId,
    deviceId,
    accessToken,
    lastUsedAt,
    expiresInMs,
    cryptoStoreInitialized,
  } = value;
  if (
    typeof sessionId !== 'string' ||
    typeof baseUrl !== 'string' ||
    typeof userId !== 'string' ||
    typeof deviceId !== 'string' ||
    typeof accessToken !== 'string'
  ) {
    return undefined;
  }

  // Optional fields are always present, possibly `undefined`, so a cleared field reads back
  // the same as one that was never set.
  const session: StoredSession = {
    sessionId,
    baseUrl,
    userId,
    deviceId,
    accessToken,
    lastUsedAt: typeof lastUsedAt === 'number' && Number.isFinite(lastUsedAt) ? lastUsedAt : 0,
    expiresInMs:
      typeof expiresInMs === 'number' && Number.isFinite(expiresInMs) ? expiresInMs : undefined,
    cryptoStoreInitialized: cryptoStoreInitialized === true ? true : undefined,
  };
  OPTIONAL_STRING_FIELDS.forEach((field) => {
    const fieldValue = value[field];
    session[field] = typeof fieldValue === 'string' ? fieldValue : undefined;
  });
  return session;
};

const parseSessionStore = (raw: string | null): SessionStore => {
  if (raw === null) return { version: SESSION_STORE_VERSION, sessions: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { version: SESSION_STORE_VERSION, sessions: [] };
  }
  if (!isRecord(parsed)) return { version: SESSION_STORE_VERSION, sessions: [] };

  const seen = new Set<string>();
  const sessions = (Array.isArray(parsed.sessions) ? parsed.sessions : [])
    .map(parseStoredSession)
    .filter((session): session is StoredSession => {
      if (!session || seen.has(session.sessionId)) return false;
      seen.add(session.sessionId);
      return true;
    });
  const activeSessionId =
    typeof parsed.activeSessionId === 'string' && seen.has(parsed.activeSessionId)
      ? parsed.activeSessionId
      : undefined;

  return {
    version: SESSION_STORE_VERSION,
    sessions,
    ...(activeSessionId ? { activeSessionId } : {}),
  };
};

type StoreSnapshot = {
  raw: string | null;
  store: SessionStore;
  sorted: StoredSession[];
  active: StoredSession | undefined;
};

// Snapshots are cached per storage object and reused while the stored text is unchanged, so
// `useSyncExternalStore` sees stable references between writes.
const snapshots = new WeakMap<object, StoreSnapshot>();
const EMPTY_SNAPSHOT: StoreSnapshot = {
  raw: null,
  store: { version: SESSION_STORE_VERSION, sessions: [] },
  sorted: [],
  active: undefined,
};

const resolveStorage = (storage: SessionStorage | undefined): SessionStorage | undefined =>
  storage ?? getSafeLocalStorage();

const readSnapshot = (storage: SessionStorage | undefined): StoreSnapshot => {
  const target = resolveStorage(storage);
  if (!target) return EMPTY_SNAPSHOT;

  const raw = getStorageItemSafe(target, SESSION_STORE_KEY);
  const cached = snapshots.get(target);
  if (cached && cached.raw === raw) return cached;

  const store = parseSessionStore(raw);
  const snapshot: StoreSnapshot = {
    raw,
    store,
    sorted: [...store.sessions].sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    active: store.sessions.find((session) => session.sessionId === store.activeSessionId),
  };
  snapshots.set(target, snapshot);
  return snapshot;
};

const listeners = new Set<() => void>();

const notifySessionStoreChanged = () => {
  listeners.forEach((listener) => listener());
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(MINDROOM_SESSION_STORE_EVENT));
    }
  } catch {
    // Change notification for other listeners is best effort.
  }
};

const writeSessionStore = (store: SessionStore, storage: SessionStorage | undefined): void => {
  const target = resolveStorage(storage);
  if (!target) throw new SessionStoreWriteError();
  try {
    target.setItem(SESSION_STORE_KEY, JSON.stringify(store));
  } catch (error) {
    throw new SessionStoreWriteError(error);
  }
  notifySessionStoreChanged();
};

/** Calls `listener` after every change to the registry, from this tab or another one. */
export const subscribeToSessionStore = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SESSION_STORE_KEY) listener();
  };
  const canListen = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (canListen) window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    if (canListen && typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', onStorage);
    }
  };
};

export const getSessionStore = (storage?: SessionStorage): SessionStore =>
  readSnapshot(storage).store;

/** Every stored account, most recently used first. */
export const listSessions = (storage?: SessionStorage): StoredSession[] =>
  readSnapshot(storage).sorted;

export const getActiveSession = (storage?: SessionStorage): StoredSession | undefined =>
  readSnapshot(storage).active;

export const hasStoredSessions = (storage?: SessionStorage): boolean =>
  readSnapshot(storage).store.sessions.length > 0;

// Strictly increasing, so the account made active last always sorts first.
const nextUsedAt = (store: SessionStore): number =>
  store.sessions.reduce((latest, session) => Math.max(latest, session.lastUsedAt + 1), Date.now());

/**
 * Saves a login. An account that is already stored keeps its cached profile and route; a new
 * Matrix device forgets the old device's crypto store marker.
 */
export const putSession = (
  input: SessionInput,
  { setActive = true }: PutSessionOptions = {},
  storage?: SessionStorage
): StoredSession => {
  const current = getSessionStore(storage);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const sessionId = createSessionId(baseUrl, input.userId);
  const existing = current.sessions.find((session) => session.sessionId === sessionId);
  const lastUsedAt = setActive ? nextUsedAt(current) : existing?.lastUsedAt ?? Date.now();

  const session: StoredSession = {
    ...existing,
    ...input,
    sessionId,
    baseUrl,
    lastUsedAt: input.lastUsedAt ?? lastUsedAt,
  };
  if (existing && existing.deviceId !== session.deviceId && !('cryptoStoreInitialized' in input)) {
    session.cryptoStoreInitialized = undefined;
  }

  const sessions = existing
    ? current.sessions.map((item) => (item.sessionId === sessionId ? session : item))
    : [...current.sessions, session];
  const activeSessionId = setActive ? sessionId : current.activeSessionId;
  writeSessionStore(
    { version: SESSION_STORE_VERSION, sessions, ...(activeSessionId ? { activeSessionId } : {}) },
    storage
  );
  return session;
};

const updateSession = (
  sessionId: string,
  update: (session: StoredSession) => StoredSession,
  storage?: SessionStorage
): StoredSession | undefined => {
  const current = getSessionStore(storage);
  const existing = current.sessions.find((session) => session.sessionId === sessionId);
  if (!existing) return undefined;

  const next = update(existing);
  writeSessionStore(
    {
      ...current,
      sessions: current.sessions.map((session) =>
        session.sessionId === sessionId ? next : session
      ),
    },
    storage
  );
  return next;
};

// Cached metadata and rotated tokens are saved when storage allows; a refused write leaves the
// stored record as it was instead of failing the caller (a token refresh still succeeds).
const updateSessionBestEffort = (
  sessionId: string,
  update: (session: StoredSession) => StoredSession,
  storage?: SessionStorage
): StoredSession | undefined => {
  try {
    return updateSession(sessionId, update, storage);
  } catch (error) {
    if (error instanceof SessionStoreWriteError) return undefined;
    throw error;
  }
};

/** Makes a stored account active; returns it, or `undefined` when it is not stored. */
export const setActiveSession = (
  sessionId: string,
  storage?: SessionStorage
): StoredSession | undefined => {
  const current = getSessionStore(storage);
  const existing = current.sessions.find((session) => session.sessionId === sessionId);
  if (!existing) return undefined;

  const next: StoredSession = { ...existing, lastUsedAt: nextUsedAt(current) };
  writeSessionStore(
    {
      version: SESSION_STORE_VERSION,
      sessions: current.sessions.map((session) =>
        session.sessionId === sessionId ? next : session
      ),
      activeSessionId: sessionId,
    },
    storage
  );
  return next;
};

/**
 * Forgets an account. Removing the active one makes the most recently used remaining account
 * active. Returns the registry after the change.
 */
export const removeSession = (sessionId: string, storage?: SessionStorage): SessionStore => {
  const current = getSessionStore(storage);
  if (!current.sessions.some((session) => session.sessionId === sessionId)) return current;

  const sessions = current.sessions.filter((session) => session.sessionId !== sessionId);
  let { activeSessionId } = current;
  if (activeSessionId === sessionId) {
    activeSessionId = [...sessions].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]?.sessionId;
  }
  const next: SessionStore = {
    version: SESSION_STORE_VERSION,
    sessions,
    ...(activeSessionId ? { activeSessionId } : {}),
  };
  writeSessionStore(next, storage);
  return next;
};

/** Updates the cached name and avatar shown for an account; `undefined` clears a field. */
export const updateSessionProfile = (
  sessionId: string,
  profile: SessionProfile,
  storage?: SessionStorage
): StoredSession | undefined =>
  updateSessionBestEffort(sessionId, (session) => ({ ...session, ...profile }), storage);

/** Saves rotated tokens without touching the account's other fields or its position. */
export const updateSessionCredentials = (
  sessionId: string,
  credentials: SessionCredentials,
  storage?: SessionStorage
): StoredSession | undefined =>
  updateSessionBestEffort(sessionId, (session) => ({ ...session, ...credentials }), storage);

export const updateSessionLastPath = (
  sessionId: string,
  lastKnownPath: string,
  storage?: SessionStorage
): StoredSession | undefined => {
  const existing = getSessionStore(storage).sessions.find(
    (session) => session.sessionId === sessionId
  );
  if (!existing || existing.lastKnownPath === lastKnownPath) return existing;
  return updateSessionBestEffort(sessionId, (session) => ({ ...session, lastKnownPath }), storage);
};

/** Records that the Rust crypto store of the account's current device exists. */
export const markCryptoStoreInitialized = (sessionId: string, storage?: SessionStorage): void => {
  const session = getSessionStore(storage).sessions.find((item) => item.sessionId === sessionId);
  if (!session || session.cryptoStoreInitialized) return;
  updateSessionBestEffort(
    sessionId,
    (item) => ({ ...item, cryptoStoreInitialized: true }),
    storage
  );
};

/**
 * Whether this browser created the crypto store for the account's current device. A missing
 * store for such a device means lost keys, not a first login.
 */
export const hasInitializedCryptoStore = (sessionId: string, storage?: SessionStorage): boolean =>
  getSessionStore(storage).sessions.find((item) => item.sessionId === sessionId)
    ?.cryptoStoreInitialized === true;

/** Removes the single-account keys; each key is removed on its own so one failure skips only it. */
export const clearLegacySessionStorage = (storage?: Pick<Storage, 'removeItem'>): void => {
  const target = storage ?? getSafeLocalStorage();
  if (!target) return;
  LEGACY_SESSION_STORAGE_KEYS.forEach((key) => {
    try {
      target.removeItem(key);
    } catch {
      // A blocked key stays behind; the others are still removed.
    }
  });
};
