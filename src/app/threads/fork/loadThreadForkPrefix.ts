import type { MatrixEvent } from 'matrix-js-sdk';
import {
  MAX_FORK_DEPTH,
  cutThreadAtForkPoint,
  parseThreadForkRef,
  type ThreadForkRef,
} from '../../event-store/threads/threadFork';

/** The parent conversation a fork shows before its own messages. */
export type ThreadForkPrefix = {
  /** Each parent's messages up to its fork point, the oldest parent first. */
  events: MatrixEvent[];
  /** The root's own reference; undefined when the root is no fork. */
  parent?: ThreadForkRef;
};

/** Reads a thread in `roomId`; `forkPointId` is the last of its events the prefix needs. */
export type LoadThreadEvents = (
  roomId: string,
  threadId: string,
  forkPointId: string
) => Promise<MatrixEvent[]>;

const visitKey = (roomId: string, threadId: string | undefined) => `${roomId}\0${threadId ?? ''}`;

/**
 * Follows the fork references from `root` through its parents. Each hop resolves an omitted
 * `room_id` relative to the owning room of the previous hop, cuts the parent at its fork point,
 * and puts it in front of what was resolved before it. A parent without its fork point among its
 * own messages ends the walk there, as do the depth cap and a cycle, which log.
 */
export const loadThreadForkPrefix = async (
  { loadThreadEvents, roomId }: { loadThreadEvents: LoadThreadEvents; roomId?: string },
  root: MatrixEvent
): Promise<ThreadForkPrefix> => {
  let currentRoomId = roomId ?? root.getRoomId() ?? '';
  const parent = parseThreadForkRef(root.getOriginalContent());
  const segments: MatrixEvent[][] = [];
  const visited = new Set([visitKey(currentRoomId, root.getId())]);
  const prefix = (): ThreadForkPrefix => ({ events: segments.flat(), parent });

  let ref = parent;
  while (ref) {
    const hopRoomId = ref.roomId ?? currentRoomId;
    const { threadId, eventId } = ref;
    const key = visitKey(hopRoomId, threadId);
    if (segments.length >= MAX_FORK_DEPTH || visited.has(key)) {
      console.warn('[threadFork] fork chain stopped', {
        rootId: root.getId(),
        roomId: hopRoomId,
        threadId,
        depth: segments.length,
      });
      return prefix();
    }
    visited.add(key);
    const events = await loadThreadEvents(hopRoomId, threadId, eventId);
    const cut = cutThreadAtForkPoint(threadId, events, eventId);
    if (!cut) return prefix();
    segments.unshift(cut);
    const parentRoot = events.find((event) => event.getId() === threadId);
    if (!parentRoot) return prefix();
    currentRoomId = hopRoomId;
    ref = parseThreadForkRef(parentRoot.getOriginalContent());
  }
  return prefix();
};
