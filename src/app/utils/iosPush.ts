import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { ClientConfig } from '../hooks/useClientConfig';
import { getActiveSession, getSessionScopedStorageKey } from '../state/sessions';

type MatrixPusherRequest = {
  kind: 'http' | null;
  app_id: string;
  pushkey: string;
  app_display_name?: string;
  device_display_name?: string;
  profile_tag?: string;
  lang?: string;
  append?: boolean;
  data?: {
    url?: string;
    format?: 'event_id_only' | 'full';
  };
};

type MatrixPusherClient = {
  setPusher: (pusher: MatrixPusherRequest) => Promise<void>;
};

export type NativePushPermission = 'prompt' | 'granted' | 'denied';

export type IOSPushConfig = {
  appId: string;
  gatewayUrl: string;
  appDisplayName: string;
  deviceDisplayName: string;
  profileTag?: string;
  append: boolean;
  format: 'event_id_only' | 'full';
  lang: string;
};

const PUSH_TOKEN_STORAGE_KEY = 'mindroom_ios_push_token';
const PUSH_PROFILE_TAG_STORAGE_KEY = 'mindroom_ios_push_profile_tag';
const PUSH_ENABLED_STORAGE_KEY = 'mindroom_ios_push_enabled';
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

const removeStorage = (key: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
    dispatchIOSPushStateEvent();
  } catch {
    // ignore localStorage write failures in private mode/blocked storage
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

export const getOrCreateIOSPushProfileTag = (sessionId?: string): string => {
  const storageKey = resolveScopedStorageKey(PUSH_PROFILE_TAG_STORAGE_KEY, sessionId);
  const stored = trimConfigValue(readStorage(storageKey));
  if (stored) return stored;

  const generated = generateProfileTag();
  writeStorage(storageKey, generated);
  return generated;
};

export const resolveIOSPushConfig = (
  clientConfig: ClientConfig,
  sessionId?: string
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
    lang: trimConfigValue(iosPushConfig.lang) ?? defaultLanguage(),
  };
};

export const buildIOSPushPusherRequest = (
  token: string,
  pushConfig: IOSPushConfig
): MatrixPusherRequest => {
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
    },
  };

  return request;
};

const disablePusherByToken = async (mx: MatrixPusherClient, appId: string, token: string) => {
  await mx.setPusher({
    pushkey: token,
    app_id: appId,
    kind: null,
  });
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

export const unregisterIOSPush = async (): Promise<void> => {
  await PushNotifications.unregister();
};

export const getIOSPushEnabled = (sessionId?: string): boolean => {
  const storageKey = resolveScopedStorageKey(PUSH_ENABLED_STORAGE_KEY, sessionId);
  const stored = trimConfigValue(readStorage(storageKey));
  if (stored === '0' || stored === 'false') return false;
  if (stored) return true;
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

export const clearIOSPushState = (sessionId?: string) => {
  clearStoredIOSPushToken(sessionId);
  removeStorage(resolveScopedStorageKey(PUSH_PROFILE_TAG_STORAGE_KEY, sessionId));
  removeStorage(resolveScopedStorageKey(PUSH_ENABLED_STORAGE_KEY, sessionId));
};

export const upsertIOSPushPusher = async (
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

  await mx.setPusher(buildIOSPushPusherRequest(normalizedToken, pushConfig));
  setStoredIOSPushToken(normalizedToken, sessionId);
};

export const disableIOSPushPusher = async (
  mx: MatrixPusherClient,
  pushConfig: IOSPushConfig,
  sessionId?: string
) => {
  const storedToken = getStoredIOSPushToken(sessionId);
  if (!storedToken) return;

  await disablePusherByToken(mx, pushConfig.appId, storedToken);
  clearStoredIOSPushToken(sessionId);
};
