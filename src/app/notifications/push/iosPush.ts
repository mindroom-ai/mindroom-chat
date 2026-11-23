import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { IPusherRequest, MatrixClient } from 'matrix-js-sdk';
import { ClientConfig } from '../../config/useClientConfig';
import {
  getActiveSession,
  getSessionScopedStorageKey,
  listSessions,
  type StoredSession,
} from '../../matrix/session/sessions';
import { hasCloudflareAccess } from '../../native/cloudflareAccess';
import {
  clearAllNativeNotificationAccounts,
  clearNativeNotificationAccount,
} from '../../native/nativeNotifications';

/**
 * The notification category of every push. The Apple Watch app shows its own long look for it
 * when watchOS forwards a push from the iPhone (approve, answer, listen, reply).
 */
export const IOS_PUSH_CATEGORY = 'MINDROOM_EVENT';

/** The push payload key of the account a push is for; see `findIOSPushAccount`. */
export const IOS_PUSH_ACCOUNT_KEY = 'mindroom_account';

type IOSPushDefaultPayload = {
  aps: {
    alert?: {
      title: string;
      body: string;
    };
    sound: 'default';
    category: typeof IOS_PUSH_CATEGORY;
  };
  [IOS_PUSH_ACCOUNT_KEY]: string;
};

type MatrixPusherRequest = Omit<IPusherRequest, 'data'> & {
  data: IPusherRequest['data'] & {
    default_payload: IOSPushDefaultPayload;
  };
};
type MatrixPusherClient = Pick<MatrixClient, 'setPusher' | 'getHomeserverUrl'>;

export type NativePushPermission = 'prompt' | 'granted' | 'denied';

export type IOSPushFormat = 'event_id_only' | 'full';

export type IOSPushConfig = {
  appId: string;
  gatewayUrl: string;
  appDisplayName: string;
  deviceDisplayName: string;
  profileTag?: string;
  append: boolean;
  format: IOSPushFormat;
  lang: string;
};

export const IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX = 'mindroom_ios_push_';
const PUSH_TOKEN_STORAGE_KEY = `${IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX}token`;
const PUSH_PROFILE_TAG_STORAGE_KEY = `${IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX}profile_tag`;
const PUSH_ENABLED_STORAGE_KEY = `${IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX}enabled`;
const PENDING_NATIVE_CLEARS_STORAGE_KEY = `${IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX}pending_native_clears`;
const PENDING_NATIVE_CLEAR_ALL_STORAGE_KEY = `${IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX}pending_native_clear_all`;
const LEGACY_SETTINGS_STORAGE_KEY = 'settings';
export const IOS_PUSH_STATE_EVENT = 'mindroom-ios-push-state-changed';

const trimConfigValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveScopedStorageKey = (key: string, sessionId?: string): string => {
  const resolvedSessionId = sessionId ?? getActiveSession()?.sessionId;
  if (!resolvedSessionId) return key;
  return getSessionScopedStorageKey(resolvedSessionId, key);
};

const dispatchIOSPushStateEvent = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(IOS_PUSH_STATE_EVENT));
};

const isHttpsUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const readStorage = (key: string): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

const writeStorage = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
    dispatchIOSPushStateEvent();
  } catch {
    // ignore localStorage write failures in private mode/blocked storage
  }
};

const removeStorage = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
    dispatchIOSPushStateEvent();
  } catch {
    // Best effort, matching the rest of local preference cleanup.
  }
};

const isIOSPushStorageKey = (key: string | null): boolean =>
  key === null ||
  key.startsWith(PUSH_TOKEN_STORAGE_KEY) ||
  key.startsWith(PUSH_PROFILE_TAG_STORAGE_KEY) ||
  key.startsWith(PUSH_ENABLED_STORAGE_KEY);

const defaultLanguage = (): string => {
  if (typeof navigator === 'undefined') return 'en';
  const language = navigator.language?.trim();
  if (!language) return 'en';
  return language;
};

const generateProfileTag = (): string => Math.random().toString(36).slice(2, 10);

