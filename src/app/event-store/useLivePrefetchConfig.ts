import { useStore } from 'jotai';
import { useCallback } from 'react';
import { resolvePrefetchConfig, type PrefetchConfig } from './engine';
import { prefetchSettingsAtom } from './engine/prefetchSettings';

/** Read prefetch settings from the Jotai Provider that owns the mounted app. */
export const useLivePrefetchConfig = (): (() => PrefetchConfig) => {
  const store = useStore();

  return useCallback(() => resolvePrefetchConfig(store.get(prefetchSettingsAtom)), [store]);
};

/** Subscribe the client-owned sync engine to live prefetch scope changes. */
export const usePrefetchConfigSubscription = (): ((listener: () => void) => () => void) => {
  const store = useStore();
  return useCallback((listener) => store.sub(prefetchSettingsAtom, listener), [store]);
};
