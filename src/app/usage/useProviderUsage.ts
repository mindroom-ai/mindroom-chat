import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getProviderUsageController, type ProviderUsageState } from './providerUsageController';

export type UseProviderUsageResult = ProviderUsageState & {
  selectRuntime: (runtimeId: string) => void;
  ensureLoaded: (roomId?: string) => void;
  refresh: (force?: boolean) => void;
};

/** Retain the per-client provider usage owner for the lifetime of the signed-in session. */
export const useProviderUsageControllerLifetime = (): void => {
  const mx = useMatrixClient();
  const controller = useMemo(() => getProviderUsageController(mx), [mx]);
  useEffect(() => controller.retain(), [controller]);
};

export const useProviderUsage = (): UseProviderUsageResult => {
  const mx = useMatrixClient();
  const controller = useMemo(() => getProviderUsageController(mx), [mx]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const actions = useMemo(
    () => ({
      selectRuntime: controller.selectRuntime,
      ensureLoaded: controller.ensureLoaded,
      refresh: controller.refresh,
    }),
    [controller]
  );
  return useMemo(() => ({ ...snapshot, ...actions }), [snapshot, actions]);
};
