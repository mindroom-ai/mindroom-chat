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
} from '../../lib/sessionStoreConfig';
import { getSafeLocalStorage, getStorageItemSafe } from '../../lib/safeLocalStorage';
import { isRecord } from '../../lib/isRecord';

export const SESSION_STORE_KEY = MINDROOM_SESSION_STORE_KEY;
const SESSION_STORE_VERSION = 1;

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
  /**
   * The current device's ed25519 identity key, as its Rust crypto store held it when this browser
   * last opened the store. A store that opens with another key was made after the device's own was
   * lost. Reset with `cryptoStoreInitialized`.
   */
  deviceIdentityKey?: string;
};

export type SessionStore = {
  version: typeof SESSION_STORE_VERSION;
  sessions: StoredSession[];
  activeSessionId?: string;
};

type SessionInput = Pick<StoredSession, 'baseUrl' | 'userId' | 'deviceId' | 'accessToken'> &
  Partial<Omit<StoredSession, 'sessionId' | 'baseUrl' | 'userId' | 'deviceId' | 'accessToken'>>;

type PutSessionOptions = {
  /** Make the account active (the default). An inactive account keeps the current one active. */
  setActive?: boolean;
};

type SessionProfile = Partial<
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
  'deviceIdentityKey',
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

type ParsedSessionStore = {
  store: SessionStore;
  /** Stored entries this build cannot read; written back unchanged so no account is lost. */
  unrecognized: unknown[];
  /** False when the stored text is not a registry this build can rewrite without losing data. */
  writable: boolean;
};

const EMPTY_STORE: SessionStore = { version: SESSION_STORE_VERSION, sessions: [] };

const parseSessionStore = (raw: string | null): ParsedSessionStore => {
  if (raw === null) return { store: EMPTY_STORE, unrecognized: [], writable: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { store: EMPTY_STORE, unrecognized: [], writable: false };
  }
  if (
    !isRecord(parsed) ||
    (parsed.sessions !== undefined && !Array.isArray(parsed.sessions)) ||
    (typeof parsed.version === 'number' && parsed.version > SESSION_STORE_VERSION)
  ) {
    return { store: EMPTY_STORE, unrecognized: [], writable: false };
  }

  const seen = new Set<string>();
  const sessions: StoredSession[] = [];
  const unrecognized: unknown[] = [];
  (Array.isArray(parsed.sessions) ? parsed.sessions : []).forEach((entry: unknown) => {
    const session = parseStoredSession(entry);
    if (!session || seen.has(session.sessionId)) {
      unrecognized.push(entry);
      return;
    }
    seen.add(session.sessionId);
    sessions.push(session);
  });
  const activeSessionId =
    typeof parsed.activeSessionId === 'string' && seen.has(parsed.activeSessionId)
      ? parsed.activeSessionId
      : undefined;

  return {
    store: {
      version: SESSION_STORE_VERSION,
      sessions,
      ...(activeSessionId ? { activeSessionId } : {}),
    },
    unrecognized,
    writable: true,
  };
};

type StoreSnapshot = ParsedSessionStore & {
  raw: string | null;
  sorted: StoredSession[];
  active: StoredSession | undefined;
};

// Snapshots are cached per storage object and reused while the stored text is unchanged, so
// `useSyncExternalStore` sees stable references between writes.
const snapshots = new WeakMap<object, StoreSnapshot>();
const EMPTY_SNAPSHOT: StoreSnapshot = {
  raw: null,
  store: EMPTY_STORE,
  unrecognized: [],
  writable: true,
  sorted: [],
  active: undefined,
};

const resolveStorage = (storage: SessionStorage | undefined): SessionStorage | undefined =>
  storage ?? getSafeLocalStorage();

