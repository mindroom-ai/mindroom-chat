import { useEffect } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { isNativeNotificationsAvailable } from '../../native/nativeNotifications';
import { flushPendingNativeNotificationClears } from './iosPush';

/**
 * On the iPhone and iPad app, makes the removals that the app still owes the notification
 * extension: of an account whose sign-out was cut off, or whose removal the Keychain or Siri
 * refused. It tries when the app starts and whenever it becomes active, signed in or not, since
 * the account concerned is mostly signed out by then.
 */
export function usePendingNativeNotificationClears(): void {
  const available = isNativeNotificationsAvailable();
  useEffect(() => {
    if (!available) return undefined;
    // Never rejects: a removal that fails again stays noted down.
    void flushPendingNativeNotificationClears();
    const handle = NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void flushPendingNativeNotificationClears();
    });
    return () => {
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [available]);
}
