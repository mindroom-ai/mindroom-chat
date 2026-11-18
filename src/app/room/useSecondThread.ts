import { useCallback, useEffect, useState } from 'react';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { isRecord } from '../lib/isRecord';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { secondThreadStorageKey } from '../preferences/accountStorageKeys';

/**
 * The second threads the account keeps, by room; anything else stored there, such as an id the
 * server never confirmed, counts as none.
 */
const readAll = (key: string): Record<string, string> => {
  try {
    const value: unknown = JSON.parse(getStorageItemSafe(getSafeLocalStorage(), key) ?? '{}');
    if (!isRecord(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && isConfirmedMatrixEventId(entry[1])
      )
    );
  } catch {
    return {};
  }
};

const write = (key: string, roomId: string, threadId: string | undefined) => {
  const all = readAll(key);
  if (threadId === undefined) delete all[roomId];
  else all[roomId] = threadId;
  setStorageItemSafe(getSafeLocalStorage(), key, JSON.stringify(all));
};

/**
 * The thread shown beside the open one (B) in the room `roomId`, remembered for the account `userId`
 * across reloads and visits to other rooms. `open` shows and remembers one, `close` forgets it. B
 * closes when it becomes the room's open thread `mainThreadId`, so one thread never shows twice.
 * `focus` is whether B should take the focus: one opened here does, in the render that opens it.
 */
export const useSecondThread = (
  roomId: string,
  userId: string,
  mainThreadId: string | undefined
) => {
  const key = secondThreadStorageKey(userId);
  const [shown, setShown] = useState<string>();
  const [focus, setFocus] = useState(false);
  const [lookedUpIn, setLookedUpIn] = useState<string>();
  if (lookedUpIn !== roomId) {
    // Before the room's first render, so B shows with it.
    setLookedUpIn(roomId);
    setShown(readAll(key)[roomId]);
    setFocus(false);
  }

  const open = useCallback(
    (threadId: string) => {
      setShown(threadId);
      setFocus(true);
      write(key, roomId, threadId);
    },
    [key, roomId]
  );
  const close = useCallback(() => {
    setShown(undefined);
    write(key, roomId, undefined);
  }, [key, roomId]);

  // B's view reads it as it mounts, in the commit that opens B; spent then, so a later mount (the
  // window back from a phone's width) leaves the focus where it is.
  useEffect(() => {
    if (focus) setFocus(false);
  }, [focus]);

  const isMain = shown !== undefined && shown === mainThreadId;
  useEffect(() => {
    if (isMain) close();
  }, [close, isMain]);

  return { threadId: isMain ? undefined : shown, focus, open, close };
};
