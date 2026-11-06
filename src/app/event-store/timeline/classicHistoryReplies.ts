import {
  THREAD_RELATION_TYPE,
  type EventTimeline,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { getLinkedTimelines } from './linkedTimelines';
import { isRenderableEvent } from './roomTimelineEvents';

/**
 * The thread replies that pages of room history bring, kept for the Classic view, which shows them
 * among the room's rows. The SDK keeps none of them: a page of room history adds only the room's
 * own events to its timeline, and a thread holds only the replies it loaded itself. Each timeline
 * keeps the replies of the pages it took, so they leave with it when the room's timelines are
 * replaced (a gappy sync, a jump to a time).
 */
const repliesByTimeline = new WeakMap<EventTimeline, MatrixEvent[]>();

const isThreadReply = (event: MatrixEvent): boolean => event.isRelation(THREAD_RELATION_TYPE.name);

/** The replies kept with `timelines`, in the order they came. */
export const getHistoryReplies = (timelines: EventTimeline[]): MatrixEvent[] =>
  timelines.flatMap((timeline) => repliesByTimeline.get(timeline) ?? []);

/**
 * Keeps the thread replies among `threadedEvents` (events of a span of room history that live in
 * threads) with `timeline`, once per chain of timelines, and puts their edits and reactions where
 * rows look for them: the room's relations, which every timeline of the room shares. An edit that
 * came before its reply (with a newer page) now finds it. Returns the replies kept.
 */
export const keepHistoryReplies = (
  room: Room,
  timeline: EventTimeline,
  threadedEvents: MatrixEvent[]
): MatrixEvent[] => {
  const known = new Set(
    getHistoryReplies(getLinkedTimelines(timeline)).map((event) => event.getId())
  );
  const replies = threadedEvents.filter((event) => {
    const id = event.getId();
    if (!id || !isThreadReply(event) || known.has(id)) return false;
    known.add(id);
    return true;
  });
  threadedEvents.forEach((event) => {
    if (!isThreadReply(event)) room.relations.aggregateChildEvent(event);
  });
  replies.forEach((reply) => room.relations.aggregateParentEvent(reply));
  if (replies.length > 0) {
    repliesByTimeline.set(timeline, [...(repliesByTimeline.get(timeline) ?? []), ...replies]);
  }
  return replies;
};

/** The filters a row of the room passes, thread replies included. */
export type HistoryReplyFilters = { ignoredUsersSet: Set<string> } & Record<
  'showHiddenEvents' | 'hideMembershipEvents' | 'hideNickAvatarEvents',
  boolean
>;

/** The kept replies of `timelines` that pass the filters of the room's rows. */
export const getShownHistoryReplies = (
  room: Room,
  timelines: EventTimeline[],
  filters: HistoryReplyFilters
): MatrixEvent[] =>
  getHistoryReplies(timelines).filter((event) =>
    isRenderableEvent(
      event,
      room,
      undefined,
      filters.ignoredUsersSet,
      filters.showHiddenEvents,
      filters.hideMembershipEvents,
      filters.hideNickAvatarEvents,
      true
    )
  );
