import { useCallback, useRef, useState } from 'react';
import { EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  aggregateThreadTagEvents,
  buildPerTagEventContent,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  normalizeTagName,
  RESOLVED_TAG,
  SNOOZED_TAG,
} from '../../event-store/threads/threadTags';
import { clearPendingThreadTag, setPendingThreadTag } from './threadTagPending';
import { getResolvableThreadRootEvent } from '../../event-store/threads/threadResolvableRoot';
import { isThreadPinned } from '../../event-store/threads/threadPinning';

export type UseMutateThreadTagsResult = {
  addTag: (threadRootId: string, tagName: string) => Promise<void>;
  removeTag: (threadRootId: string, tagName: string) => Promise<void>;
  setResolved: (threadRootId: string, resolved: boolean) => Promise<void>;
  /**
   * Snoozes the thread until a later time and resolves whether the snooze was written; a past
   * time or a pinned thread sets `error`.
   */
  snooze: (threadRootId: string, until: Date, note?: string) => Promise<boolean>;
  unsnooze: (threadRootId: string) => Promise<void>;
  updating: boolean;
  updatingThreadRootIds: ReadonlySet<string>;
  error: Error | null;
};

/**
 * Write hook for thread tag mutations.
 *
 * Each tag is its own state event (a JSON-array per-tag state key), so a write sets or removes
 * one tag and leaves the others, including ones another person sets at the same moment. The
 * write shows at once as a pending tag over the live tags until room state shows it.
 */
export type ThreadTagWriteExtra = {
  note?: string;
  data?: Record<string, unknown>;
};

/**
 * Sends a single per-tag state event for `threadRootId` in `room`, publishing an optimistic
 * pending tag immediately and rolling it back if the write fails.
 */
export async function writeThreadTag(
  mx: MatrixClient,
  room: Room,
  threadRootId: string,
  tagName: string,
  present: boolean,
  extra: ThreadTagWriteExtra = {}
): Promise<void> {
  const userId = mx.getSafeUserId();
  const validThreadRootId = getResolvableThreadRootEvent(room, threadRootId)?.getId();
  if (!validThreadRootId) {
    throw new Error('Thread tags are only available for known thread roots.');
  }

  const stateKey = buildPerTagStateKey(validThreadRootId, tagName);
  const pinned = () => isThreadPinned(room, validThreadRootId);
  if (stateKey === buildPerTagStateKey(validThreadRootId, RESOLVED_TAG) && pinned()) {
    throw new Error('Pinned threads cannot be resolved.');
  }
  // A snooze set before the pin may still be lifted.
  if (present && stateKey === buildPerTagStateKey(validThreadRootId, SNOOZED_TAG) && pinned()) {
    throw new Error('Pinned threads cannot be snoozed.');
  }
  const content = present
    ? buildPerTagEventContent(userId, extra.note, extra.data, new Date().toISOString())
    : undefined;
  const pending: [rootId: string, tag: string] = [validThreadRootId, normalizeTagName(tagName)];
  // The pending tag is the content being sent: its author, time, note and data.
  setPendingThreadTag(room.roomId, ...pending, content ?? null);
  try {
    await mx.sendStateEvent(
      room.roomId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MINDROOM_THREAD_TAGS_EVENT as any,
      content ?? {},
      stateKey
    );
  } catch (err) {
    clearPendingThreadTag(room.roomId, ...pending);
    throw err;
  }
}

/**
 * Resolves or reopens a thread in `room`, clearing any `snoozed` tag when resolving so reopening
 * later does not restore an old snooze.
 */
export async function setThreadResolved(
  mx: MatrixClient,
  room: Room,
  threadRootId: string,
  resolved: boolean
): Promise<void> {
  await writeThreadTag(mx, room, threadRootId, RESOLVED_TAG, resolved);
  if (!resolved) return;
  // Resolving ends a snooze, as the backend's resolve does; left set, reopening would bring
  // it back and the backend would still clear it at its time.
  const rawEvents = room
    .getLiveTimeline?.()
    ?.getState?.(EventTimeline.FORWARDS)
    ?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT);
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  if (aggregateThreadTagEvents(events).get(threadRootId)?.tags[SNOOZED_TAG]) {
    await writeThreadTag(mx, room, threadRootId, SNOOZED_TAG, false);
  }
}

export const useMutateThreadTags = (room: Room): UseMutateThreadTagsResult => {
  const mx = useMatrixClient();
  const [updatingThreadRootIds, setUpdatingThreadRootIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [error, setError] = useState<Error | null>(null);
  const pendingRef = useRef(new Set<string>());

  const runPending = useCallback(
    async (threadRootId: string, task: () => Promise<void>): Promise<boolean> => {
      if (pendingRef.current.has(threadRootId)) return false;
      pendingRef.current.add(threadRootId);
      setUpdatingThreadRootIds(new Set(pendingRef.current));
      setError(null);
      try {
        await task();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        return false;
      } finally {
        pendingRef.current.delete(threadRootId);
        setUpdatingThreadRootIds(new Set(pendingRef.current));
      }
    },
    []
  );

  const sendUpdate = useCallback(
    (
      threadRootId: string,
      tagName: string,
      present: boolean,
      extra: ThreadTagWriteExtra = {}
    ): Promise<boolean> =>
      runPending(threadRootId, () =>
        writeThreadTag(mx, room, threadRootId, tagName, present, extra)
      ),
    [mx, room, runPending]
  );

  const addTag = useCallback(
    async (threadRootId: string, tagName: string) => {
      await sendUpdate(threadRootId, tagName, true);
    },
    [sendUpdate]
  );

  const removeTag = useCallback(
    async (threadRootId: string, tagName: string) => {
      await sendUpdate(threadRootId, tagName, false);
    },
    [sendUpdate]
  );

  const setResolved = useCallback(
    async (threadRootId: string, resolved: boolean) => {
      await runPending(threadRootId, () => setThreadResolved(mx, room, threadRootId, resolved));
    },
    [mx, room, runPending]
  );

  const snooze = useCallback(
    async (threadRootId: string, until: Date, note?: string) => {
      if (!(until.getTime() > Date.now())) {
        setError(new Error('Snooze time must be in the future.'));
        return false;
      }
      return sendUpdate(threadRootId, SNOOZED_TAG, true, {
        note,
        data: { until: until.toISOString() },
      });
    },
    [sendUpdate]
  );

  const unsnooze = useCallback(
    async (threadRootId: string) => {
      await sendUpdate(threadRootId, SNOOZED_TAG, false);
    },
    [sendUpdate]
  );

  return {
    addTag,
    removeTag,
    setResolved,
    snooze,
    unsnooze,
    updating: updatingThreadRootIds.size > 0,
    updatingThreadRootIds,
    error,
  };
};
