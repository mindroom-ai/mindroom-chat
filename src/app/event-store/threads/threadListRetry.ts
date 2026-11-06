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
// room's streaming replies are checked one by one, as the list cannot answer for them. A page that
// keeps failing while the sync gets through ends the read after a few tries, as before, so a room
// whose list the server cannot serve does not hold the other rooms' lists back; the next caller
// goes on from that page.

/** The wait doubles from 1 s up to 2^4 s. */
const LONGEST_WAIT_STEP = 4;
/** Tries of one page while the sync gets through, about half a minute with the waits. */
const TRIES_WHILE_ONLINE = 6;

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
   * After `page` (its token; `null` for the first page) failed with `error`: a wait that answers
   * true when the read should ask for the page again and false when its callers left, or
   * `undefined` when asking again cannot help.
   */
  after: (error: unknown, page: string | null) => Promise<boolean> | undefined;
  /** Ends the current wait now: a caller came or went. */
  wake: () => void;
};

export const createThreadListRetry = (
  room: Room,
  shouldContinue: () => boolean
): ThreadListRetry => {
  let wakeWait: (() => void) | undefined;
  let releaseChecks: (() => void) | undefined;
  /** The page that failed last, how often in a row, and how often while the sync got through. */
  let failing: { page: string | null; failures: number; online: number } | undefined;

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

  const waitToAskAgain = async (error: unknown, delayMs: number): Promise<boolean> => {
    if (!shouldContinue()) return false;
    // eslint-disable-next-line no-console
    console.warn(`[threadList] a page failed, asking again within ${delayMs} ms:`, error);
    const held = releaseChecks;
    releaseChecks = undefined;
    held?.();
    await wait(delayMs);
    if (held) releaseChecks = holdStreamingChecks(room);
    return shouldContinue();
  };

  return {
    holdStreamingChecks: () => {
      releaseChecks = holdStreamingChecks(room);
      return () => {
        releaseChecks?.();
        releaseChecks = undefined;
      };
    },
    after: (error, page) => {
      const same = failing?.page === page ? failing : undefined;
      const failures = same?.failures ?? 0;
      const syncState = room.client?.getSyncState?.();
      const offline = syncState === SyncState.Error || syncState === SyncState.Reconnecting;
      const online = (same?.online ?? 0) + (offline ? 0 : 1);
      const delayMs = threadListRetryDelay(error, failures);
      if (delayMs === undefined || delayMs < 0 || online >= TRIES_WHILE_ONLINE) return undefined;
      failing = { page, failures: failures + 1, online };
      return waitToAskAgain(error, delayMs);
    },
    wake: () => wakeWait?.(),
  };
};
