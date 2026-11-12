import { EventTimeline, type Room, type RoomState } from 'matrix-js-sdk';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  aggregateThreadTagEvents,
  getDisplayTags,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  parsePerTagStateKey,
  RESOLVED_TAG,
  type ThreadTagsContent,
} from '../../event-store/threads/threadTags';

export type ThreadTagSnapshot = {
  content: ThreadTagsContent;
  isResolved: boolean;
  /** While resolved: when its tag was last written, by the server's clock. */
  resolvedTs?: number;
  displayTags: string[];
};

export const buildThreadTagSnapshot = (
  content: ThreadTagsContent,
  resolvedTs?: number
): ThreadTagSnapshot => {
  const isResolved = isThreadResolved(content);
  return {
    content,
    isResolved,
    ...(isResolved && resolvedTs !== undefined ? { resolvedTs } : {}),
    displayTags: getDisplayTags(content),
  };
};

/**
 * When each thread's resolved tag was last written: the time of its own state event, else of the
 * thread's legacy event, which holds every tag at once.
 */
const getResolvedTagTimes = (events: MatrixEvent[]): Map<string, number> => {
  const legacy = new Map<string, number>();
  const perTag = new Map<string, number>();
  events.forEach((event) => {
    const stateKey = event.getStateKey();
    const ts: unknown = event.getTs();
    if (typeof stateKey !== 'string' || typeof ts !== 'number') return;
    const parsed = parsePerTagStateKey(stateKey);
    if (!parsed) legacy.set(stateKey, ts);
    else if (parsed.tagName === RESOLVED_TAG) perTag.set(parsed.threadRootId, ts);
  });
  return new Map([...legacy, ...perTag]);
};

export const buildThreadTagSnapshotMap = (
  events: MatrixEvent[]
): Map<string, ThreadTagSnapshot> => {
  const snapshots = new Map<string, ThreadTagSnapshot>();
  const resolvedTimes = getResolvedTagTimes(events);

  aggregateThreadTagEvents(events).forEach((content, threadRootId) => {
    snapshots.set(threadRootId, buildThreadTagSnapshot(content, resolvedTimes.get(threadRootId)));
  });

  return snapshots;
};

// RoomState.getStateEvents() returns a new array per call, so the aggregation's
// array-identity cache never hits here. Each room state keeps its last snapshot
// map instead, reused while the same events and content objects come back. A
// redacted event always reads as empty content (a pending local redaction as a
// fresh `{}` per read), so it is compared by its redaction flag.
type RoomTagSnapshotSlot = {
  events: MatrixEvent[];
  contents: unknown[];
  snapshots: ReadonlyMap<string, ThreadTagSnapshot>;
};
const roomTagSnapshotSlots = new WeakMap<RoomState, RoomTagSnapshotSlot>();
const EMPTY_TAG_SNAPSHOTS: ReadonlyMap<string, ThreadTagSnapshot> = new Map();

const getTagEventContentKey = (event: MatrixEvent): unknown =>
  event.isRedacted() ? null : event.getContent();

const slotMatches = (slot: RoomTagSnapshotSlot, events: MatrixEvent[]): boolean =>
  slot.events.length === events.length &&
  events.every(
    (event, index) =>
      slot.events[index] === event && slot.contents[index] === getTagEventContentKey(event)
  );

/** Shared across calls while the room's tag state is unchanged; callers must not mutate it. */
export const getRoomThreadTagSnapshotMap = (room: Room): ReadonlyMap<string, ThreadTagSnapshot> => {
  const roomState = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  const stateEvents = roomState?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT);
  if (!roomState || !Array.isArray(stateEvents) || stateEvents.length === 0) {
    return EMPTY_TAG_SNAPSHOTS;
  }

  const slot = roomTagSnapshotSlots.get(roomState);
  if (slot && slotMatches(slot, stateEvents)) return slot.snapshots;

  const snapshots = buildThreadTagSnapshotMap(stateEvents);
  roomTagSnapshotSlots.set(roomState, {
    events: stateEvents,
    contents: stateEvents.map(getTagEventContentKey),
    snapshots,
  });
  return snapshots;
};
