import {
  Direction,
  type EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';

/** Caller supplies an identified root and retains the subsequent server bootstrap. */
export function createInitializedThreadForRoot(room: Room, root: MatrixEvent): Thread {
  const thread = room.createThread(root.getId()!, root, [], false);
  // Constructor-started metadata must not reset replies arriving before that request completes.
  thread.initialEventsFetched = true;
  thread.replayEvents = null;
  return thread;
}

/** One bounded fallback page; mapping and cancellation belong to the caller. */
export function fetchThreadBootstrapRelations(
  mx: MatrixClient,
  roomId: string,
  threadId: string
): ReturnType<MatrixClient['fetchRelations']> {
  return mx.fetchRelations(roomId, threadId, 'm.thread' as any, null, {
    dir: Direction.Backward,
    limit: 50,
  });
}

/** Preserve synchronous SDK prepend and token assignment without awaiting metadata work. */
export function appendThreadBootstrapRelations({
  thread,
  events,
  firstTimeline,
  nextBatch,
}: {
  thread: Thread;
  events: MatrixEvent[];
  firstTimeline: EventTimeline | undefined;
  nextBatch: string | undefined;
}): void {
  thread.addEvents(events, true);
  firstTimeline?.setPaginationToken(nextBatch ?? null, Direction.Backward);
}
