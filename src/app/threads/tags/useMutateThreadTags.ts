import { useCallback, useRef, useState } from 'react';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  buildPerTagEventContent,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  normalizeTagName,
  RESOLVED_TAG,
} from '../../event-store/threads/threadTags';
import { clearPendingThreadTag, setPendingThreadTag } from './threadTagPending';
import { getResolvableThreadRootEvent } from '../../event-store/threads/threadResolvableRoot';
import { isThreadPinned } from '../../event-store/threads/threadPinning';

export type UseMutateThreadTagsResult = {
  addTag: (threadRootId: string, tagName: string) => Promise<void>;
  removeTag: (threadRootId: string, tagName: string) => Promise<void>;
  setResolved: (threadRootId: string, resolved: boolean) => Promise<void>;
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

  const sendUpdate = useCallback(
    async (threadRootId: string, tagName: string, present: boolean) => {
      if (pendingRef.current.has(threadRootId)) return;
      pendingRef.current.add(threadRootId);
      setUpdatingThreadRootIds(new Set(pendingRef.current));
      setError(null);
      let pending: [rootId: string, tag: string] | undefined;
      try {
        const userId = mx.getSafeUserId();
        const validThreadRootId = getResolvableThreadRootEvent(room, threadRootId)?.getId();
        if (!validThreadRootId) {
          throw new Error('Thread tags are only available for known thread roots.');
        }

        const stateKey = buildPerTagStateKey(validThreadRootId, tagName);
        if (
          stateKey === buildPerTagStateKey(validThreadRootId, RESOLVED_TAG) &&
          isThreadPinned(room, validThreadRootId)
        ) {
          throw new Error('Pinned threads cannot be resolved.');
        }
        const setAt = new Date().toISOString();
        pending = [validThreadRootId, normalizeTagName(tagName)];
        setPendingThreadTag(
          room.roomId,
          ...pending,
          present ? { set_by: userId, set_at: setAt } : null
        );
        await mx.sendStateEvent(
          room.roomId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          MINDROOM_THREAD_TAGS_EVENT as any,
          present ? buildPerTagEventContent(userId, undefined, undefined, setAt) : {},
          stateKey
        );
      } catch (err) {
        if (pending) clearPendingThreadTag(room.roomId, ...pending);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        pendingRef.current.delete(threadRootId);
        setUpdatingThreadRootIds(new Set(pendingRef.current));
      }
    },
    [mx, room]
  );

  const addTag = useCallback(
    (threadRootId: string, tagName: string) => sendUpdate(threadRootId, tagName, true),
    [sendUpdate]
  );

  const removeTag = useCallback(
    (threadRootId: string, tagName: string) => sendUpdate(threadRootId, tagName, false),
    [sendUpdate]
  );

  const setResolved = useCallback(
    (threadRootId: string, resolved: boolean) =>
      sendUpdate(threadRootId, RESOLVED_TAG, resolved),
    [sendUpdate]
  );

  return {
    addTag,
    removeTag,
    setResolved,
    updating: updatingThreadRootIds.size > 0,
    updatingThreadRootIds,
    error,
  };
};
