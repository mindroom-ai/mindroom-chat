import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type MindRoomPushConfigPlugin = {
  isConfigured(): Promise<{ configured?: boolean }>;
  areNotificationsEnabled(): Promise<{ enabled?: boolean }>;
};

let pushConfigPlugin: MindRoomPushConfigPlugin | undefined;
let androidPushConfiguredPromise: Promise<boolean> | undefined;
let androidPushConfiguredValue: boolean | undefined;

const isNativeAndroidPlatform = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const getMindRoomPushConfigPlugin = (): MindRoomPushConfigPlugin => {
  pushConfigPlugin ??= registerPlugin<MindRoomPushConfigPlugin>('MindRoomPushConfig');
  return pushConfigPlugin;
};

/**
 * Whether this build includes Firebase configuration (`google-services.json`) for Android FCM.
 * Always true outside native Android; cached on Android so we never call
 * `PushNotifications.register()` without an initialized default `FirebaseApp`.
 */
export const isNativeAndroidPushConfigured = (): Promise<boolean> => {
  if (!isNativeAndroidPlatform()) return Promise.resolve(true);
  if (!Capacitor.isPluginAvailable('MindRoomPushConfig')) return Promise.resolve(false);
  if (!androidPushConfiguredPromise) {
    androidPushConfiguredPromise = getMindRoomPushConfigPlugin()
      .isConfigured()
      .then((result) => {
        androidPushConfiguredValue = result?.configured === true;
        return androidPushConfiguredValue;
      })
      .catch(() => {
        androidPushConfiguredValue = false;
        return false;
      });
  }
  return androidPushConfiguredPromise;
};

/** Clears the cached Android FCM build-config probe (for tests). */
export const resetNativeAndroidPushConfiguredCache = (): void => {
  androidPushConfiguredPromise = undefined;
  androidPushConfiguredValue = undefined;
  pushConfigPlugin = undefined;
};

/** True only on native Android builds compiled with `google-services.json`. */
export const useNativeAndroidPushConfigured = (): boolean => {
  const isAndroid = isNativeAndroidPlatform();
  const [configured, setConfigured] = useState(
    () => isAndroid && androidPushConfiguredValue === true
  );

  useEffect(() => {
    if (!isAndroid) {
      setConfigured(false);
      return undefined;
    }
    let active = true;
    void isNativeAndroidPushConfigured().then((value) => {
      if (active) setConfigured(value);
    });
    return () => {
      active = false;
    };
  }, [isAndroid]);

  return isAndroid && configured;
};
