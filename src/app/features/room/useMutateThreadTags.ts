import { useCallback, useRef, useState } from 'react';
import { EventTimeline, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { StateEvent } from '../../../types/matrix/room';
import {
  aggregateThreadTagEvents,
  buildAddTagContent,
  buildPerTagEventContent,
  buildPerTagStateKey,
  buildRemoveTagContent,
  RESOLVED_TAG,
  type ThreadTagsContent,
} from './threadTags';
import { getValidThreadRootEvent } from './threadUtils';
import {
  clearPendingThreadTagsContent,
  setPendingThreadTagsContent,
} from './threadTagPending';

export type UseMutateThreadTagsResult = {
  addTag: (threadRootId: string, tagName: string) => Promise<void>;
  removeTag: (threadRootId: string, tagName: string) => Promise<void>;
  setResolved: (threadRootId: string, resolved: boolean) => Promise<void>;
  updating: boolean;
  error: Error | null;
};

/**
 * Read live state directly from the room timeline.
 * Uses EventTimeline.FORWARDS (not the string 'forward') per CINNY-047 fix.
 */
const readLiveTagsContent = (room: Room, threadRootId: string) => {
  const stateEvents = room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(StateEvent.ThreadTags as string);

  if (!Array.isArray(stateEvents)) {
    return { tags: {} };
  }

  return aggregateThreadTagEvents(stateEvents).get(threadRootId) ?? { tags: {} };
};

/**
 * Write hook for thread tag mutations.
 *
 * All write operations:
 * 1. Re-read live state from EventTimeline.FORWARDS (not cache)
 * 2. Build the next aggregated thread content plus the canonical per-tag write
 * 3. Send via mx.sendStateEvent with a JSON-array per-tag state key
 */
export const useMutateThreadTags = (room: Room): UseMutateThreadTagsResult => {
  const mx = useMatrixClient();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pendingRef = useRef(false);

  const sendUpdate = useCallback(
    async (
      threadRootId: string,
      buildPlan: (
        existing: ThreadTagsContent,
        validThreadRootId: string,
        userId: string,
        setAt: string
      ) => {
        next: ThreadTagsContent;
        stateKey: string;
        eventContent: Record<string, unknown>;
      }
    ) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setUpdating(true);
      setError(null);
      try {
        const userId = mx.getSafeUserId();
        const validThreadRootId = getValidThreadRootEvent(room, threadRootId)?.getId();
        if (!validThreadRootId) {
          throw new Error('Thread tags are only available for known thread roots.');
        }

        const current = readLiveTagsContent(room, validThreadRootId);
        const setAt = new Date().toISOString();
        const { next, stateKey, eventContent } = buildPlan(
          current,
          validThreadRootId,
          userId,
          setAt
        );
        setPendingThreadTagsContent(room.roomId, validThreadRootId, next);
        await mx.sendStateEvent(
          room.roomId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          StateEvent.ThreadTags as any,
          eventContent,
          stateKey
        );
      } catch (err) {
        const validThreadRootId = getValidThreadRootEvent(room, threadRootId)?.getId();
        if (validThreadRootId) {
          clearPendingThreadTagsContent(room.roomId, validThreadRootId);
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        pendingRef.current = false;
        setUpdating(false);
      }
    },
    [mx, room]
  );

  const addTag = useCallback(
    (threadRootId: string, tagName: string) =>
      sendUpdate(threadRootId, (existing, validThreadRootId, userId, setAt) => ({
        next: buildAddTagContent(existing, tagName, userId, setAt),
        stateKey: buildPerTagStateKey(validThreadRootId, tagName),
        eventContent: buildPerTagEventContent(userId, undefined, undefined, setAt),
      })),
    [sendUpdate]
  );

  const removeTag = useCallback(
    (threadRootId: string, tagName: string) =>
      sendUpdate(threadRootId, (existing, validThreadRootId) => ({
        next: buildRemoveTagContent(existing, tagName),
        stateKey: buildPerTagStateKey(validThreadRootId, tagName),
        eventContent: {},
      })),
    [sendUpdate]
  );

  const setResolved = useCallback(
    (threadRootId: string, resolved: boolean) =>
      sendUpdate(threadRootId, (existing, validThreadRootId, userId, setAt) => ({
        next: resolved
          ? buildAddTagContent(existing, RESOLVED_TAG, userId, setAt)
          : buildRemoveTagContent(existing, RESOLVED_TAG),
        stateKey: buildPerTagStateKey(validThreadRootId, RESOLVED_TAG),
        eventContent: resolved
          ? buildPerTagEventContent(userId, undefined, undefined, setAt)
          : {},
      })),
    [sendUpdate]
  );

  return { addTag, removeTag, setResolved, updating, error };
};
