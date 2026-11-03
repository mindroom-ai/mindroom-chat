// Remembers where to go once a sign-in completes, for example the
// pairing page that sent the user to log in. A login abandoned halfway
// must not redirect a much later, unrelated login, so entries expire.

const STORAGE_KEY = 'after_login_redirect_url';

export const AFTER_LOGIN_REDIRECT_PATH_MAX_AGE_MS = 15 * 60 * 1000;

type StoredRedirect = {
  path: string;
  savedAt: number;
};

const getStorage = (): Storage | undefined => {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
};

const parseStoredRedirect = (raw: string | null): StoredRedirect | undefined => {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as StoredRedirect).path === 'string' &&
      typeof (value as StoredRedirect).savedAt === 'number'
    ) {
      return value as StoredRedirect;
    }
  } catch {
    // Values from earlier releases were plain paths without a timestamp.
  }
  return undefined;
};

export const setAfterLoginRedirectPath = (path: string): void => {
  const value: StoredRedirect = { path, savedAt: Date.now() };
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Without storage the login simply opens the default page.
  }
};

export const deleteAfterLoginRedirectPath = (): void => {
  try {
    getStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove when storage is unavailable.
  }
};

export const getAfterLoginRedirectPath = (): string | undefined => {
  let raw: string | null = null;
  try {
    raw = getStorage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return undefined;
  }
  const stored = parseStoredRedirect(raw);
  if (!stored) return undefined;

  const age = Date.now() - stored.savedAt;
  if (age < 0 || age > AFTER_LOGIN_REDIRECT_PATH_MAX_AGE_MS) {
    deleteAfterLoginRedirectPath();
    return undefined;
  }
  return stored.path;
};
