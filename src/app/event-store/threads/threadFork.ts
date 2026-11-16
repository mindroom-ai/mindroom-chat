import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { compareThreadRenderOrder } from './threadRenderUtils';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { eventBelongsToThread } from './threadUtils';

/** Content key on a fork's root: `{thread_id, event_id}` of the parent and its last included message. */
export const THREAD_FORK_KEY = 'io.mindroom.fork';

/** A chain of forks is followed through at most this many parents. */
export const MAX_FORK_DEPTH = 8;

export type ThreadForkRef = { threadId: string; eventId: string };

export const parseThreadForkRef = (content: unknown): ThreadForkRef | undefined => {
  if (typeof content !== 'object' || content === null) return undefined;
  const raw = (content as Record<string, unknown>)[THREAD_FORK_KEY];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { thread_id: threadId, event_id: eventId } = raw as Record<string, unknown>;
  if (!isConfirmedMatrixEventId(threadId) || !isConfirmedMatrixEventId(eventId)) return undefined;
  return { threadId, eventId };
};

export const threadForkContent = (ref: ThreadForkRef): Record<string, unknown> => ({
  [THREAD_FORK_KEY]: { thread_id: ref.threadId, event_id: ref.eventId },
});

/** The thread an event belongs to: its thread root, or its own ID when it is one. */
export const ownThreadId = (event: MatrixEvent): string | undefined =>
  event.threadRootId ?? (event.isThreadRoot ? event.getId() : undefined);

/** The thread's own events in thread order up to and including `eventId`; undefined when it is not among them. */
export const cutThreadAtForkPoint = (
  threadId: string,
  events: MatrixEvent[],
  eventId: string
): MatrixEvent[] | undefined => {
  const own = events.filter((event) => eventBelongsToThread(event, threadId));
  own.sort(compareThreadRenderOrder);
  const index = own.findIndex((event) => event.getId() === eventId);
  return index === -1 ? undefined : own.slice(0, index + 1);
};

/** The fork point of "fork from here" on a row: its owning thread and ID; undefined for a local echo. */
export const forkTargetFor = (event: MatrixEvent): ThreadForkRef | undefined => {
  const eventId = event.getId();
  const threadId = ownThreadId(event);
  if (!isConfirmedMatrixEventId(eventId) || !threadId) return undefined;
  return { threadId, eventId };
};