export const readSnapshot = (storage: SessionStorage | undefined): StoreSnapshot => {
  const target = resolveStorage(storage);
  if (!target) return EMPTY_SNAPSHOT;

  const raw = getStorageItemSafe(target, SESSION_STORE_KEY);
  const cached = snapshots.get(target);
  if (cached && cached.raw === raw) return cached;

  const parsed = parseSessionStore(raw);
  const { store } = parsed;
  const snapshot: StoreSnapshot = {
    ...parsed,
    raw,
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
  const { writable, unrecognized } = readSnapshot(target);
  if (!writable) {
    // eslint-disable-next-line no-console
    console.warn(
      '[sessions] The stored account list cannot be read; it is kept unchanged instead of being overwritten.'
    );
    throw new SessionStoreWriteError();
  }
  try {
    target.setItem(
      SESSION_STORE_KEY,
      JSON.stringify({ ...store, sessions: [...store.sessions, ...unrecognized] })
    );
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
 * Matrix device forgets the old device's crypto store marker and identity key.
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
  if (existing && existing.deviceId !== session.deviceId) {
    if (!('cryptoStoreInitialized' in input)) session.cryptoStoreInitialized = undefined;
    if (!('deviceIdentityKey' in input)) session.deviceIdentityKey = undefined;
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
  change: string,
  sessionId: string,
  update: (session: StoredSession) => StoredSession,
  storage?: SessionStorage
): StoredSession | undefined => {
  try {
    return updateSession(sessionId, update, storage);
  } catch (error) {
    if (!(error instanceof SessionStoreWriteError)) throw error;
    // Names only the change, never the values (they can be credentials).
    // eslint-disable-next-line no-console
    console.warn(
      `[sessions] Could not save the ${change} of an account; the stored record is unchanged.`
    );
    return undefined;
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
  updateSessionBestEffort('profile', sessionId, (session) => ({ ...session, ...profile }), storage);

/** Saves rotated tokens without touching the account's other fields or its position. */
export const updateSessionCredentials = (
  sessionId: string,
  credentials: SessionCredentials,
  storage?: SessionStorage
): StoredSession | undefined =>
  updateSessionBestEffort(
    'refreshed tokens',
    sessionId,
    (session) => ({ ...session, ...credentials }),
    storage
  );

export const updateSessionLastPath = (
  sessionId: string,
  lastKnownPath: string,
  storage?: SessionStorage
): StoredSession | undefined => {
  const existing = getSessionStore(storage).sessions.find(
    (session) => session.sessionId === sessionId
  );
  if (!existing || existing.lastKnownPath === lastKnownPath) return existing;
  return updateSessionBestEffort(
    'last route',
    sessionId,
    (session) => ({ ...session, lastKnownPath }),
    storage
  );
};

/**
 * Records that the Rust crypto store of the account's current device exists, and the device
 * identity key it holds.
 */
export const markCryptoStoreInitialized = (
  sessionId: string,
  deviceIdentityKey: string,
  storage?: SessionStorage
): void => {
  const session = getSessionStore(storage).sessions.find((item) => item.sessionId === sessionId);
  if (
    !session ||
    (session.cryptoStoreInitialized && session.deviceIdentityKey === deviceIdentityKey)
  ) {
    return;
  }
  updateSessionBestEffort(
    'crypto store marker',
    sessionId,
    (item) => ({ ...item, cryptoStoreInitialized: true, deviceIdentityKey }),
    storage
  );
};

/** The identity key recorded for the account's current device, if the browser recorded one. */
export const getRecordedDeviceIdentityKey = (
  sessionId: string,
  storage?: SessionStorage
): string | undefined =>
  getSessionStore(storage).sessions.find((item) => item.sessionId === sessionId)?.deviceIdentityKey;

/**
 * Whether this browser created the crypto store for the account's current device. A missing
 * store for such a device means lost keys, not a first login.
 */
export const hasInitializedCryptoStore = (sessionId: string, storage?: SessionStorage): boolean =>
  getSessionStore(storage).sessions.find((item) => item.sessionId === sessionId)
    ?.cryptoStoreInitialized === true;
