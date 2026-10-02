import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { useEffect, useSyncExternalStore } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';

/** Cards scrolled past within this time do not load their thread. */
export const SHOWN_THREAD_DWELL_MS = 500;

type LiveSync = { count: number; listeners: Set<() => void> };

const liveSyncs = new WeakMap<MatrixClient, LiveSync>();

/** Counts the client's returns to live sync: the first `/sync` response and each reconnect. */
const getLiveSync = (mx: MatrixClient): LiveSync => {
  let liveSync = liveSyncs.get(mx);
  if (!liveSync) {
    const created: LiveSync = {
      count: mx.getSyncState() === SyncState.Syncing ? 1 : 0,
      listeners: new Set(),
    };
    mx.on(ClientEvent.Sync, (state, previous) => {
      if (state !== SyncState.Syncing || previous === SyncState.Syncing) return;
      created.count += 1;
      created.listeners.forEach((listener) => listener());
    });
    liveSyncs.set(mx, created);
    liveSync = created;
  }
  return liveSync;
};

/**
 * The SDK leaves listed threads summary-only until they are opened or shown.
 * A shown card needs the thread's latest page, edits and counts, so load it once the client is live,
 * which keeps `/sync` ahead of it, and again after a reconnect if that attempt failed.
 */
export const useInitializeShownThread = (roomId: string, threadRootId: string | undefined) => {
  const mx = useMatrixClient();
  const liveSync = getLiveSync(mx);
  const liveSyncCount = useSyncExternalStore(
    (onChange) => {
      liveSync.listeners.add(onChange);
      return () => {
        liveSync.listeners.delete(onChange);
      };
    },
    () => liveSync.count
  );
  const thread = threadRootId ? mx.getRoom(roomId)?.getThread(threadRootId) : undefined;

  useEffect(() => {
    if (!thread || liveSyncCount === 0) return undefined;
    const timer = setTimeout(() => {
      void thread.initialize?.();
    }, SHOWN_THREAD_DWELL_MS);
    return () => clearTimeout(timer);
  }, [thread, liveSyncCount]);
};