const getLegacyIOSPushEnabled = (): boolean | undefined => {
  const rawSettings = readStorage(LEGACY_SETTINGS_STORAGE_KEY);
  if (!rawSettings) return undefined;

  try {
    const parsed = JSON.parse(rawSettings) as { nativePushNotifications?: unknown };
    if (typeof parsed.nativePushNotifications === 'boolean') {
      return parsed.nativePushNotifications;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const getStoredIOSPushEnabled = (key: string): boolean | undefined => {
  const stored = trimConfigValue(readStorage(key));
  if (stored === '0' || stored === 'false') return false;
  if (stored) return true;
  return undefined;
};

/** Preserve the old device-wide preference before generic settings rewrites its legacy blob. */
export const migrateLegacyIOSPushEnabled = (): void => {
  if (getStoredIOSPushEnabled(PUSH_ENABLED_STORAGE_KEY) !== undefined) return;
  const legacyValue = getLegacyIOSPushEnabled();
  if (legacyValue !== undefined) writeStorage(PUSH_ENABLED_STORAGE_KEY, legacyValue ? '1' : '0');
};

export const isNativeIOSPlatform = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export const subscribeToIOSPushState = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;

  const handleWindowEvent = () => listener();
  const handleStorage = (event: StorageEvent) => {
    if (!isIOSPushStorageKey(event.key)) return;
    listener();
  };

  window.addEventListener(IOS_PUSH_STATE_EVENT, handleWindowEvent);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(IOS_PUSH_STATE_EVENT, handleWindowEvent);
    window.removeEventListener('storage', handleStorage);
  };
};

/** Reads the account's stored push tag without generating one if absent. */
export const getStoredIOSPushProfileTag = (sessionId?: string): string | undefined => {
  const storageKey = resolveScopedStorageKey(PUSH_PROFILE_TAG_STORAGE_KEY, sessionId);
  return trimConfigValue(readStorage(storageKey));
};

/**
 * The account's random push tag on this device. It is the pusher's `profile_tag` unless the
 * deployment configures one, and every push of the account carries it under
 * `IOS_PUSH_ACCOUNT_KEY`.
 */
export const getOrCreateIOSPushProfileTag = (sessionId?: string): string => {
  const stored = getStoredIOSPushProfileTag(sessionId);
  if (stored) return stored;

  const storageKey = resolveScopedStorageKey(PUSH_PROFILE_TAG_STORAGE_KEY, sessionId);
  const generated = generateProfileTag();
  writeStorage(storageKey, generated);
  return generated;
};

/** The stored account whose pushes carry `accountTag`, as `getOrCreateIOSPushProfileTag` made it. */
export const findIOSPushAccount = (accountTag: string): StoredSession | undefined =>
  listSessions().find(
    (session) =>
      trimConfigValue(
        readStorage(getSessionScopedStorageKey(session.sessionId, PUSH_PROFILE_TAG_STORAGE_KEY))
      ) === accountTag
  );

/**
 * The format the account's pushes really have. A private server behind Cloudflare Access gets
 * `event_id_only` whatever the deployment configures, so that no message leaves it through the
 * public gateway.
 */
export const resolveEffectiveIOSPushFormat = (
  pushConfig: Pick<IOSPushConfig, 'format'>,
  homeserverUrl?: string
): IOSPushFormat =>
  homeserverUrl && hasCloudflareAccess(homeserverUrl) ? 'event_id_only' : pushConfig.format;

export const resolveIOSPushConfig = (
  clientConfig: ClientConfig,
  sessionId?: string,
  appLanguage?: string
): IOSPushConfig | undefined => {
  const iosPushConfig = clientConfig.push?.ios;

  if (iosPushConfig?.enabled !== true) return undefined;

  const appId = trimConfigValue(iosPushConfig.appId);
  const gatewayUrl = trimConfigValue(iosPushConfig.gatewayUrl);

  if (!appId || !gatewayUrl || !isHttpsUrl(gatewayUrl)) return undefined;

  return {
    appId,
    gatewayUrl,
    appDisplayName: trimConfigValue(iosPushConfig.appDisplayName) ?? 'MindRoom iOS',
    deviceDisplayName: trimConfigValue(iosPushConfig.deviceDisplayName) ?? 'MindRoom iOS',
    profileTag:
      trimConfigValue(iosPushConfig.profileTag) ?? getOrCreateIOSPushProfileTag(sessionId),
    append: iosPushConfig.append !== false,
    format: iosPushConfig.format === 'full' ? 'full' : 'event_id_only',
    lang: trimConfigValue(iosPushConfig.lang) ?? trimConfigValue(appLanguage) ?? defaultLanguage(),
  };
};

export const buildIOSPushPusherRequest = (
  token: string,
  pushConfig: IOSPushConfig,
  accountTag: string
): MatrixPusherRequest => {
  const defaultPayload: IOSPushDefaultPayload = {
    // Sygnal merges the push's room and event IDs into this payload, so a tap knows the account.
    [IOS_PUSH_ACCOUNT_KEY]: accountTag,
    aps: {
      sound: 'default',
      category: IOS_PUSH_CATEGORY,
      // Sygnal adds loc-key/loc-args for full pushes; a default body would mask that preview.
      ...(pushConfig.format === 'event_id_only'
        ? {
            alert: {
              title: pushConfig.appDisplayName,
              body: 'New message',
            },
          }
        : {}),
    },
  };

  const request: MatrixPusherRequest = {
    kind: 'http',
    app_id: pushConfig.appId,
    pushkey: token,
    app_display_name: pushConfig.appDisplayName,
    device_display_name: pushConfig.deviceDisplayName,
    profile_tag: pushConfig.profileTag,
    lang: pushConfig.lang,
    append: pushConfig.append,
    data: {
      url: pushConfig.gatewayUrl,
      format: pushConfig.format,
      default_payload: defaultPayload,
    },
  };

  return request;
};

const disablePusherByToken = async (mx: MatrixPusherClient, appId: string, token: string) => {
  await mx.setPusher({
    pushkey: token,
    app_id: appId,
    kind: null,
  } as unknown as IPusherRequest);
};

const parseNativePushPermission = (receive: string | undefined): NativePushPermission => {
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'prompt';
};

export const checkIOSPushPermission = async (): Promise<NativePushPermission> => {
  const permissions = await PushNotifications.checkPermissions();
  return parseNativePushPermission(permissions.receive);
};

export const requestIOSPushPermission = async (): Promise<NativePushPermission> => {
  const permissions = await PushNotifications.requestPermissions();
  return parseNativePushPermission(permissions.receive);
};

export const registerIOSPush = async (): Promise<void> => {
  await PushNotifications.register();
};

export const getIOSPushEnabled = (sessionId?: string): boolean => {
  const storageKey = resolveScopedStorageKey(PUSH_ENABLED_STORAGE_KEY, sessionId);
  const scopedValue = getStoredIOSPushEnabled(storageKey);
  if (scopedValue !== undefined) return scopedValue;
  const globalValue = getStoredIOSPushEnabled(PUSH_ENABLED_STORAGE_KEY);
  if (globalValue !== undefined) return globalValue;
  const legacyValue = getLegacyIOSPushEnabled();
  if (legacyValue !== undefined) return legacyValue;
  return true;
};

export const setIOSPushEnabled = (enabled: boolean, sessionId?: string) => {
  const storageKey = resolveScopedStorageKey(PUSH_ENABLED_STORAGE_KEY, sessionId);
  writeStorage(storageKey, enabled ? '1' : '0');
};

export const getStoredIOSPushToken = (sessionId?: string): string | undefined => {
  const storageKey = resolveScopedStorageKey(PUSH_TOKEN_STORAGE_KEY, sessionId);
  const token = trimConfigValue(readStorage(storageKey));
  return token;
};

export const clearStoredIOSPushToken = (sessionId?: string) => {
  const storageKey = resolveScopedStorageKey(PUSH_TOKEN_STORAGE_KEY, sessionId);
  removeStorage(storageKey);
};

const setStoredIOSPushToken = (token: string, sessionId?: string) => {
  const storageKey = resolveScopedStorageKey(PUSH_TOKEN_STORAGE_KEY, sessionId);
  writeStorage(storageKey, token);
};

/** The account tags whose share with the notification extension is still to be removed. */
const readPendingNativeClears = (): string[] => {
  const stored = readStorage(PENDING_NATIVE_CLEARS_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
  } catch {
    return [];
  }
};

const writePendingNativeClears = (accountTags: string[]): void => {
  if (typeof window === 'undefined') return;
  try {
    if (accountTags.length === 0) {
      window.localStorage.removeItem(PENDING_NATIVE_CLEARS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PENDING_NATIVE_CLEARS_STORAGE_KEY, JSON.stringify(accountTags));
    }
  } catch {
    // A clear that cannot be noted down is still attempted once.
  }
};

const notePendingNativeClear = (accountTag: string): void => {
  const pending = readPendingNativeClears();
  if (!pending.includes(accountTag)) writePendingNativeClears([...pending, accountTag]);
};

/** Takes back a noted clear: the account shares with the notification extension again. */
export const forgetPendingNativeNotificationClear = (accountTag: string): void => {
  const pending = readPendingNativeClears();
  if (!pending.includes(accountTag)) return;
  writePendingNativeClears(pending.filter((tag) => tag !== accountTag));
};

/**
 * Notes down, at once, that what the account shares with the notification extension is to be
 * removed. A sign-out calls it as soon as the account has left the registry: whatever cuts the
 * rest of the sign-out off, the removal is still owed and `flushPendingNativeNotificationClears`
 * makes it. Never throws.
 */
export const queueIOSPushNativeClear = (sessionId?: string): void => {
  try {
    const accountTag = getStoredIOSPushProfileTag(sessionId);
    if (accountTag) notePendingNativeClear(accountTag);
  } catch {
    // The sign-out goes on, and clears the account itself.
  }
};

/**
 * Removes what the account shares with the notification extension (its Keychain record, its
 * avatars, its donated interactions). The tag is noted down before the app is asked and struck
 * off only once the app confirms: a clear that the Keychain or Siri refuses, or whose answer a
 * reload cuts off, is tried again by `flushPendingNativeNotificationClears`. Never rejects.
 */
export const clearNativeNotificationAccountWithRetry = async (
  accountTag: string
): Promise<void> => {
  notePendingNativeClear(accountTag);
  try {
    await clearNativeNotificationAccount(accountTag);
    forgetPendingNativeNotificationClear(accountTag);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[ios-push] could not clear a notification account; it stays noted', error);
  }
};

const isNativeClearAllNoted = (): boolean =>
  readStorage(PENDING_NATIVE_CLEAR_ALL_STORAGE_KEY) !== undefined;

const writePendingNativeClearAll = (pending: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (pending) {
      window.localStorage.setItem(PENDING_NATIVE_CLEAR_ALL_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(PENDING_NATIVE_CLEAR_ALL_STORAGE_KEY);
    }
  } catch {
    // A clear that cannot be noted down is still attempted once.
  }
};

/** The clears of every account that the app has been asked for and has not answered yet. */
let nativeClearAllsUnderWay = 0;

/**
 * Whether a removal of every account is still owed or under way. An account that is shared
 * before it is done would be removed by it.
 */
export const hasPendingNativeNotificationClearAll = (): boolean =>
  nativeClearAllsUnderWay > 0 || isNativeClearAllNoted();

/**
 * Removes what every account on the device shares with the notification extension. It is noted
 * down before the app is asked and struck off only once the app confirms, as for one account;
 * with it go the noted clears of single accounts that it covers, the ones noted before it.
 * Whether the app confirmed. Never rejects.
 */
export const clearAllNativeNotificationAccountsWithRetry = async (): Promise<boolean> => {
  writePendingNativeClearAll(true);
  const covered = readPendingNativeClears();
  nativeClearAllsUnderWay += 1;
  try {
    await clearAllNativeNotificationAccounts();
  } catch (error) {
    // Noted again: an earlier clear of all that succeeded meanwhile has struck it off.
    writePendingNativeClearAll(true);
    // eslint-disable-next-line no-console
    console.warn('[ios-push] could not clear the notification accounts; it stays noted', error);
    return false;
  } finally {
    nativeClearAllsUnderWay -= 1;
  }
  writePendingNativeClearAll(false);
  writePendingNativeClears(readPendingNativeClears().filter((tag) => !covered.includes(tag)));
  return true;
};

/**
 * Tries the clears again that are still noted down: first the one of every account, without
 * which nothing else is tried, then the ones of single accounts. Whether none is left.
 */
export const flushPendingNativeNotificationClears = async (): Promise<boolean> => {
  if (isNativeClearAllNoted() && !(await clearAllNativeNotificationAccountsWithRetry())) {
    return false;
  }
  await Promise.all(readPendingNativeClears().map(clearNativeNotificationAccountWithRetry));
  return !isNativeClearAllNoted() && readPendingNativeClears().length === 0;
};

/**
 * Removes the account's push state. Resolves once the app has answered the removal of what the
 * account shares with the notification extension, so that a sign-out does not reload under it.
 */
export const clearIOSPushState = async (sessionId?: string): Promise<void> => {
  const profileTag = getStoredIOSPushProfileTag(sessionId);
  const storageKeys = [
    resolveScopedStorageKey(PUSH_TOKEN_STORAGE_KEY, sessionId),
    resolveScopedStorageKey(PUSH_PROFILE_TAG_STORAGE_KEY, sessionId),
    resolveScopedStorageKey(PUSH_ENABLED_STORAGE_KEY, sessionId),
  ];
  // Started before the stored tag goes: the tag is the only name the app knows the account by,
  // and this notes it down for another try.
  const nativeClear = profileTag ? clearNativeNotificationAccountWithRetry(profileTag) : undefined;
  storageKeys.forEach(removeStorage);
  await nativeClear;
};

/** Each account's last pusher write, so its writes reach the homeserver in the order they start. */
const pusherWrites = new Map<string, Promise<void>>();

/**
 * Runs an account's pusher write after the ones before it: turned off while its registration is
 * still sending, an account removes the pusher that registration sets, and turned on again, it
 * keeps the new one, since each write reads the stored token only when its turn comes.
 */
const inOrder = (sessionId: string | undefined, write: () => Promise<void>): Promise<void> => {
  const key = sessionId ?? getActiveSession()?.sessionId ?? '';
  const next = (pusherWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(write);
  pusherWrites.set(key, next);
  return next;
};

export const upsertIOSPushPusher = (
  mx: MatrixPusherClient,
  pushConfig: IOSPushConfig,
  token: string,
  sessionId?: string
) => inOrder(sessionId, () => setIOSPushPusher(mx, pushConfig, token, sessionId));

const setIOSPushPusher = async (
  mx: MatrixPusherClient,
  pushConfig: IOSPushConfig,
  token: string,
  sessionId?: string
) => {
  const normalizedToken = token.trim();
  if (normalizedToken.length === 0) {
    throw new Error('APNs registration returned an empty push token.');
  }

  const previousToken = getStoredIOSPushToken(sessionId);
  if (previousToken && previousToken !== normalizedToken) {
    await disablePusherByToken(mx, pushConfig.appId, previousToken);
  }

  // A private server's pushes carry only event and room IDs (and the account's random tag) past
  // the public gateway.
  const format = resolveEffectiveIOSPushFormat(pushConfig, mx.getHomeserverUrl());
  await mx.setPusher(
    buildIOSPushPusherRequest(
      normalizedToken,
      { ...pushConfig, format },
      getOrCreateIOSPushProfileTag(sessionId)
    )
  );
  setStoredIOSPushToken(normalizedToken, sessionId);
};

export const disableIOSPushPusher = (
  mx: MatrixPusherClient,
  pushConfig: IOSPushConfig,
  sessionId?: string
) =>
  inOrder(sessionId, async () => {
    const storedToken = getStoredIOSPushToken(sessionId);
    if (!storedToken) return;

    await disablePusherByToken(mx, pushConfig.appId, storedToken);
    clearStoredIOSPushToken(sessionId);
  });
