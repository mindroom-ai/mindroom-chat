import { useMemo, useSyncExternalStore } from 'react';

export type PendingThreadResolution = {
  resolved: boolean;
};

export const THREAD_RESOLUTION_PENDING_TIMEOUT_MS = 15000;

const PENDING_THREAD_RESOLUTION_SEPARATOR = '\u0000';

const pendingThreadResolutions = new Map<string, PendingThreadResolution>();
const pendingThreadResolutionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

let pendingThreadResolutionVersion = 0;

const getPendingThreadResolutionKey = (roomId: string, threadRootId: string): string =>
  `${roomId}${PENDING_THREAD_RESOLUTION_SEPARATOR}${threadRootId}`;

const emitPendingThreadResolutionChange = () => {
  pendingThreadResolutionVersion += 1;
  listeners.forEach((listener) => listener());
};

const clearPendingThreadResolutionTimeout = (key: string) => {
  const timeout = pendingThreadResolutionTimeouts.get(key);
  if (timeout === undefined) return;

  clearTimeout(timeout);
  pendingThreadResolutionTimeouts.delete(key);
};

const subscribePendingThreadResolution = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const getPendingThreadResolutionVersion = () => pendingThreadResolutionVersion;

export const getPendingThreadResolution = (
  roomId: string,
  threadRootId: string
): PendingThreadResolution | undefined =>
  pendingThreadResolutions.get(getPendingThreadResolutionKey(roomId, threadRootId));

export const getPendingThreadResolutionMap = (
  roomId: string
): Map<string, PendingThreadResolution> => {
  const prefix = `${roomId}${PENDING_THREAD_RESOLUTION_SEPARATOR}`;
  const roomPendingThreadResolutions = new Map<string, PendingThreadResolution>();

  pendingThreadResolutions.forEach((pendingResolution, key) => {
    if (!key.startsWith(prefix)) return;

    roomPendingThreadResolutions.set(key.slice(prefix.length), pendingResolution);
  });

  return roomPendingThreadResolutions;
};

export const setPendingThreadResolution = (
  roomId: string,
  threadRootId: string,
  resolved: boolean,
  timeoutMs = THREAD_RESOLUTION_PENDING_TIMEOUT_MS
) => {
  const key = getPendingThreadResolutionKey(roomId, threadRootId);

  clearPendingThreadResolutionTimeout(key);
  pendingThreadResolutions.set(key, { resolved });
  pendingThreadResolutionTimeouts.set(
    key,
    setTimeout(() => {
      clearPendingThreadResolution(roomId, threadRootId);
    }, timeoutMs)
  );
  emitPendingThreadResolutionChange();
};

export const clearPendingThreadResolution = (roomId: string, threadRootId: string) => {
  const key = getPendingThreadResolutionKey(roomId, threadRootId);
  const hadPendingResolution = pendingThreadResolutions.delete(key);
  const hadTimeout = pendingThreadResolutionTimeouts.has(key);

  clearPendingThreadResolutionTimeout(key);

  if (hadPendingResolution || hadTimeout) {
    emitPendingThreadResolutionChange();
  }
};

export const resetPendingThreadResolutions = () => {
  pendingThreadResolutionTimeouts.forEach((timeout) => clearTimeout(timeout));
  pendingThreadResolutionTimeouts.clear();

  if (pendingThreadResolutions.size === 0) {
    pendingThreadResolutionVersion = 0;
    return;
  }

  pendingThreadResolutions.clear();
  pendingThreadResolutionVersion = 0;
  emitPendingThreadResolutionChange();
};

const usePendingThreadResolutionVersion = () =>
  useSyncExternalStore(
    subscribePendingThreadResolution,
    getPendingThreadResolutionVersion,
    getPendingThreadResolutionVersion
  );

export const usePendingThreadResolution = (
  roomId: string,
  threadRootId?: string
): PendingThreadResolution | undefined => {
  const version = usePendingThreadResolutionVersion();

  return useMemo(
    () => (threadRootId ? getPendingThreadResolution(roomId, threadRootId) : undefined),
    [roomId, threadRootId, version]
  );
};

export const usePendingThreadResolutionMap = (
  roomId: string
): Map<string, PendingThreadResolution> => {
  const version = usePendingThreadResolutionVersion();

  return useMemo(() => getPendingThreadResolutionMap(roomId), [roomId, version]);
};
