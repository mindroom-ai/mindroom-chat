import {
  calculateRetryBackoff,
  ClientEvent,
  ConnectionError,
  SyncState,
  type Room,
} from 'matrix-js-sdk';
import { holdStreamingChecks } from '../../matrix/client/streamingReplies';

// A room's thread list is read page by page, and each page's token stays on the list's timeline.
// A page that failed used to end the read for good: nothing read on until the room was opened
// again, so a busy room kept the cached summaries of its older threads. A read now waits after a
// page the server may still answer (a dropped connection, a rate limit, a server error) and asks
// for the same page again, as long as someone shows the list. It asks at once when the sync loop
// gets through again after failing, or when a caller comes (the room is opened again); otherwise
// after 1, 2, 4, 8 and then every 16 s, or as long as a rate limit says. While it waits, the
// room's streaming replies are checked one by one, as the list cannot answer for them.

/** The wait doubles from 1 s up to 2^4 s. */
const LONGEST_WAIT_STEP = 4;

/** The wait before asking for a failed page again, or undefined when asking again cannot help. */
export const threadListRetryDelay = (error: unknown, failures: number): number | undefined => {
  const status = (error as { httpStatus?: unknown } | null)?.httpStatus;
  const transient =
    error instanceof ConnectionError ||
    status === 429 ||
    (typeof status === 'number' && status >= 500);
  if (!transient) return undefined;
  return calculateRetryBackoff(error, Math.min(failures, LONGEST_WAIT_STEP), true);
};

const isReconnect = (state: SyncState, previous: SyncState | null): boolean =>
  state === SyncState.Catchup ||
  (state === SyncState.Syncing &&
    (previous === SyncState.Error || previous === SyncState.Reconnecting));

/** One read of a room's thread list, which may wait between tries of a page. */
export type ThreadListRetry = {
  /** Holds the room's streaming checks for the read; returns the function that ends the hold. */
  holdStreamingChecks: () => () => void;
  /**
   * Runs `read` until it succeeds, waiting between tries while the failure may pass. Answers
   * `undefined` when `shouldContinue` turned false; throws any other failure.
   */
  read: <T>(read: () => Promise<T>) => Promise<{ value: T } | undefined>;
  /** Ends the current wait now: a caller came or went. */
  wake: () => void;
};

export const createThreadListRetry = (
  room: Room,
  shouldContinue: () => boolean
): ThreadListRetry => {
  let wakeWait: (() => void) | undefined;
  let releaseChecks: (() => void) | undefined;

  const wait = (delayMs: number) =>
    new Promise<void>((resolve) => {
      const { client } = room;
      const onSync = (state: SyncState, previous: SyncState | null) => {
        if (isReconnect(state, previous)) wakeWait?.();
      };
      const timer = setTimeout(() => wakeWait?.(), delayMs);
      client?.on(ClientEvent.Sync, onSync);
      wakeWait = () => {
        clearTimeout(timer);
        client?.removeListener(ClientEvent.Sync, onSync);
        wakeWait = undefined;
        resolve();
      };
    });

  return {
    holdStreamingChecks: () => {
      releaseChecks = holdStreamingChecks(room);
      return () => {
        releaseChecks?.();
        releaseChecks = undefined;
      };
    },
    read: async <T>(read: () => Promise<T>) => {
      for (let failures = 0; ; failures += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          return { value: await read() };
        } catch (error) {
          const delayMs = threadListRetryDelay(error, failures);
          if (delayMs === undefined || delayMs < 0) throw error;
          if (!shouldContinue()) return undefined;
          // eslint-disable-next-line no-console
          console.warn(`[threadList] a page failed, asking again within ${delayMs} ms:`, error);
          const held = releaseChecks;
          releaseChecks = undefined;
          held?.();
          // eslint-disable-next-line no-await-in-loop
          await wait(delayMs);
          if (held) releaseChecks = holdStreamingChecks(room);
          if (!shouldContinue()) return undefined;
        }
      }
    },
    wake: () => wakeWait?.(),
  };
};
