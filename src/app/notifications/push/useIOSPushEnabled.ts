import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getIOSPushEnabled,
  isNativeAndroidPushConfigured,
  isNativeAndroidPushPlatform,
  subscribeToIOSPushState,
} from './iosPush';

export const useIOSPushEnabled = (sessionId?: string): boolean =>
  useSyncExternalStore(
    subscribeToIOSPushState,
    () => getIOSPushEnabled(sessionId),
    () => getIOSPushEnabled(sessionId)
  );

/** True only on native Android builds compiled with `google-services.json`. */
export const useNativeAndroidPushConfigured = (): boolean => {
  const isAndroid = isNativeAndroidPushPlatform();
  const [configured, setConfigured] = useState(false);

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
