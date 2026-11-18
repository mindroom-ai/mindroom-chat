import { useSyncExternalStore } from 'react';
import { getDebugModeEnabled, subscribeDebugMode } from './debugMode';

const readDebugMode = (): boolean => getDebugModeEnabled();

/** Whether debug mode is on, following changes made in Settings while the caller is mounted. */
export const useDebugMode = (): boolean =>
  useSyncExternalStore(subscribeDebugMode, readDebugMode, readDebugMode);
