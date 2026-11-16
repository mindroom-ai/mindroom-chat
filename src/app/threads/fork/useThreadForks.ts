import { useEffect, useMemo } from 'react';
import { RoomEvent, ThreadEvent, type MatrixEvent, type Room, type Thread } from 'matrix-js-sdk';
import { getLinkedTimelines } from '../../event-store/timeline/linkedTimelines';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { parseThreadForkRef } from '../../event-store/threads/threadFork';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';

export type ThreadFork = { threadId: string; ts: number };

/**
 * The roots among `roots` that fork `threadId`, grouped by the message each was made at (the fork
 * point), oldest first. A root's reference is read from its original content: an edit of it keeps
 * the key, and the original is the one that counts. Replies, redacted events, the thread itself
 * and references that do not parse are not forks.
 */
export const groupThreadForks = (
  roots: Iterable<MatrixEvent>,
  threadId: string
): Map<string, ThreadFork[]> => {
  const seen = new Set<string>();
  const found: Array<{ pointId: string; fork: ThreadFork }> = [];
  for (const root of roots) {
    const rootId = root.getId();
    if (!rootId || rootId === threadId || seen.has(rootId)) continue;
    seen.add(rootId);
    if (root.isRedacted() || root.isRelation()) continue;
    const ref = parseThreadForkRef(root.getOriginalContent());
    if (ref?.threadId === threadId) {
      found.push({ pointId: ref.eventId, fork: { threadId: rootId, ts: root.getTs() } });
    }
  }
  found.sort((a, b) => a.fork.ts - b.fork.ts);
  const byPoint = new Map<string, ThreadFork[]>();
  found.forEach(({ pointId, fork }) => {
    byPoint.set(pointId, [...(byPoint.get(pointId) ?? []), fork]);
  });
  return byPoint;
};

const NO_FORKS = new Map<string, ThreadFork[]>();

/** The roots the room knows: those of its threads, and its loaded timeline's events. */
const knownRoots = (room: Room): MatrixEvent[] => [
  ...room.getThreads().flatMap(({ rootEvent }) => rootEvent ?? []),
  ...getLinkedTimelines(room.getUnfilteredTimelineSet().getLiveTimeline()).flatMap((timeline) =>
    timeline.getEvents()
  ),
];

const makesForkOf = (event: MatrixEvent | undefined, threadId: string): boolean =>
  !!event && parseThreadForkRef(event.getOriginalContent())?.threadId === threadId;

/**
 * The forks of thread `threadId` (none outside a thread), by the ID of the message each was made at. The open thread's own
 * view holds no thread roots, so they come from the room: its threads and its loaded timeline. It
 * asks for no more history; a fork whose root the client has not loaded shows once it does.
 */
export const useThreadForks = (
  room: Room,
  threadId: string | undefined
): Map<string, ThreadFork[]> => {
  const mx = useMatrixClient();
  const [version, bump] = useForceUpdate();
  useEffect(() => {
    if (!threadId) return undefined;
    // Only a root that forks this thread changes the answer; the timeline streams all the time.
    const onEvent = (event: MatrixEvent) => {
      if (makesForkOf(event, threadId)) bump();
    };
    const onThread = (thread: Thread) => {
      if (makesForkOf(thread.rootEvent, threadId)) bump();
    };
    // The client re-emits its rooms' timeline events; a thread's creation only the room emits.
    const onRoomEvent = (event: MatrixEvent, eventRoom: Room | undefined) => {
      if (eventRoom?.roomId === room.roomId) onEvent(event);
    };
    mx.on(RoomEvent.Timeline, onRoomEvent);
    room.on(ThreadEvent.New, onThread);
    return () => {
      mx.removeListener(RoomEvent.Timeline, onRoomEvent);
      room.removeListener(ThreadEvent.New, onThread);
    };
  }, [mx, room, threadId, bump]);
  return useMemo(() => {
    // The roots live in the SDK's mutable timelines: `version` renews the read.
    void version;
    return threadId ? groupThreadForks(knownRoots(room), threadId) : NO_FORKS;
  }, [room, threadId, version]);
};
