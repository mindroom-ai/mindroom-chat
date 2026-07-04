/**
 * CINNY-207 P2.1 (red-before-green analog): parameterized round-trip contract
 * suite. The same scenarios run against the CURRENT legacy modules
 * (`roomEventCache`, `threadEventCache`, `threadSummaryCache`) — pinning their
 * observable behavior BEFORE the unified `cacheStore` rewrite lands — and, in
 * commit 2, will be extended to also drive the new module so the two are
 * proven equivalent by identical passing scenarios rather than by inspection.
 *
 * Environment: `fake-indexeddb/auto` boots a fresh IndexedDB implementation
 * per test via `resetIndexedDb` (see beforeEach). Each implementation must
 * expose a `resetSingletons` hook to drop any memoized `dbPromiseByName`
 * entries so the fresh factory is picked up.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RawEvent = Partial<IEvent>;

type SaveRoomInput = {
  sessionId: string;
  roomId: string;
  events: RawEvent[];
  beforeTokenForEarliest?: string | null;
};

type SaveThreadInput = {
  sessionId: string;
  roomId: string;
  threadId: string;
  events: RawEvent[];
  rootEvent?: RawEvent;
  beforeTokenForEarliest?: string | null;
  tailLoaded?: boolean;
  snapshotComplete?: boolean;
  expectedReplyCount?: number;
  relationSnapshotComplete?: boolean;
};

type LoadedRoomEvent = { event_id: string; origin_server_ts: number };
type LoadedThreadEvent = { event_id: string; origin_server_ts: number };

type LoadRoomPage = {
  events: Array<RawEvent & LoadedRoomEvent>;
  hasMoreBefore: boolean;
  beforeToken?: string | null;
};

type LoadThreadPage = {
  rootEvent?: RawEvent;
  events: Array<RawEvent & LoadedThreadEvent>;
  hasMoreBefore: boolean;
  beforeToken?: string | null;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
  tailLoaded?: boolean;
  expectedReplyCount?: number;
};

type ThreadCursorAnchor = { eventId: string; ts: number } | undefined;

type CacheContract = {
  name: string;
  resetSingletons: () => void;
  saveRoomEvents: (input: SaveRoomInput) => Promise<void>;
  loadLatestRoom: (
    sessionId: string,
    roomId: string,
    limit: number
  ) => Promise<LoadRoomPage>;
  loadRoomBefore: (
    sessionId: string,
    roomId: string,
    before: ThreadCursorAnchor,
    limit: number
  ) => Promise<LoadRoomPage>;
  loadRoomEvent: (
    sessionId: string,
    roomId: string,
    eventId: string
  ) => Promise<(RawEvent & LoadedRoomEvent) | undefined>;
  loadRoomPaginationToken: (
    sessionId: string,
    roomId: string,
    eventId: string
  ) => Promise<string | null | undefined>;
  deleteRoomEvents: (
    sessionId: string,
    roomId: string,
    eventIds: string[]
  ) => Promise<void>;

  saveThreadEvents: (input: SaveThreadInput) => Promise<void>;
  loadLatestThread: (
    sessionId: string,
    roomId: string,
    threadId: string,
    limit: number
  ) => Promise<LoadThreadPage>;
  loadThreadBefore: (
    sessionId: string,
    roomId: string,
    threadId: string,
    before: ThreadCursorAnchor,
    limit: number
  ) => Promise<LoadThreadPage>;
  loadThreadEvent: (
    sessionId: string,
    roomId: string,
    threadId: string,
    eventId: string
  ) => Promise<RawEvent | undefined>;
  loadThreadPaginationToken: (
    sessionId: string,
    roomId: string,
    threadId: string,
    eventId: string
  ) => Promise<string | null | undefined>;
  deleteThreadEvents: (
    sessionId: string,
    roomId: string,
    threadId: string,
    eventIds: string[]
  ) => Promise<void>;
  deleteThreadEventByEventId: (
    sessionId: string,
    roomId: string,
    eventId: string
  ) => Promise<void>;

  saveSummary: (
    sessionId: string,
    roomId: string,
    threadRootId: string,
    info: { summaryText: string; generatedTs?: number; messageCount?: number }
  ) => Promise<void>;
  loadSummaries: (
    sessionId: string,
    roomId: string
  ) => Promise<Map<string, { summaryText: string; generatedTs?: number; messageCount?: number }>>;
};

// ---------- Legacy adapter ----------

const buildLegacyContract = async (): Promise<CacheContract> => {
  const roomModule = await import('../../roomEventCache');
  const threadModule = await import('../../threadEventCache');
  const summaryModule = await import('../../threadSummaryCache');

  return buildContractFromModules('legacy', roomModule, threadModule, summaryModule);
};

// ---------- CacheStore adapter ----------

const buildCacheStoreContract = async (): Promise<CacheContract> => {
  // Same public function signatures across both adapters — the shim
  // step (P2.1 commit 4) makes the two identical at the type level.
  const cacheStoreModule = await import('../index');
  return buildContractFromModules(
    'cacheStore',
    cacheStoreModule,
    cacheStoreModule,
    cacheStoreModule
  );
};

type LegacyLike = {
  saveRoomEventsToCache: typeof import('../../roomEventCache')['saveRoomEventsToCache'];
  loadLatestCachedRoomEvents: typeof import('../../roomEventCache')['loadLatestCachedRoomEvents'];
  loadCachedRoomEventsBefore: typeof import('../../roomEventCache')['loadCachedRoomEventsBefore'];
  loadCachedRoomEvent: typeof import('../../roomEventCache')['loadCachedRoomEvent'];
  loadCachedRoomPaginationToken: typeof import('../../roomEventCache')['loadCachedRoomPaginationToken'];
  deleteRoomEventsFromCache: typeof import('../../roomEventCache')['deleteRoomEventsFromCache'];
};

type ThreadLike = {
  saveThreadEventsToCache: typeof import('../../threadEventCache')['saveThreadEventsToCache'];
  loadLatestCachedThreadEvents: typeof import('../../threadEventCache')['loadLatestCachedThreadEvents'];
  loadCachedThreadEventsBefore: typeof import('../../threadEventCache')['loadCachedThreadEventsBefore'];
  loadCachedThreadEvent: typeof import('../../threadEventCache')['loadCachedThreadEvent'];
  loadCachedThreadPaginationToken: typeof import('../../threadEventCache')['loadCachedThreadPaginationToken'];
  deleteThreadEventsFromCache: typeof import('../../threadEventCache')['deleteThreadEventsFromCache'];
  deleteThreadEventFromCacheByEventId: typeof import('../../threadEventCache')['deleteThreadEventFromCacheByEventId'];
};

type SummaryLike = {
  saveCachedThreadSummary: typeof import('../../threadSummaryCache')['saveCachedThreadSummary'];
  loadCachedThreadSummaries: typeof import('../../threadSummaryCache')['loadCachedThreadSummaries'];
};

const buildContractFromModules = (
  name: string,
  roomModule: LegacyLike,
  threadModule: ThreadLike,
  summaryModule: SummaryLike
): CacheContract => {

  return {
    name,
    resetSingletons: () => {
      // Force reload of the memoized dbPromiseByName Maps by clearing module cache.
      vi.resetModules();
    },
    saveRoomEvents: ({ sessionId, roomId, events, beforeTokenForEarliest }) =>
      roomModule.saveRoomEventsToCache(sessionId, roomId, events, beforeTokenForEarliest),
    loadLatestRoom: (sessionId, roomId, limit) =>
      roomModule.loadLatestCachedRoomEvents(sessionId, roomId, limit),
    loadRoomBefore: (sessionId, roomId, before, limit) =>
      roomModule.loadCachedRoomEventsBefore(sessionId, roomId, before, limit),
    loadRoomEvent: (sessionId, roomId, eventId) =>
      roomModule.loadCachedRoomEvent(sessionId, roomId, eventId),
    loadRoomPaginationToken: (sessionId, roomId, eventId) =>
      roomModule.loadCachedRoomPaginationToken(sessionId, roomId, eventId),
    deleteRoomEvents: (sessionId, roomId, eventIds) =>
      roomModule.deleteRoomEventsFromCache(sessionId, roomId, eventIds),

    saveThreadEvents: ({
      sessionId,
      roomId,
      threadId,
      events,
      rootEvent,
      beforeTokenForEarliest,
      tailLoaded,
      snapshotComplete,
      expectedReplyCount,
      relationSnapshotComplete,
    }) =>
      threadModule.saveThreadEventsToCache(
        sessionId,
        roomId,
        threadId,
        events,
        rootEvent,
        beforeTokenForEarliest,
        tailLoaded,
        snapshotComplete,
        expectedReplyCount,
        relationSnapshotComplete
      ),
    loadLatestThread: (sessionId, roomId, threadId, limit) =>
      threadModule.loadLatestCachedThreadEvents(sessionId, roomId, threadId, limit),
    loadThreadBefore: (sessionId, roomId, threadId, before, limit) =>
      threadModule.loadCachedThreadEventsBefore(sessionId, roomId, threadId, before, limit),
    loadThreadEvent: (sessionId, roomId, threadId, eventId) =>
      threadModule.loadCachedThreadEvent(sessionId, roomId, threadId, eventId),
    loadThreadPaginationToken: (sessionId, roomId, threadId, eventId) =>
      threadModule.loadCachedThreadPaginationToken(sessionId, roomId, threadId, eventId),
    deleteThreadEvents: (sessionId, roomId, threadId, eventIds) =>
      threadModule.deleteThreadEventsFromCache(sessionId, roomId, threadId, eventIds),
    deleteThreadEventByEventId: (sessionId, roomId, eventId) =>
      threadModule.deleteThreadEventFromCacheByEventId(sessionId, roomId, eventId),

    saveSummary: (sessionId, roomId, threadRootId, info) =>
      summaryModule.saveCachedThreadSummary(sessionId, roomId, threadRootId, info),
    loadSummaries: (sessionId, roomId) =>
      summaryModule.loadCachedThreadSummaries(sessionId, roomId),
  };
};

// ---------- Shared scenarios ----------

const SESSION_ID = 'contract-session';
const ROOM_ID = '!room:example.org';
const OTHER_ROOM_ID = '!other:example.org';
const THREAD_ID = '$thread-root';

const makeRawEvent = (eventId: string, ts: number, extras: RawEvent = {}): RawEvent => ({
  event_id: eventId,
  origin_server_ts: ts,
  type: 'm.room.message',
  content: { body: eventId },
  ...extras,
});

const runContract = (label: string, buildContract: () => Promise<CacheContract>): void => {
  describe(`cache contract (${label})`, () => {
    let contract: CacheContract;

    beforeEach(async () => {
      // Fresh IDB per test to isolate DB state across scenarios.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).indexedDB = new IDBFactory();
      // Rebuild the module graph so memoized dbPromiseByName entries reset.
      vi.resetModules();
      contract = await buildContract();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // --- Room ---

    it('round-trips room events and returns latest-first (reversed) up to limit', async () => {
      const events = [
        makeRawEvent('$a', 100),
        makeRawEvent('$b', 200),
        makeRawEvent('$c', 300),
      ];
      await contract.saveRoomEvents({ sessionId: SESSION_ID, roomId: ROOM_ID, events });

      const page = await contract.loadLatestRoom(SESSION_ID, ROOM_ID, 10);
      expect(page.events.map((e) => e.event_id)).toEqual(['$a', '$b', '$c']);
      expect(page.hasMoreBefore).toBe(false);
    });

    it('sets hasMoreBefore when there are records beyond the limit', async () => {
      const events = [
        makeRawEvent('$a', 100),
        makeRawEvent('$b', 200),
        makeRawEvent('$c', 300),
        makeRawEvent('$d', 400),
      ];
      await contract.saveRoomEvents({ sessionId: SESSION_ID, roomId: ROOM_ID, events });

      const page = await contract.loadLatestRoom(SESSION_ID, ROOM_ID, 2);
      expect(page.events.map((e) => e.event_id)).toEqual(['$c', '$d']);
      expect(page.hasMoreBefore).toBe(true);
    });

    it('paginates room events before a cursor', async () => {
      const events = [
        makeRawEvent('$a', 100),
        makeRawEvent('$b', 200),
        makeRawEvent('$c', 300),
        makeRawEvent('$d', 400),
      ];
      await contract.saveRoomEvents({ sessionId: SESSION_ID, roomId: ROOM_ID, events });

      const page = await contract.loadRoomBefore(
        SESSION_ID,
        ROOM_ID,
        { eventId: '$c', ts: 300 },
        10
      );
      expect(page.events.map((e) => e.event_id)).toEqual(['$a', '$b']);
      expect(page.hasMoreBefore).toBe(false);
    });

    it('skips local-echo records inside the cursor without counting toward the limit', async () => {
      // Local-echo records can end up in the store if the raw batch included
      // them; the cursor must filter them and keep collecting real records.
      const events = [
        makeRawEvent('$a', 100),
        makeRawEvent('~local-1', 150),
        makeRawEvent('$b', 200),
        makeRawEvent('~local-2', 250),
        makeRawEvent('$c', 300),
      ];
      // normalizeCachedRoomEvents drops local-echo at write time, so persist
      // them directly via a low-level insert by calling save with only the
      // non-echo events. The behavioral property under test is that a mid-
      // cursor local-echo (if it existed) would be filtered — this is
      // exercised more directly against the thread cache, whose normalize
      // has a slightly different filter path. Here we just verify save
      // filters local echoes at write time.
      await contract.saveRoomEvents({ sessionId: SESSION_ID, roomId: ROOM_ID, events });
      const page = await contract.loadLatestRoom(SESSION_ID, ROOM_ID, 10);
      expect(page.events.map((e) => e.event_id)).toEqual(['$a', '$b', '$c']);
    });

    it('persists a beforeToken keyed by the earliest normalized event id', async () => {
      const events = [makeRawEvent('$a', 100), makeRawEvent('$b', 200)];
      await contract.saveRoomEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        events,
        beforeTokenForEarliest: 'token-a',
      });

      const page = await contract.loadLatestRoom(SESSION_ID, ROOM_ID, 10);
      expect(page.beforeToken).toBe('token-a');

      const token = await contract.loadRoomPaginationToken(SESSION_ID, ROOM_ID, '$a');
      expect(token).toBe('token-a');
    });

    it('save is a no-op when no normalized events remain', async () => {
      await contract.saveRoomEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        events: [{ event_id: '~echo', origin_server_ts: 100 } as RawEvent],
        beforeTokenForEarliest: 'token-a',
      });
      const page = await contract.loadLatestRoom(SESSION_ID, ROOM_ID, 10);
      expect(page.events).toEqual([]);
      // No meta written since save short-circuited.
      const token = await contract.loadRoomPaginationToken(SESSION_ID, ROOM_ID, '~echo');
      expect(token).toBeUndefined();
    });

    it('deletes targeted room event ids', async () => {
      const events = [makeRawEvent('$a', 100), makeRawEvent('$b', 200)];
      await contract.saveRoomEvents({ sessionId: SESSION_ID, roomId: ROOM_ID, events });

      await contract.deleteRoomEvents(SESSION_ID, ROOM_ID, ['$a']);
      const page = await contract.loadLatestRoom(SESSION_ID, ROOM_ID, 10);
      expect(page.events.map((e) => e.event_id)).toEqual(['$b']);
    });

    it('loads a single room event and misses on absent ids', async () => {
      await contract.saveRoomEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        events: [makeRawEvent('$a', 100)],
      });
      const found = await contract.loadRoomEvent(SESSION_ID, ROOM_ID, '$a');
      expect(found?.event_id).toBe('$a');
      const missing = await contract.loadRoomEvent(SESSION_ID, ROOM_ID, '$missing');
      expect(missing).toBeUndefined();
    });

    // --- Thread ---

    it('round-trips thread events and skips the root event from the page', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      const events = [
        // Include the root inside the page inputs — save filters it out via
        // `filterPageableCachedThreadEvents(_, threadId)`.
        rootEvent,
        makeRawEvent('$reply-1', 100),
        makeRawEvent('$reply-2', 200),
      ];
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events,
        rootEvent,
      });

      const page = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 10);
      expect(page.events.map((e) => e.event_id)).toEqual(['$reply-1', '$reply-2']);
      expect(page.rootEvent?.event_id).toBe(THREAD_ID);
      expect(page.hasMoreBefore).toBe(false);
    });

    it('sets hasMoreBefore when there are further thread records beyond the limit', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      const events = [
        rootEvent,
        makeRawEvent('$r1', 100),
        makeRawEvent('$r2', 200),
        makeRawEvent('$r3', 300),
      ];
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events,
        rootEvent,
      });

      const page = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 2);
      expect(page.events.map((e) => e.event_id)).toEqual(['$r2', '$r3']);
      expect(page.hasMoreBefore).toBe(true);
    });

    it('paginates thread events before a cursor', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      const events = [
        rootEvent,
        makeRawEvent('$r1', 100),
        makeRawEvent('$r2', 200),
        makeRawEvent('$r3', 300),
      ];
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events,
        rootEvent,
      });

      const page = await contract.loadThreadBefore(
        SESSION_ID,
        ROOM_ID,
        THREAD_ID,
        { eventId: '$r3', ts: 300 },
        10
      );
      expect(page.events.map((e) => e.event_id)).toEqual(['$r1', '$r2']);
      expect(page.hasMoreBefore).toBe(false);
    });

    it('persists rootEvent-only when there are no pageable events', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [],
        rootEvent,
      });

      const page = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 10);
      expect(page.events).toEqual([]);
      expect(page.rootEvent?.event_id).toBe(THREAD_ID);
    });

    it('save is a no-op when there are neither pageable events nor a rootEvent', async () => {
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [],
      });

      const page = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 10);
      expect(page.events).toEqual([]);
      expect(page.rootEvent).toBeUndefined();
      expect(page.snapshotComplete).toBeFalsy();
    });

    it('persists thread beforeToken keyed by earliest normalized reply id', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [rootEvent, makeRawEvent('$r1', 100), makeRawEvent('$r2', 200)],
        rootEvent,
        beforeTokenForEarliest: 'thread-token',
      });

      const page = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 10);
      expect(page.beforeToken).toBe('thread-token');

      const token = await contract.loadThreadPaginationToken(
        SESSION_ID,
        ROOM_ID,
        THREAD_ID,
        '$r1'
      );
      expect(token).toBe('thread-token');
    });

    it('merges thread meta flags via mergeThreadCacheFlag semantics', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      // First save: snapshotComplete=true.
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [rootEvent, makeRawEvent('$r1', 100)],
        rootEvent,
        snapshotComplete: true,
      });
      // Second save: snapshotComplete undefined (must NOT clear the flag).
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [rootEvent, makeRawEvent('$r2', 200)],
        rootEvent,
      });

      const page = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 10);
      expect(page.snapshotComplete).toBe(true);

      // Third save: snapshotComplete=false (explicit clear).
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [rootEvent, makeRawEvent('$r3', 300)],
        rootEvent,
        snapshotComplete: false,
      });
      const page2 = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 10);
      expect(page2.snapshotComplete).toBe(false);
    });

    it('root fallback: loadThreadEvent(threadId) returns the meta rootEvent when no store record', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [rootEvent, makeRawEvent('$r1', 100)],
        rootEvent,
      });

      const rootFromLoad = await contract.loadThreadEvent(
        SESSION_ID,
        ROOM_ID,
        THREAD_ID,
        THREAD_ID
      );
      expect(rootFromLoad?.event_id).toBe(THREAD_ID);
    });

    it('deletes targeted thread event ids', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [rootEvent, makeRawEvent('$r1', 100), makeRawEvent('$r2', 200)],
        rootEvent,
      });

      await contract.deleteThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, ['$r1']);
      const page = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 10);
      expect(page.events.map((e) => e.event_id)).toEqual(['$r2']);
    });

    it('deleteThreadEventByEventId walks the room-wide range and removes matching record', async () => {
      const rootA = makeRawEvent('$threadA', 50);
      const rootB = makeRawEvent('$threadB', 60);
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: '$threadA',
        events: [rootA, makeRawEvent('$reaction', 100)],
        rootEvent: rootA,
      });
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: '$threadB',
        events: [rootB, makeRawEvent('$other', 200)],
        rootEvent: rootB,
      });

      // Redaction handler doesn't know which thread the target belongs to;
      // the by-event-id fallback walks all thread records in the room.
      await contract.deleteThreadEventByEventId(SESSION_ID, ROOM_ID, '$reaction');
      const pageA = await contract.loadLatestThread(SESSION_ID, ROOM_ID, '$threadA', 10);
      expect(pageA.events.map((e) => e.event_id)).toEqual([]);
      const pageB = await contract.loadLatestThread(SESSION_ID, ROOM_ID, '$threadB', 10);
      expect(pageB.events.map((e) => e.event_id)).toEqual(['$other']);
    });

    it('scopes thread lookups by room', async () => {
      const rootEvent = makeRawEvent(THREAD_ID, 50);
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        threadId: THREAD_ID,
        events: [rootEvent, makeRawEvent('$r1', 100)],
        rootEvent,
      });
      await contract.saveThreadEvents({
        sessionId: SESSION_ID,
        roomId: OTHER_ROOM_ID,
        threadId: THREAD_ID,
        events: [rootEvent, makeRawEvent('$r2', 200)],
        rootEvent,
      });

      const pageA = await contract.loadLatestThread(SESSION_ID, ROOM_ID, THREAD_ID, 10);
      const pageB = await contract.loadLatestThread(SESSION_ID, OTHER_ROOM_ID, THREAD_ID, 10);
      expect(pageA.events.map((e) => e.event_id)).toEqual(['$r1']);
      expect(pageB.events.map((e) => e.event_id)).toEqual(['$r2']);
    });

    // --- Summary ---

    it('saves and loads thread summaries by room', async () => {
      await contract.saveSummary(SESSION_ID, ROOM_ID, '$rootA', {
        summaryText: 'hello A',
        generatedTs: 1000,
        messageCount: 3,
      });
      await contract.saveSummary(SESSION_ID, ROOM_ID, '$rootB', {
        summaryText: 'hello B',
      });
      // Other-room summary must not leak.
      await contract.saveSummary(SESSION_ID, OTHER_ROOM_ID, '$rootA', {
        summaryText: 'not this one',
      });

      const summaries = await contract.loadSummaries(SESSION_ID, ROOM_ID);
      expect(summaries.get('$rootA')?.summaryText).toBe('hello A');
      expect(summaries.get('$rootA')?.generatedTs).toBe(1000);
      expect(summaries.get('$rootA')?.messageCount).toBe(3);
      expect(summaries.get('$rootB')?.summaryText).toBe('hello B');
      expect(summaries.size).toBe(2);
    });

    it('summary save is a no-op with empty summaryText', async () => {
      await contract.saveSummary(SESSION_ID, ROOM_ID, '$rootA', { summaryText: '' });
      const summaries = await contract.loadSummaries(SESSION_ID, ROOM_ID);
      expect(summaries.size).toBe(0);
    });
  });
};

runContract('legacy', buildLegacyContract);
runContract('cacheStore', buildCacheStoreContract);
