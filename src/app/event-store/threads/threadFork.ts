import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { THREAD_FORK_KEY } from '../../matrix/protocol/threadFork';
import { isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';
import { getThreadTimelineEvents } from '../timeline/linkedTimelines';
import { compareThreadRenderOrder } from './threadRenderUtils';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { eventBelongsToThread } from './threadUtils';

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

/**
 * `content` with the reference `original` carries: an edit of a fork's root keeps it, as MindRoom
 * reads a message's latest revision.
 */
export const keepThreadForkRef = <T extends Record<string, unknown>>(
  original: unknown,
  content: T
): T => {
  const ref = parseThreadForkRef(original);
  return ref ? { ...content, ...threadForkContent(ref) } : content;
};

/** The thread ID a fork draft keeps its composer text under, apart from its thread's own. */
export const threadForkDraftId = (ref: ThreadForkRef): string =>
  `fork:${ref.threadId}:${ref.eventId}`;

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

/**
 * The fork point of "fork from here" on a thread's row: its owning thread and ID. A row without a
 * thread relation is a thread's root, also a root copied from the cache, which has no thread object
 * to say so. Undefined for a local echo and for anything a thread's readers do not count as a
 * message: an edit, a redacted message, another event type.
 */
export const forkTargetFor = (event: MatrixEvent): ThreadForkRef | undefined => {
  const eventId = event.getId();
  if (!isConfirmedMatrixEventId(eventId) || event.getType() !== 'm.room.message') return undefined;
  if (event.isRedacted() || event.getRelation()?.rel_type === 'm.replace') return undefined;
  return { threadId: ownThreadId(event) ?? eventId, eventId };
};

/**
 * "Fork thread": the latest message of the thread the room holds, the fork point of its copy. A
 * title notice is the thread's title, not part of the conversation, and often hidden in it.
 */
export const latestForkPoint = (room: Room, threadId: string): ThreadForkRef | undefined => {
  const thread = room.getThread(threadId);
  const root = thread?.rootEvent ?? room.findEventById(threadId);
  const events = [...(root ? [root] : []), ...(thread ? getThreadTimelineEvents(thread) : [])];
  events.sort(compareThreadRenderOrder);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    const ref = isThreadSummaryEvent(event) ? undefined : forkTargetFor(event);
    if (ref?.threadId === threadId) return ref;
  }
  return undefined;
};
