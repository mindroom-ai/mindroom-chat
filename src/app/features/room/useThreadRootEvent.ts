import { useMemo } from 'react';
import { Room } from 'matrix-js-sdk';

/**
 * Resolve the canonical thread root event ID from a threadId.
 *
 * The threadId passed via URL may be a reply event ID rather than the actual
 * thread root. This hook resolves to the canonical root by checking the SDK
 * thread model and event metadata.
 *
 * Returns undefined only when threadId is undefined.
 * When threadId is defined, always returns a string (falls back to threadId itself).
 */
export const useThreadRootEvent = (
  room: Room,
  threadId: string | undefined
): string | undefined =>
  useMemo(() => {
    if (!threadId) return undefined;

    // Check if the SDK has a thread model for this ID — that means it IS the root.
    const thread = room.getThread(threadId);
    if (thread) return threadId;

    // Check if we can find the event and it has a threadRootId pointing elsewhere.
    const event = room.findEventById(threadId);
    if (event) {
      const rootId = event.threadRootId;
      // If threadRootId exists and differs from the event ID, the event is a reply.
      if (rootId && rootId !== threadId) return rootId;
      // Otherwise, this event IS the root (or standalone).
      return threadId;
    }

    // Event not found yet — return the threadId as-is (it's almost always the root
    // when navigating via thread view). The caller should still succeed because
    // state events keyed by root ID will match.
    return threadId;
  }, [room, threadId]);
