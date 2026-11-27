import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { isCacheWritable } from '../cache/cacheHealth';
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
  disable(): void;
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
  let disabled = false;

  const dropPending = () => {
    generation += 1;
    pending.clear();
    waitingGapRooms.clear();
  };

  const disable = () => {
    disabled = true;
    dropPending();
  };

  const scheduleDrain = () => {
    if (disabled || draining || drainScheduled || pending.size === 0) return;
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      if (!disabled && pending.size > 0) void drain();
    });
  };

  const waitForRoomGap = (roomId: string) => {
    if (waitingGapRooms.has(roomId)) return;
    waitingGapRooms.add(roomId);
    const runGeneration = generation;
    void whenRoomCacheGapsSaved(sessionId, roomId).then(() => {
      if (runGeneration !== generation || disabled) return;
      waitingGapRooms.delete(roomId);
      scheduleDrain();
    });
  };

  const takeNextReadyBatch = (): PendingLiveWrite | undefined => {
    for (const [key, entry] of pending) {
      if (!isCacheStoreWriteLeaseCurrent(entry.lease)) {
        pending.delete(key);
        continue;
      }
      if (hasUnsavedRoomCacheGap(sessionId, entry.room.roomId)) {
        waitForRoomGap(entry.room.roomId);
        continue;
      }
      pending.delete(key);
      return entry;
    }
    return undefined;
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    drainScheduled = false;
    const runGeneration = generation;
    try {
      while (runGeneration === generation) {
        if (disabled || !isCacheWritable()) {
          dropPending();
          break;
        }
        const entry = takeNextReadyBatch();
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
      if (disabled || !isCacheWritable()) {
        dropPending();
      } else if (runGeneration !== generation && pending.size > 0) {
        scheduleDrain();
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
    if (disabled || !isCacheWritable()) {
      dropPending();
      return;
    }
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
    if (disabled || !isCacheWritable()) {
      dropPending();
      return;
    }
    if (pending.size > 0) void drain();
  };

  return { enqueue, drainNow, clear: dropPending, disable };
};
