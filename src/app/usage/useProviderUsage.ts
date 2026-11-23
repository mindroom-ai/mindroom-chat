import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import {
  getProviderUsageController,
  snapshotForRuntime,
  type ProviderUsageState,
  type RuntimeIdentity,
} from './providerUsageController';
import type { ProviderUsageSnapshot } from './providerUsageProtocol';

export type UseProviderUsageResult = ProviderUsageState & {
  selectRuntime: (runtimeId: string) => void;
  ensureLoaded: (roomId?: string) => void;
  refresh: (force?: boolean) => void;
};

export type UseRuntimeProviderUsageResult = {
  available: boolean;
  snapshot: ProviderUsageSnapshot | undefined;
  ensureLoaded: () => void;
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

/** Strictly resolves provider usage for one authenticated runtime; never falls back to another. */
export const useRuntimeProviderUsage = (
  roomId: string | undefined,
  runtime: RuntimeIdentity | undefined
): UseRuntimeProviderUsageResult => {
  const usage = useProviderUsage();
  const snapshot = useMemo(() => snapshotForRuntime(usage, runtime), [usage, runtime]);
  const ensureLoaded = useCallback(() => usage.ensureLoaded(roomId), [usage, roomId]);
  return useMemo(
    () => ({ available: usage.available, snapshot, ensureLoaded }),
    [usage.available, snapshot, ensureLoaded]
  );
};
