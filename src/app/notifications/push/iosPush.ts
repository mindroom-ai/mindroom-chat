import { Capacitor, registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { IPusherRequest, MatrixClient } from 'matrix-js-sdk';
import { ClientConfig } from '../../config/useClientConfig';
import {
  getActiveSession,
  getSessionScopedStorageKey,
  listSessions,
  type StoredSession,
} from '../../matrix/session/sessions';
import { cloudflareAccessAllowsPush, hasCloudflareAccess } from '../../native/cloudflareAccess';
import {
  isNativeNotificationsAvailable,
  reconcileNativeNotificationAccounts,
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

type AndroidPushDefaultPayload = {
  [IOS_PUSH_ACCOUNT_KEY]: string;
};

type NativePushDefaultPayload = IOSPushDefaultPayload | AndroidPushDefaultPayload;

type MatrixPusherRequest = Omit<IPusherRequest, 'data'> & {
  data: IPusherRequest['data'] & {
    default_payload: NativePushDefaultPayload;
  };
};
type MatrixPusherClient = Pick<MatrixClient, 'setPusher' | 'getHomeserverUrl'>;

export type NativePushPermission = 'prompt' | 'granted' | 'denied';

export type NativePushPlatform = 'ios' | 'android';

export type IOSPushFormat = 'event_id_only' | 'full';

export type IOSPushConfig = {
  platform?: NativePushPlatform;
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

export const isNativeAndroidPushPlatform = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const isNativePushPlatform = (): boolean =>
  isNativeIOSPlatform() || isNativeAndroidPushPlatform();

type MindRoomPushConfigPlugin = {
  isConfigured(): Promise<{ configured?: boolean }>;
};

let pushConfigPlugin: MindRoomPushConfigPlugin | undefined;
let androidPushConfiguredPromise: Promise<boolean> | undefined;

const getPushConfigPlugin = (): MindRoomPushConfigPlugin => {
  pushConfigPlugin ??= registerPlugin<MindRoomPushConfigPlugin>('MindRoomPushConfig');
  return pushConfigPlugin;
};

/**
 * Whether this build includes Firebase configuration (`google-services.json`) for Android FCM.
 * Always true outside native Android; cached on Android so we never call
 * `PushNotifications.register()` without an initialized default `FirebaseApp`.
 */
export const isNativeAndroidPushConfigured = (): Promise<boolean> => {
  if (!isNativeAndroidPushPlatform()) return Promise.resolve(true);
  if (!Capacitor.isPluginAvailable('MindRoomPushConfig')) return Promise.resolve(false);
  if (!androidPushConfiguredPromise) {
    androidPushConfiguredPromise = getPushConfigPlugin()
      .isConfigured()
      .then((result) => result?.configured === true)
      .catch(() => false);
  }
  return androidPushConfiguredPromise;
};

/** Clears the cached Android FCM build-config probe (for tests). */
export const resetNativeAndroidPushConfiguredCache = (): void => {
  androidPushConfiguredPromise = undefined;
  pushConfigPlugin = undefined;
};

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

export const resolveNativePushConfig = (
  clientConfig: ClientConfig,
  platform: NativePushPlatform,
  sessionId?: string,
  appLanguage?: string
): IOSPushConfig | undefined => {
  const platformPushConfig =
    platform === 'android' ? clientConfig.push?.android : clientConfig.push?.ios;

  if (platformPushConfig?.enabled !== true) return undefined;

  const appId = trimConfigValue(platformPushConfig.appId);
  const gatewayUrl = trimConfigValue(platformPushConfig.gatewayUrl);

  if (!appId || !gatewayUrl || !isHttpsUrl(gatewayUrl)) return undefined;

  const defaultDisplayName = platform === 'android' ? 'MindRoom Android' : 'MindRoom iOS';

  return {
    platform,
    appId,
    gatewayUrl,
    appDisplayName: trimConfigValue(platformPushConfig.appDisplayName) ?? defaultDisplayName,
    deviceDisplayName: trimConfigValue(platformPushConfig.deviceDisplayName) ?? defaultDisplayName,
    profileTag:
      trimConfigValue(platformPushConfig.profileTag) ?? getOrCreateIOSPushProfileTag(sessionId),
    append: platformPushConfig.append !== false,
    format: platformPushConfig.format === 'full' ? 'full' : 'event_id_only',
    lang:
      trimConfigValue(platformPushConfig.lang) ?? trimConfigValue(appLanguage) ?? defaultLanguage(),
  };
};

export const resolveIOSPushConfig = (
  clientConfig: ClientConfig,
  sessionId?: string,
  appLanguage?: string,
  platform?: NativePushPlatform
): IOSPushConfig | undefined =>
  resolveNativePushConfig(
    clientConfig,
    platform ?? (isNativeAndroidPushPlatform() ? 'android' : 'ios'),
    sessionId,
    appLanguage
  );

const isAndroidPushConfig = (pushConfig: Pick<IOSPushConfig, 'platform'>): boolean =>
  pushConfig.platform === 'android' || (!pushConfig.platform && isNativeAndroidPushPlatform());

export const buildIOSPushPusherRequest = (
  token: string,
  pushConfig: IOSPushConfig,
  accountTag: string
): MatrixPusherRequest => {
  const defaultPayload: NativePushDefaultPayload = isAndroidPushConfig(pushConfig)
    ? {
        // Sygnal merges the push's room and event IDs into the FCM data payload; no iOS aps block.
        [IOS_PUSH_ACCOUNT_KEY]: accountTag,
      }
    : {
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

/**
 * The tags of the accounts that may share with the notification extension: signed in on this
 * device, with push turned on, on a server that allows pushes. With the deployment's
 * configuration, also only the accounts whose pushes name their sender (`full`). A caller
 * without it (the sign-in pages, a sign-out) leaves those to the next caller that has it.
 */
export const getAllowedNativeNotificationAccountTags = (clientConfig?: ClientConfig): string[] =>
  listSessions().flatMap((session) => {
    // Read first: resolving the push configuration makes a tag for an account without one.
    const accountTag = getStoredIOSPushProfileTag(session.sessionId);
    if (!accountTag || !getIOSPushEnabled(session.sessionId)) return [];
    if (!cloudflareAccessAllowsPush(session.baseUrl)) return [];
    if (clientConfig) {
      const pushConfig = resolveIOSPushConfig(clientConfig, session.sessionId, undefined, 'ios');
      if (!pushConfig) return [];
      if (resolveEffectiveIOSPushFormat(pushConfig, session.baseUrl) !== 'full') return [];
    }
    return [accountTag];
  });

/**
 * Makes what the app shares with the notification extension follow the accounts on this device:
 * an account that is signed out, has push turned off, or may not show rich notifications is
 * removed there, with its avatars and what Siri keeps of it. It only ever removes; an account is
 * shared by `syncNativeNotificationAccount`.
 *
 * Nothing is noted down for a removal that fails or is cut off: the next call (when the app
 * starts or becomes active, and whenever an account changes) removes what is left. Never rejects.
 */
export const reconcileIOSPushNativeState = async (options?: {
  clientConfig?: ClientConfig;
  permission?: NativePushPermission;
}): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  try {
    // Signed out, nothing is shared, whatever iOS and the deployment allow.
    if (listSessions().length === 0) {
      await reconcileNativeNotificationAccounts([]);
      return;
    }
    const permission = options?.permission ?? (await checkIOSPushPermission());
    // iOS allows or denies notifications to the whole app, so to every account.
    await reconcileNativeNotificationAccounts(
      permission === 'granted' ? getAllowedNativeNotificationAccountTags(options?.clientConfig) : []
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[ios-push] could not reconcile the notification accounts', error);
  }
};

/**
 * Removes the account's push state. Resolves once the app has answered the removal of what the
 * account shares with the notification extension, so that a sign-out does not reload under it.
 */
export const clearIOSPushState = async (sessionId?: string): Promise<void> => {
  const storageKeys = [
    resolveScopedStorageKey(PUSH_TOKEN_STORAGE_KEY, sessionId),
    resolveScopedStorageKey(PUSH_PROFILE_TAG_STORAGE_KEY, sessionId),
    resolveScopedStorageKey(PUSH_ENABLED_STORAGE_KEY, sessionId),
  ];
  storageKeys.forEach(removeStorage);
  // Without its stored tag the account is not among the allowed ones any more.
  await reconcileIOSPushNativeState();
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
    const service = isAndroidPushConfig(pushConfig) ? 'FCM' : 'APNs';
    throw new Error(`${service} registration returned an empty push token.`);
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
