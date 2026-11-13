/**
 * Engine-owned room/thread persistence. Async fetch owners capture forRoom()
 * before starting work; its shared CacheStore lease fences writes after clear.
 * Direct room persistence also projects thread replies, avoiding a second
 * writer attached to SDK pagination emissions.
 */

import { type MatrixEvent, type Room } from 'matrix-js-sdk';
import { captureCacheStoreWriteLease, isCacheStoreWriteLeaseCurrent } from '../cache/db';
import {
  rememberEventCacheWriteLease,
  persistRoomEventCacheSnapshot,
  persistThreadCacheFromRoomEventsSnapshot,
  persistThreadEventCacheSnapshot,
} from '../cache/eventRepository';

/**
 * Explicit thread-event persistence: takes the thread id, the events
 * to persist, and optional metadata that flows into the cache record
 * (`rootEvent`, `beforeTokenForEarliest`, `tailLoaded`,
 * `snapshotComplete`, `expectedReplyCount`,
 * `relationSnapshotComplete`). Matches the pre-strip
 * `PersistThreadEventCache` signature.
 */
export type PersistThreadEventCache = (
  expectedThreadId: string,
  events: MatrixEvent[],
  rootEvent?: MatrixEvent | null,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean
) => void;

/**
 * Explicit room-event persistence: takes the events to persist plus
 * an optional `beforeTokenForEarliest` proof. Matches the pre-strip
 * `PersistRoomEventCache` signature.
 */
export type PersistRoomEventCache = (
  events: MatrixEvent[],
  beforeTokenForEarliest?: string | null
) => void;

export type EnginePersistFacade = {
  persistRoomEventCache(
    room: Room,
    events: MatrixEvent[],
    beforeTokenForEarliest?: string | null
  ): void;
  persistThreadEventCache(
    room: Room,
    expectedThreadId: string,
    events: MatrixEvent[],
    rootEvent?: MatrixEvent | null,
    beforeTokenForEarliest?: string | null,
    tailLoaded?: boolean,
    snapshotComplete?: boolean,
    expectedReplyCount?: number,
    relationSnapshotComplete?: boolean
  ): void;
  /**
   * Bind the facade to a specific room, returning fn shapes the fetch
   * controllers already consume (`PersistRoomEventCache`,
   * `PersistThreadEventCache`), for an owner that knows its room
   * before async work starts.
   */
  forRoom(room: Room): {
    isCurrent(): boolean;
    persistRoomEventCache: PersistRoomEventCache;
    persistThreadEventCache: PersistThreadEventCache;
  };
};

export type CreateEnginePersistFacadeOptions = {
  sessionId: string;
};

export const createEnginePersistFacade = (
  options: CreateEnginePersistFacadeOptions
): EnginePersistFacade => {
  const { sessionId } = options;

  const persistRoomEventCache: EnginePersistFacade['persistRoomEventCache'] = (
    room,
    events,
    beforeTokenForEarliest
  ) => {
    const lease = captureCacheStoreWriteLease(sessionId, room.roomId);
    events.forEach((event) => rememberEventCacheWriteLease(event, lease));
    // Room pagination can include thread replies; the same operation owns both writes.
    persistThreadCacheFromRoomEventsSnapshot({ sessionId, room, events });
    persistRoomEventCacheSnapshot({
      sessionId,
      room,
      events,
      beforeTokenForEarliest,
    });
  };

  const persistThreadEventCache: EnginePersistFacade['persistThreadEventCache'] = (
    room,
    expectedThreadId,
    events,
    rootEvent,
    beforeTokenForEarliest,
    tailLoaded,
    snapshotComplete,
    expectedReplyCount,
    relationSnapshotComplete
  ) => {
    const lease = captureCacheStoreWriteLease(sessionId, room.roomId);
    events.forEach((event) => rememberEventCacheWriteLease(event, lease));
    persistThreadEventCacheSnapshot({
      sessionId,
      room,
      threadId: expectedThreadId,
      events,
      rootEvent,
      beforeTokenForEarliest,
      tailLoaded,
      snapshotComplete,
      expectedReplyCount,
      relationSnapshotComplete,
    });
  };

  const forRoom: EnginePersistFacade['forRoom'] = (room) => {
    const lease = captureCacheStoreWriteLease(sessionId, room.roomId);
    return {
      isCurrent: () => isCacheStoreWriteLeaseCurrent(lease),
      persistRoomEventCache: (events, beforeTokenForEarliest) =>
        isCacheStoreWriteLeaseCurrent(lease) &&
        persistRoomEventCache(room, events, beforeTokenForEarliest),
      persistThreadEventCache: (
        expectedThreadId,
        events,
        rootEvent,
        beforeTokenForEarliest,
        tailLoaded,
        snapshotComplete,
        expectedReplyCount,
        relationSnapshotComplete
      ) =>
        isCacheStoreWriteLeaseCurrent(lease) &&
        persistThreadEventCache(
          room,
          expectedThreadId,
          events,
          rootEvent,
          beforeTokenForEarliest,
          tailLoaded,
          snapshotComplete,
          expectedReplyCount,
          relationSnapshotComplete
        ),
    };
  };

  return {
    persistRoomEventCache,
    persistThreadEventCache,
    forRoom,
  };
};
