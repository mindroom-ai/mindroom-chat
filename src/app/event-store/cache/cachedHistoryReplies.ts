import type { Dispatch, SetStateAction } from 'react';
import type { EventTimeline, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { hydrateCachedEvents } from './eventCacheEditUtils';
import {
  createPreferLiveEventMapper,
  loadCachedThreadEventsInSpan,
  normalizeCachedRoomEvents,
} from './eventRepository';
import { getHistoryReplies, keepHistoryReplies } from '../timeline/classicHistoryReplies';
import { getLinkedTimelines } from '../timeline/linkedTimelines';
import type { Timeline } from '../timeline/timelinePagination';

type CursorAnchor = Parameters<typeof loadCachedThreadEventsInSpan>[2];

/**
 * The events the cache holds in the room's thread scopes from `from` up to `before` (or, without
 * it, everything newer), ready for the room: the live copy of any the client holds, cached edits
 * and redactions applied, decrypted in an encrypted room.
 */
const readCachedThreadEvents = async (
  mx: MatrixClient,
  sessionId: string,
  room: Room,
  from: CursorAnchor,
  before?: CursorAnchor
): Promise<MatrixEvent[]> => {
  const rawEvents = await loadCachedThreadEventsInSpan(sessionId, room.roomId, from, before);
  if (rawEvents.length === 0) return [];
  const mapEvent = createPreferLiveEventMapper(room, mx.getEventMapper());
  const events = normalizeCachedRoomEvents(rawEvents).map((rawEvent) => mapEvent(rawEvent));
  hydrateCachedEvents({ room, events });
  if (room.hasEncryptionStateEvent()) {
    await Promise.all(events.map((event) => mx.decryptEventIfNeeded(event).catch(() => undefined)));
  }
  return events;
};

/** The replies are extra rows: a cache that cannot be read leaves them out, never the history. */
const loadCachedThreadEvents = (
  ...args: Parameters<typeof readCachedThreadEvents>
): Promise<MatrixEvent[]> => readCachedThreadEvents(...args).catch(() => []);

type CachedSpan = {
  mx: MatrixClient;
  sessionId: string;
  room: Room;
  from: CursorAnchor;
  before?: CursorAnchor;
};

/**
 * Where each chain's last read of a span of history ended, by the chain's newest timeline. A page
 * the client saves while the reader scrolls commits its room events and its thread events apart,
 * so a read can find the first without the second: each read also takes the span of the read
 * before it again.
 */
const lastReadEnds = new WeakMap<EventTimeline, CursorAnchor>();

/** The cached thread events of a span of the history `timeline`'s chain holds (see above). */
const loadChainSpan = async (
  timeline: EventTimeline,
  { mx, sessionId, room, from, before }: CachedSpan & { before: CursorAnchor }
): Promise<MatrixEvent[]> => {
  const chainKey = getLinkedTimelines(timeline).at(-1) ?? timeline;
  const end = lastReadEnds.get(chainKey) ?? before;
  lastReadEnds.set(chainKey, before);
  return loadCachedThreadEvents(mx, sessionId, room, from, end);
};

/**
 * Keeps with `timeline`, for the Classic view, the thread replies (with their edits and reactions)
 * the cache holds for a span of room history that came from the cache: from its oldest saved
 * event `from` up to `before`, the earliest room event loaded before it, or with no `before`
 * everything newer.
 */
export const keepCachedHistoryReplies = async ({
  timeline,
  ...span
}: CachedSpan & { timeline: EventTimeline }): Promise<void> => {
  const { before } = span;
  const events = before
    ? await loadChainSpan(timeline, { ...span, before })
    : await loadCachedThreadEvents(span.mx, span.sessionId, span.room, span.from);
  keepHistoryReplies(span.room, timeline, events);
};

/**
 * After the server's page at the start of the chain `edge` belongs to, keeps the thread replies the
 * cache holds between that page and the cached history above it (up to `before`), and draws the
 * rows again (the Classic window keeps its first row). A saved page can end in thread replies
 * older than its oldest saved room event, where the cache's history pages start, and the
 * server's next page starts below them.
 */
export const keepCachedRepliesAboveServerPage = async ({
  edge,
  before,
  setTimeline,
  isCurrent,
  ...span
}: Omit<CachedSpan, 'from' | 'before'> & {
  edge: EventTimeline;
  before: CursorAnchor;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  isCurrent: () => boolean;
}): Promise<void> => {
  // The page's oldest event: the first of the chain or a reply the page kept.
  const [oldest] = [
    getLinkedTimelines(edge)[0]?.getEvents()[0],
    ...getHistoryReplies(getLinkedTimelines(edge)),
  ]
    .filter((event): event is MatrixEvent => !!event?.getId())
    .sort((a, b) => a.getTs() - b.getTs());
  const from = oldest && { eventId: oldest.getId() ?? '', ts: oldest.getTs() };
  if (!from) return;
  const events = await loadChainSpan(edge, { ...span, from, before });
  const [first] = getLinkedTimelines(edge);
  if (!first || events.length === 0 || !isCurrent()) return;
  if (keepHistoryReplies(span.room, first, events).length > 0) {
    setTimeline((current) => ({ ...current }));
  }
};
