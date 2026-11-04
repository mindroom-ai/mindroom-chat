import { useEffect, useState } from 'react';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useInitialClientCatchup } from '../../../hooks/useInitialClientCatchup';
import { useJoinedRoomThreadLists } from './useJoinedRoomThreadLists';

/** The wait after the first catch-up, so the room the app opened with loads its own list first. */
export const THREAD_LISTS_START_DELAY_MS = 3_000;
/** The longest a busy page holds the start back after that wait. */
const IDLE_TIMEOUT_MS = 5_000;

const whenIdle = (callback: () => void): (() => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
};

function JoinedRoomThreadLists() {
  useJoinedRoomThreadLists();
  return null;
}

/**
 * Lists the newest page of every joined room's threads once per session, a few rooms at a time,
 * after the first sync has caught up and the page is idle.
 *
 * A reload replays only the saved sync window, so the client knows just the threads its recent
 * messages touched. Without the lists, the sidebar's Threads section and the command palette's
 * threads miss every quieter thread until its room or the Threads page is opened.
 */
export function JoinedRoomThreadListsFeature() {
  const catchingUp = useInitialClientCatchup(useMatrixClient());
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started || catchingUp) return undefined;
    let cancelIdle: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      cancelIdle = whenIdle(() => setStarted(true));
    }, THREAD_LISTS_START_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      cancelIdle?.();
    };
  }, [started, catchingUp]);

  return started ? <JoinedRoomThreadLists /> : null;
}
