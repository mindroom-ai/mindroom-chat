import { useCallback, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { SNOOZED_TAG } from '../../event-store/threads/threadTags';
import {
  setThreadResolved,
  unsnoozeThread,
  writeThreadTag,
  type ThreadTagWriteExtra,
} from '../../event-store/threads/threadTagMutations';

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
      await runPending(threadRootId, () => unsnoozeThread(mx, room, threadRootId));
    },
    [mx, room, runPending]
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
