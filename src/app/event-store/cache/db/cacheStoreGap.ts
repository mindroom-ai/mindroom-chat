import { loadRoomTailDiscontinuity } from './cacheStoreDiscontinuity';
import { CacheStoreMetaUnavailableError } from './cacheStoreMeta';

/**
 * A hole in a room's cached history. A limited sync skipped events the cache does not hold yet:
 * the cache keeps the room's events from before the hole and runs of events after it, but it
 * cannot tell where those runs join, so only the server can page across the hole. The hole
 * closes when the gap fill reaches the events from before it.
 */
export type RoomCacheGap = {
  /** The room's newest cached events when the hole opened; the cache is whole up to these. */
  beforeGapEventIds: ReadonlySet<string>;
};

const UNKNOWN_SIDE: RoomCacheGap = { beforeGapEventIds: new Set() };

type UnsavedGaps = { count: number; saved: Promise<void>; markSaved: () => void };

/** Holes seen in this session whose durable marker is not saved yet, by session and room. */
const unsavedGaps = new Map<string, UnsavedGaps>();
const gapKey = (sessionId: string, roomId: string) => `${sessionId}\n${roomId}`;

/**
 * Records a hole from the moment the limited sync arrives, before its durable marker is saved, so
 * no reader takes the cache across it and no room event is saved before the marker meanwhile.
 * Returns the release, for when the marker is saved or the hole's tracker stops.
 */
export const holdUnsavedRoomCacheGap = (sessionId: string, roomId: string): (() => void) => {
  const key = gapKey(sessionId, roomId);
  let gaps = unsavedGaps.get(key);
  if (!gaps) {
    let markSaved: () => void = () => undefined;
    const saved = new Promise<void>((resolve) => {
      markSaved = resolve;
    });
    gaps = { count: 0, saved, markSaved };
    unsavedGaps.set(key, gaps);
  }
  gaps.count += 1;
  const held = gaps;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.count -= 1;
    if (held.count > 0) return;
    if (unsavedGaps.get(key) === held) unsavedGaps.delete(key);
    held.markSaved();
  };
};

/**
 * Resolves once every hole of the room seen so far has its durable marker. A room event saved
 * before that could outlive a page that closes before the marker is saved, and the next visit
 * would take the events around the hole as one run.
 */
export const whenRoomCacheGapsSaved = (sessionId: string, roomId: string): Promise<void> =>
  unsavedGaps.get(gapKey(sessionId, roomId))?.saved ?? Promise.resolve();

/**
 * The room's open hole, or undefined when its cached history has none. Without IndexedDB there is
 * no cache, so no hole; a marker that cannot be read counts as a hole whose sides are unknown.
 */
export const loadRoomCacheGap = async (
  sessionId: string,
  roomId: string,
  loadMarker: typeof loadRoomTailDiscontinuity = loadRoomTailDiscontinuity
): Promise<RoomCacheGap | undefined> => {
  if (unsavedGaps.has(gapKey(sessionId, roomId))) return UNKNOWN_SIDE;
  try {
    const marker = await loadMarker(sessionId, roomId);
    if (!marker) return undefined;
    return { beforeGapEventIds: new Set(marker.overlapEventIds ?? []) };
  } catch (error) {
    return error instanceof CacheStoreMetaUnavailableError ? undefined : UNKNOWN_SIDE;
  }
};

/**
 * Whether the cached events just older than `eventId` join it: the cache has no hole, or
 * `eventId` is one of the events from before the hole.
 */
export const cachedHistoryJoinsBefore = (
  gap: RoomCacheGap | undefined,
  eventId: string | undefined
): boolean => !gap || (!!eventId && gap.beforeGapEventIds.has(eventId));
