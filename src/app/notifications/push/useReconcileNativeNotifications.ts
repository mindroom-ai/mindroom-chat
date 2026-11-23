import { useEffect } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { isNativeNotificationsAvailable } from '../../native/nativeNotifications';
import { reconcileIOSPushNativeState } from './iosPush';

/**
 * On the iPhone and iPad app, removes from what the app shares with the notification extension
 * every account that may no longer share: one that signed out (also when its sign-out was cut
 * off), turned push off, or lost the permission of iOS. It does so when the app starts and
 * whenever it becomes active, signed in or not, since the account concerned is mostly signed out
 * by then.
 */
export function useReconcileNativeNotifications(): void {
  const available = isNativeNotificationsAvailable();
  useEffect(() => {
    if (!available) return undefined;
    // Never rejects: what a reconcile leaves is removed by the next one.
    void reconcileIOSPushNativeState();
    const handle = NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void reconcileIOSPushNativeState();
    });
    return () => {
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [available]);
}
