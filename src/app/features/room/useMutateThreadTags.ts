import { useCallback, useRef, useState } from 'react';
import { EventTimeline, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { StateEvent } from '../../../types/matrix/room';
import {
  buildAddTagContent,
  buildRemoveTagContent,
  buildResolvedTagsContent,
  buildUnresolvedTagsContent,
  parseThreadTagsContent,
} from './threadTags';

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
  const stateEvent = room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(StateEvent.ThreadTags, threadRootId);
  return parseThreadTagsContent(stateEvent?.getContent());
};

/**
 * Write hook for thread tag mutations.
 *
 * All write operations:
 * 1. Re-read live state from EventTimeline.FORWARDS (not cache)
 * 2. Build the next content by merging/removing
 * 3. Send via mx.sendStateEvent with threadRootId as state key
 */
export const useMutateThreadTags = (room: Room): UseMutateThreadTagsResult => {
  const mx = useMatrixClient();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pendingRef = useRef(false);

  const sendUpdate = useCallback(
    async (
      threadRootId: string,
      buildContent: (
        existing: ReturnType<typeof parseThreadTagsContent>,
        userId: string
      ) => ReturnType<typeof parseThreadTagsContent>
    ) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setUpdating(true);
      setError(null);
      try {
        const userId = mx.getSafeUserId();
        const current = readLiveTagsContent(room, threadRootId);
        const next = buildContent(current, userId);
        await mx.sendStateEvent(
          room.roomId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          StateEvent.ThreadTags as any,
          next,
          threadRootId
        );
      } catch (err) {
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
      sendUpdate(threadRootId, (existing, userId) =>
        buildAddTagContent(existing, tagName, userId)
      ),
    [sendUpdate]
  );

  const removeTag = useCallback(
    (threadRootId: string, tagName: string) =>
      sendUpdate(threadRootId, (existing) =>
        buildRemoveTagContent(existing, tagName)
      ),
    [sendUpdate]
  );

  const setResolved = useCallback(
    (threadRootId: string, resolved: boolean) =>
      sendUpdate(threadRootId, (existing, userId) =>
        resolved
          ? buildResolvedTagsContent(existing, userId)
          : buildUnresolvedTagsContent(existing)
      ),
    [sendUpdate]
  );

  return { addTag, removeTag, setResolved, updating, error };
};
