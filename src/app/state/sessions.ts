export type StoredSession = {
  sessionId: string;
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  expiresInMs?: number;
  refreshToken?: string;
  lastUsedAt: number;
  lastKnownPath?: string;
  lastKnownDisplayName?: string;
  lastKnownAvatarUrl?: string;
  lastKnownAvatarDataUrl?: string;
};

export type SessionStore = {
  version: 1;
  activeSessionId?: string;
  sessions: StoredSession[];
};

export type SessionStoreName = {
  sync: string;
  crypto: string;
};

type PutSessionInput = {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  expiresInMs?: number;
  refreshToken?: string;
  lastKnownPath?: string;
  lastKnownDisplayName?: string;
  lastKnownAvatarUrl?: string;
  lastKnownAvatarDataUrl?: string;
};

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SessionStoreListener = () => void;

export const SESSION_STORE_KEY = 'mindroom_multi_account_store';
export const SESSION_STORE_EVENT = 'mindroom-session-store-changed';
export const SESSION_STORE_VERSION = 1 as const;

const SESSION_DB_PREFIX = '::';

const getLocalStorageSafe = (): LocalStorageLike | undefined => {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
};

const dispatchSessionStoreEvent = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SESSION_STORE_EVENT));
};

export const normalizeSessionBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

const normalizeUserId = (userId: string): string => userId.trim();

