import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { isCacheWritable, subscribeCacheReadOnly } from '../cache/cacheHealth';
import {
  captureCacheStoreWriteLease,
  hasUnsavedRoomCacheGap,
  isCacheStoreWriteLeaseCurrent,
  whenRoomCacheGapsSaved,
  type CacheStoreWriteLease,
} from '../cache/db';
import { persistRoomChunkWithPreferLive } from '../cache/eventRepository';

type PendingLiveWrite = {
  room: Room;
  events: MatrixEvent[];
  roomTailLoaded: boolean | undefined;
  threadId?: string;
  lease: CacheStoreWriteLease;
};

export type LiveWriteQueue = {
  enqueue(room: Room, events: MatrixEvent[], roomTailLoaded?: boolean, threadId?: string): void;
  drainNow(): void;
  clear(): void;
};

export const createLiveWriteQueue = ({
  mx,
  sessionId,
  onSaved,
}: {
  mx: MatrixClient;
  sessionId: string;
  onSaved?: (events: MatrixEvent[], roomId: string, lease: CacheStoreWriteLease) => void;
}): LiveWriteQueue => {
  const pending = new Map<string, PendingLiveWrite>();
  const waitingGapRooms = new Set<string>();
  let generation = 0;
  let drainScheduled = false;
  let draining = false;
  let unsubscribeReadOnly: (() => void) | undefined;

  const releaseReadOnlySubscription = () => {
    unsubscribeReadOnly?.();
    unsubscribeReadOnly = undefined;
  };

  const dropPending = () => {
    generation += 1;
    pending.clear();
    waitingGapRooms.clear();
    releaseReadOnlySubscription();
  };

  const scheduleDrain = () => {
    if (draining || drainScheduled || pending.size === 0) return;
    drainScheduled = true;
    const runGeneration = generation;
    queueMicrotask(() => {
      drainScheduled = false;
      if (runGeneration !== generation) return;
      void drain();
    });
  };

  const waitForRoomGap = (roomId: string) => {
    if (waitingGapRooms.has(roomId)) return;
    waitingGapRooms.add(roomId);
    const runGeneration = generation;
    void whenRoomCacheGapsSaved(sessionId, roomId).then(() => {
      if (runGeneration !== generation) return;
      waitingGapRooms.delete(roomId);
      if (findReadyBatch(false)) scheduleDrain();
    });
  };

  const findReadyBatch = (remove: boolean): PendingLiveWrite | undefined => {
    for (const [key, entry] of pending) {
      if (!isCacheStoreWriteLeaseCurrent(entry.lease)) {
        pending.delete(key);
        continue;
      }
      if (hasUnsavedRoomCacheGap(sessionId, entry.room.roomId)) {
        waitForRoomGap(entry.room.roomId);
        continue;
      }
      if (remove) pending.delete(key);
      return entry;
    }
    if (pending.size === 0) releaseReadOnlySubscription();
    return undefined;
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    drainScheduled = false;
    const runGeneration = generation;
    try {
      while (runGeneration === generation) {
        if (!isCacheWritable()) {
          dropPending();
          break;
        }
        const entry = findReadyBatch(true);
        if (!entry) break;
        try {
          const saved = await persistRoomChunkWithPreferLive({
            mx,
            sessionId,
            room: entry.room,
            chunk: entry.events.map((event) => event.event),
            mappedEvents: entry.events,
            roomTailLoaded: entry.roomTailLoaded ?? false,
            threadId: entry.threadId,
            writeLease: entry.lease,
          });
          if (saved && runGeneration === generation && isCacheStoreWriteLeaseCurrent(entry.lease)) {
            onSaved?.(saved.events, entry.room.roomId, entry.lease);
          }
        } catch {
          // A failed batch must not stall subsequent rooms in the serial drain.
        }
      }
    } finally {
      draining = false;
      if (!isCacheWritable()) {
        dropPending();
      } else if (findReadyBatch(false)) {
        scheduleDrain();
      } else if (pending.size === 0) {
        releaseReadOnlySubscription();
      }
    }
  };

  const enqueue = (
    room: Room,
    events: MatrixEvent[],
    roomTailLoaded?: boolean,
    threadId?: string
  ) => {
    if (events.length === 0) return;
    if (!isCacheWritable()) {
      dropPending();
      return;
    }
    unsubscribeReadOnly ??= subscribeCacheReadOnly(dropPending);
    const key = `${room.roomId}\0${threadId ?? ''}`;
    const existing = pending.get(key);
    if (existing && isCacheStoreWriteLeaseCurrent(existing.lease)) {
      existing.room = room;
      existing.events.push(...events);
      if (roomTailLoaded === true) existing.roomTailLoaded = true;
      else if (existing.roomTailLoaded === undefined) existing.roomTailLoaded = roomTailLoaded;
    } else {
      if (existing) pending.delete(key);
      pending.set(key, {
        room,
        events: [...events],
        roomTailLoaded,
        threadId,
        lease: captureCacheStoreWriteLease(sessionId, room.roomId),
      });
    }
    if (hasUnsavedRoomCacheGap(sessionId, room.roomId)) {
      waitForRoomGap(room.roomId);
    } else {
      scheduleDrain();
    }
  };

  const drainNow = () => {
    if (!isCacheWritable()) {
      dropPending();
      return;
    }
    if (findReadyBatch(false)) void drain();
  };

  return { enqueue, drainNow, clear: dropPending };
};
