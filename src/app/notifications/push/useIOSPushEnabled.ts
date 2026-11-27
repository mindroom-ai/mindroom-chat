import { useSyncExternalStore } from 'react';
import { getIOSPushEnabled, subscribeToIOSPushState } from './iosPush';

export { useNativeAndroidPushConfigured } from '../../native/androidPushConfig';

export const useIOSPushEnabled = (sessionId?: string): boolean =>
  useSyncExternalStore(
    subscribeToIOSPushState,
    () => getIOSPushEnabled(sessionId),
    () => getIOSPushEnabled(sessionId)
  );
