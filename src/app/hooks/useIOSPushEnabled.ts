import { useSyncExternalStore } from 'react';
import { getIOSPushEnabled, subscribeToIOSPushState } from '../utils/iosPush';

export const useIOSPushEnabled = (sessionId?: string): boolean =>
  useSyncExternalStore(
    subscribeToIOSPushState,
    () => getIOSPushEnabled(sessionId),
    () => getIOSPushEnabled(sessionId)
  );
