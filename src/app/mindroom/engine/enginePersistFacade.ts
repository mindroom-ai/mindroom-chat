/**
 * CINNY-207 P3.3: engine persist facade.
 *
 * The three functions the pre-strip `threadCachePersistenceController`
 * used to expose (`persistThreadEventCache`,
 * `persistThreadCacheFromRoomEvents`, `queueRoomThreadCachePersist`)
 * live here now as engine-side pure functions. Signatures are
 * preserved so the eight fetch controllers that consumed them are
 * rewired without prop-shape changes — the component just reads
 * `engine.persist.*` and hands the fns down.
 *
 * The pre-strip controller's staleness guards
 * (`alive()`/`roomIdRef`/`threadIdRef`) drop here: the engine is a
 * client-level singleton that is never stale, and every persist call
 * takes an explicit `room` argument, so a stale UI cannot accidentally
 * mis-route a write to a room that unmounted.
 */

import { type MatrixEvent, type Room } from 'matrix-js-sdk';
import {
  persistRoomEventCacheSnapshot,
  persistThreadCacheFromRoomEventsSnapshot,
  persistThreadEventCacheSnapshot,
} from '../threads/eventRepository';

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

/**
 * Room-derived thread persistence: given room events, groups them by
 * thread attribution and writes each group. Matches the pre-strip
 * `persistThreadCacheFromRoomEvents` signature.
 */
export type PersistThreadCacheFromRoomEvents = (
  events: MatrixEvent[],
  opts?: {
    beforeTokenForEarliest?: string | null;
    roomStartKnown?: boolean;
    roomTailLoaded?: boolean;
    snapshotComplete?: boolean;
    tailLoaded?: boolean;
  }
) => void;

/**
 * Microtask-batched room-derived thread persistence for events
 * arriving off the room live timeline (paginated appends). Preserves
 * the pre-strip `queueRoomThreadCachePersist` semantics: single
 * flush per microtask boundary.
 */
export type QueueRoomThreadCachePersist = (mEvent: MatrixEvent) => void;

export type EnginePersistFacade = {
  persistRoomEventCache(room: Room, events: MatrixEvent[], beforeTokenForEarliest?: string | null): void;
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
  persistThreadCacheFromRoomEvents(
    room: Room,
    events: MatrixEvent[],
    opts?: {
      beforeTokenForEarliest?: string | null;
      roomStartKnown?: boolean;
      roomTailLoaded?: boolean;
      snapshotComplete?: boolean;
      tailLoaded?: boolean;
    }
  ): void;
  queueRoomThreadCachePersist(room: Room, mEvent: MatrixEvent): void;
  /**
   * Bind the facade to a specific room, returning fn shapes the fetch
   * controllers already consume (`PersistRoomEventCache`,
   * `PersistThreadEventCache`, `PersistThreadCacheFromRoomEvents`,
   * `QueueRoomThreadCachePersist`). Convenience for the
   * MindroomRoomTimeline wiring which knows the mounted room.
   */
  forRoom(room: Room): {
    persistRoomEventCache: PersistRoomEventCache;
    persistThreadEventCache: PersistThreadEventCache;
    persistThreadCacheFromRoomEvents: PersistThreadCacheFromRoomEvents;
    queueRoomThreadCachePersist: QueueRoomThreadCachePersist;
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

  const persistThreadCacheFromRoomEvents: EnginePersistFacade['persistThreadCacheFromRoomEvents'] = (
    room,
    events,
    opts
  ) => {
    persistThreadCacheFromRoomEventsSnapshot({
      sessionId,
      room,
      events,
      opts,
    });
  };

  // Microtask-batched queue: preserves the pre-strip
  // `queueRoomThreadCachePersist` semantics. Buffer is per-room (one
  // pending set + one queued microtask per roomId) so unrelated rooms
  // do not interfere with each other's batching.
  type RoomQueueState = {
    events: MatrixEvent[];
    flushQueued: boolean;
  };
  const roomQueues = new Map<string, RoomQueueState>();

  const queueRoomThreadCachePersist: EnginePersistFacade['queueRoomThreadCachePersist'] = (
    room,
    mEvent
  ) => {
    const existing = roomQueues.get(room.roomId);
    const state: RoomQueueState = existing ?? { events: [], flushQueued: false };
    state.events.push(mEvent);
    if (!existing) roomQueues.set(room.roomId, state);
    if (state.flushQueued) return;
    state.flushQueued = true;
    queueMicrotask(() => {
      state.flushQueued = false;
      const queuedEvents = state.events;
      state.events = [];
      if (queuedEvents.length === 0) return;
      persistThreadCacheFromRoomEvents(room, queuedEvents);
    });
  };

  const forRoom: EnginePersistFacade['forRoom'] = (room) => ({
    persistRoomEventCache: (events, beforeTokenForEarliest) =>
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
    persistThreadCacheFromRoomEvents: (events, opts) =>
      persistThreadCacheFromRoomEvents(room, events, opts),
    queueRoomThreadCachePersist: (mEvent) => queueRoomThreadCachePersist(room, mEvent),
  });

  return {
    persistRoomEventCache,
    persistThreadEventCache,
    persistThreadCacheFromRoomEvents,
    queueRoomThreadCachePersist,
    forRoom,
  };
};