export const createSessionId = (baseUrl: string, userId: string): string =>
  `${encodeURIComponent(normalizeSessionBaseUrl(baseUrl))}${SESSION_DB_PREFIX}${encodeURIComponent(
    normalizeUserId(userId)
  )}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toStoredSession = (value: unknown): StoredSession | undefined => {
  if (!isRecord(value)) return undefined;

  const baseUrl = typeof value.baseUrl === 'string' ? normalizeSessionBaseUrl(value.baseUrl) : undefined;
  const userId = typeof value.userId === 'string' ? normalizeUserId(value.userId) : undefined;
  const deviceId = typeof value.deviceId === 'string' ? value.deviceId : undefined;
  const accessToken = typeof value.accessToken === 'string' ? value.accessToken : undefined;
  if (!baseUrl || !userId || !deviceId || !accessToken) return undefined;

  const sessionId =
    typeof value.sessionId === 'string' && value.sessionId.length > 0
      ? value.sessionId
      : createSessionId(baseUrl, userId);

  return {
    sessionId,
    baseUrl,
    userId,
    deviceId,
    accessToken,
    expiresInMs: typeof value.expiresInMs === 'number' ? value.expiresInMs : undefined,
    refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : undefined,
    lastUsedAt: typeof value.lastUsedAt === 'number' ? value.lastUsedAt : 0,
    lastKnownPath: typeof value.lastKnownPath === 'string' ? value.lastKnownPath : undefined,
    lastKnownDisplayName:
      typeof value.lastKnownDisplayName === 'string' ? value.lastKnownDisplayName : undefined,
    lastKnownAvatarUrl:
      typeof value.lastKnownAvatarUrl === 'string' ? value.lastKnownAvatarUrl : undefined,
    lastKnownAvatarDataUrl:
      typeof value.lastKnownAvatarDataUrl === 'string' ? value.lastKnownAvatarDataUrl : undefined,
  };
};

const sanitizeSessionStore = (value: unknown): SessionStore => {
  if (!isRecord(value) || value.version !== SESSION_STORE_VERSION || !Array.isArray(value.sessions)) {
    return {
      version: SESSION_STORE_VERSION,
      sessions: [],
    };
  }

  const sessionMap = new Map<string, StoredSession>();
  value.sessions.forEach((item) => {
    const session = toStoredSession(item);
    if (!session) return;
    sessionMap.set(session.sessionId, session);
  });

  const sessions = Array.from(sessionMap.values());
  const activeSessionId =
    typeof value.activeSessionId === 'string' &&
    sessions.some((session) => session.sessionId === value.activeSessionId)
      ? value.activeSessionId
      : undefined;

  return {
    version: SESSION_STORE_VERSION,
    activeSessionId,
    sessions,
  };
};

const writeSessionStore = (
  store: SessionStore,
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): void => {
  if (!storage) return;

  storage.setItem(SESSION_STORE_KEY, JSON.stringify(store));
  dispatchSessionStoreEvent();
};

export const getSessionStore = (
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): SessionStore => {
  if (!storage) {
    return {
      version: SESSION_STORE_VERSION,
      sessions: [],
    };
  }

  try {
    const raw = storage.getItem(SESSION_STORE_KEY);
    if (!raw) {
      return {
        version: SESSION_STORE_VERSION,
        sessions: [],
      };
    }

    return sanitizeSessionStore(JSON.parse(raw));
  } catch {
    return {
      version: SESSION_STORE_VERSION,
      sessions: [],
    };
  }
};

export const listSessions = (
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): StoredSession[] =>
  [...getSessionStore(storage).sessions].sort((a, b) => {
    const usedDiff = b.lastUsedAt - a.lastUsedAt;
    if (usedDiff !== 0) return usedDiff;
    return a.userId.localeCompare(b.userId);
  });

export const hasStoredSessions = (
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): boolean => getSessionStore(storage).sessions.length > 0;

export const getActiveSession = (
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  if (!store.activeSessionId) return undefined;
  return store.sessions.find((session) => session.sessionId === store.activeSessionId);
};

const upsertSession = (sessions: StoredSession[], nextSession: StoredSession): StoredSession[] => {
  const nextSessions = [...sessions];
  const existingIndex = nextSessions.findIndex((session) => session.sessionId === nextSession.sessionId);

  if (existingIndex >= 0) {
    nextSessions.splice(existingIndex, 1, nextSession);
    return nextSessions;
  }

  nextSessions.push(nextSession);
  return nextSessions;
};

const selectNextActiveSessionId = (sessions: StoredSession[]): string | undefined =>
  [...sessions]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .find(() => true)
    ?.sessionId;

export const putSession = (
  input: PutSessionInput,
  options: {
    setActive?: boolean;
  } = {},
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): StoredSession => {
  const baseUrl = normalizeSessionBaseUrl(input.baseUrl);
  const userId = normalizeUserId(input.userId);
  const sessionId = createSessionId(baseUrl, userId);

  const store = getSessionStore(storage);
  const existing = store.sessions.find((session) => session.sessionId === sessionId);
  const timestamp = Date.now();
  const nextSession: StoredSession = {
    sessionId,
    baseUrl,
    userId,
    deviceId: input.deviceId,
    accessToken: input.accessToken,
    expiresInMs: input.expiresInMs,
    refreshToken: input.refreshToken,
    lastUsedAt: timestamp,
    lastKnownPath: input.lastKnownPath ?? existing?.lastKnownPath,
    lastKnownDisplayName: input.lastKnownDisplayName ?? existing?.lastKnownDisplayName,
    lastKnownAvatarUrl: input.lastKnownAvatarUrl ?? existing?.lastKnownAvatarUrl,
    lastKnownAvatarDataUrl: input.lastKnownAvatarDataUrl ?? existing?.lastKnownAvatarDataUrl,
  };

  writeSessionStore(
    {
      version: SESSION_STORE_VERSION,
      sessions: upsertSession(store.sessions, nextSession),
      activeSessionId: options.setActive === false ? store.activeSessionId : sessionId,
    },
    storage
  );

  return nextSession;
};

export const setActiveSession = (
  sessionId: string,
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  const session = store.sessions.find((item) => item.sessionId === sessionId);
  if (!session) return undefined;

  const nextSession = {
    ...session,
    lastUsedAt: Date.now(),
  };

  writeSessionStore(
    {
      version: SESSION_STORE_VERSION,
      sessions: upsertSession(store.sessions, nextSession),
      activeSessionId: sessionId,
    },
    storage
  );

  return nextSession;
};

export const updateSessionProfile = (
  sessionId: string,
  profile: {
    lastKnownDisplayName?: string;
    lastKnownAvatarUrl?: string;
    lastKnownAvatarDataUrl?: string;
  },
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  const session = store.sessions.find((item) => item.sessionId === sessionId);
  if (!session) return undefined;

  const nextSession: StoredSession = {
    ...session,
    lastKnownDisplayName: profile.lastKnownDisplayName ?? session.lastKnownDisplayName,
    lastKnownAvatarUrl: profile.lastKnownAvatarUrl ?? session.lastKnownAvatarUrl,
    lastKnownAvatarDataUrl: profile.lastKnownAvatarDataUrl ?? session.lastKnownAvatarDataUrl,
  };
  if (
    nextSession.lastKnownDisplayName === session.lastKnownDisplayName &&
    nextSession.lastKnownAvatarUrl === session.lastKnownAvatarUrl &&
    nextSession.lastKnownAvatarDataUrl === session.lastKnownAvatarDataUrl
  ) {
    return session;
  }

  writeSessionStore(
    {
      ...store,
      sessions: upsertSession(store.sessions, nextSession),
    },
    storage
  );

  return nextSession;
};

export const updateSessionLastPath = (
  sessionId: string,
  lastKnownPath: string,
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): StoredSession | undefined => {
  const store = getSessionStore(storage);
  const session = store.sessions.find((item) => item.sessionId === sessionId);
  if (!session) return undefined;
  if (session.lastKnownPath === lastKnownPath) return session;

  const nextSession: StoredSession = {
    ...session,
    lastKnownPath,
  };

  writeSessionStore(
    {
      ...store,
      sessions: upsertSession(store.sessions, nextSession),
    },
    storage
  );

  return nextSession;
};

export const removeSession = (
  sessionId: string,
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): SessionStore => {
  const store = getSessionStore(storage);
  const sessions = store.sessions.filter((session) => session.sessionId !== sessionId);
  const activeSessionId =
    store.activeSessionId === sessionId ? selectNextActiveSessionId(sessions) : store.activeSessionId;
  const nextStore = {
    version: SESSION_STORE_VERSION,
    sessions,
    activeSessionId,
  };

  writeSessionStore(nextStore, storage);
  return nextStore;
};

export const removeActiveSession = (
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): SessionStore => {
  const activeSession = getActiveSession(storage);
  if (!activeSession) return getSessionStore(storage);
  return removeSession(activeSession.sessionId, storage);
};

export const clearSessionStore = (
  storage: LocalStorageLike | undefined = getLocalStorageSafe()
): void => {
  if (!storage) return;
  storage.removeItem(SESSION_STORE_KEY);
  dispatchSessionStoreEvent();
};

export const subscribeToSessionStore = (listener: SessionStoreListener): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;

  const handleWindowEvent = () => listener();
  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== SESSION_STORE_KEY) return;
    listener();
  };

  window.addEventListener(SESSION_STORE_EVENT, handleWindowEvent);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(SESSION_STORE_EVENT, handleWindowEvent);
    window.removeEventListener('storage', handleStorage);
  };
};

export const getSessionStoreName = (session: StoredSession): SessionStoreName => ({
  sync: `web-sync-store${SESSION_DB_PREFIX}${session.sessionId}`,
  crypto: `crypto-store${SESSION_DB_PREFIX}${session.sessionId}`,
});

export const getSessionScopedStorageKey = (sessionId: string, key: string): string =>
  `${key}${SESSION_DB_PREFIX}${sessionId}`;
