// @vitest-environment jsdom

import React, { useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Shrink the compaction debounce so the coalescing tests run in real time.
// The behavior under test is interval-independent (trailing debounce with
// per-target keying). The real 1 s window would just slow tests down.
vi.mock('./preloadSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./preloadSettings')>()),
  THREAD_EDIT_COMPACTION_DEBOUNCE_MS: 25,
}));

// Stub out helpers pulled into the controller graph that require rich
// timeline machinery we do not care about here. This lets us focus on the
// compaction wiring in isolation.
vi.mock('./threadCollapsibleMessages', () => ({
  getLiveCollapsibleMessageExpandId: () => undefined,
}));
vi.mock('./roomLocalEchoRefresh', () => ({
  useRoomLocalEchoRefresh: () => undefined,
}));
vi.mock('./roomTimelineEvents', () => ({
  isRenderableEvent: () => false,
}));
vi.mock('./threadRenderUtils', () => ({
  isThreadOnlyRoomActivity: () => false,
}));
vi.mock('./timelinePagination', () => ({
  getRoomUnreadInfo: () => undefined,
}));
vi.mock('./timelineScrollUtils', () => ({
  isScrollNearBottom: () => false,
  shouldAutoScrollRoomOnLiveEvent: () => false,
  shouldAutoScrollThreadOnLiveEvent: () => false,
}));
vi.mock('./compactThreadRootData', () => ({
  isZeroReplyStandaloneThreadRootEvent: () => false,
}));
vi.mock('./notifications/readReceipts', () => ({
  markMainTimelineAsRead: () => undefined,
}));
vi.mock('../messages/threadSummary', () => ({
  getLatestThreadSummaryInfoFromEventSources: () => undefined,
  isMindroomThreadSummaryEvent: () => false,
}));
vi.mock('../notifications/readReceipts', () => ({
  markMainTimelineAsRead: () => undefined,
}));
vi.mock('./threadUtils', () => ({
  eventBelongsToThread: (mEvt: { threadRootId?: string }, threadId: string) =>
    !!threadId && mEvt.threadRootId === threadId,
}));
vi.mock('./eventRepository', () => ({
  deleteRoomEventsFromCache: vi.fn(),
  deleteThreadEventFromCacheByEventId: vi.fn(),
  deleteThreadEventsFromCache: vi.fn(),
  getThreadCacheTargetId: (_room: unknown, mEvt: { threadRootId?: string }) =>
    mEvt.threadRootId,
}));
vi.mock('./redactionCacheLifecycle', () => ({
  planRedactionCacheCleanup: () => undefined,
  removeAggregatedReactionByEventId: () => undefined,
}));
vi.mock('./timelineDebug', () => ({
  logTimelineDebug: () => undefined,
}));

import { useRoomLiveEventController } from './roomLiveEventController';
import { THREAD_EDIT_COMPACTION_DEBOUNCE_MS } from './preloadSettings';

type FakeEvent = {
  __id: string;
  __threadRootId?: string;
  __relation?: { rel_type?: string; event_id?: string };
  __sender: string;
  __isSending: boolean;
  __isRedaction: boolean;
  getId: () => string;
  getRelation: () => { rel_type?: string; event_id?: string } | undefined;
  getAssociatedId: () => string | undefined;
  getSender: () => string;
  getType: () => string;
  getContent: () => Record<string, unknown>;
  getRoomId: () => string;
  getTs: () => number;
  isRedaction: () => boolean;
  isSending: () => boolean;
  threadRootId?: string;
};

const makeEvent = (
  eventId: string,
  {
    threadRootId,
    relation,
    sender = '@alice:example.org',
    isSending = false,
    isRedaction = false,
  }: {
    threadRootId?: string;
    relation?: { rel_type?: string; event_id?: string };
    sender?: string;
    isSending?: boolean;
    isRedaction?: boolean;
  } = {}
): FakeEvent => ({
  __id: eventId,
  __threadRootId: threadRootId,
  __relation: relation,
  __sender: sender,
  __isSending: isSending,
  __isRedaction: isRedaction,
  getId: () => eventId,
  getRelation: () => relation,
  getAssociatedId: () => relation?.event_id,
  getSender: () => sender,
  getType: () => 'm.room.message',
  getContent: () => ({}),
  getRoomId: () => '!room:example.org',
  getTs: () => 0,
  isRedaction: () => isRedaction,
  isSending: () => isSending,
  threadRootId,
});

type Listener = (...args: unknown[]) => void;

const makeRoom = (findEventById: (id: string) => FakeEvent | undefined) => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    roomId: '!room:example.org',
    on: (event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    },
    findEventById,
    getThread: () => null,
    getLiveTimeline: () => ({ getEvents: () => [] }),
    getUnfilteredTimelineSet: () => undefined,
    __listeners: listeners,
  };
};

type Harness = {
  fireLive: (mEvt: FakeEvent) => void;
  persistThreadEventCache: ReturnType<typeof vi.fn>;
  persistRoomEventCache: ReturnType<typeof vi.fn>;
  persistThreadCacheFromRoomEvents: ReturnType<typeof vi.fn>;
  unmount: () => void;
};

const createHarness = ({
  threadId,
  findEventById = () => undefined,
}: {
  threadId?: string;
  findEventById?: (id: string) => FakeEvent | undefined;
} = {}): { renderer: ReactTestRenderer; harness: Harness } => {
  const room = makeRoom(findEventById);

  const persistThreadEventCache = vi.fn();
  const persistRoomEventCache = vi.fn();
  const persistThreadCacheFromRoomEvents = vi.fn();
  const queueRoomThreadCachePersist = vi.fn();

  const Harness = () => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const atBottomRef = useRef(true);
    const atLiveEndRef = useRef(true);
    const liveExpandOnceIds = useRef(new Set<string>());
    const threadEventIndexMapRef = useRef<Map<string, number>>(new Map());
    const scrollToBottomRef = useRef({ count: 0, smooth: false });

    useRoomLiveEventController({
      atBottomRef,
      atLiveEndRef,
      effectiveThreadFilterState: { tags: new Map() } as never,
      hideActivity: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      ignoredUsersSet: new Set<string>(),
      liveExpandOnceIds,
      mx: { getUserId: () => '@self:example.org' } as never,
      normalThreadRecordMap: new Map() as never,
      onStoreThreadSummary: vi.fn(),
      persistRoomEventCache,
      persistThreadCacheFromRoomEvents,
      persistThreadEventCache,
      queueRoomThreadCachePersist,
      room: room as never,
      roomDebugTraceId: 'test-trace',
      roomThreadFilterActive: false,
      scrollRef,
      scrollToBottomRef,
      sessionId: 'session',
      setSupplementalThreadEvents: vi.fn(),
      setThreadTailLoaded: vi.fn(),
      setThreadTimelineTick: vi.fn(),
      setTimeline: vi.fn(),
      setUnreadInfo: vi.fn(),
      showHiddenEvents: false,
      threadEventIndexMapRef,
      threadId,
      threadResolutionMap: new Map(),
      timelineAtLiveEnd: true,
      unreadInfo: undefined as never,
    });

    return null;
  };

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(Harness));
  });

  const fireLive = (mEvt: FakeEvent) => {
    room.__listeners.forEach((set, key) => {
      if (key === 'Room.timeline' || key === 'RoomEvent.Timeline') {
        set.forEach((listener) => listener(mEvt, room, false, false, { liveEvent: true }));
      }
    });
  };

  return {
    renderer,
    harness: {
      fireLive,
      persistThreadEventCache,
      persistRoomEventCache,
      persistThreadCacheFromRoomEvents,
      unmount: () => {
        act(() => {
          renderer.unmount();
        });
      },
    },
  };
};

const waitCompactionDebounce = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, THREAD_EDIT_COMPACTION_DEBOUNCE_MS + 25);
  });
  await Promise.resolve();
};

describe('roomLiveEventController edit compaction (CINNY-207 P1.4)', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('does not persist a standalone m.replace record; upserts the target after the coalesce window (thread view)', async () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: threadId });
    const edit = makeEvent('$edit-1', {
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$target' },
    });
    const { harness } = createHarness({
      threadId,
      findEventById: (id) => (id === '$target' ? target : id === threadId ? target : undefined),
    });

    act(() => {
      harness.fireLive(edit);
    });

    expect(harness.persistThreadEventCache).not.toHaveBeenCalled();

    await waitCompactionDebounce();

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [expectedThreadId, events] = harness.persistThreadEventCache.mock.calls[0];
    expect(expectedThreadId).toBe(threadId);
    expect(events).toEqual([target]);

    harness.unmount();
  });

  it('coalesces N rapid edits to one target upsert after the debounce window', async () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: threadId });
    const { harness } = createHarness({
      threadId,
      findEventById: (id) => (id === '$target' ? target : id === threadId ? target : undefined),
    });

    act(() => {
      for (let i = 1; i <= 25; i += 1) {
        harness.fireLive(
          makeEvent(`$edit-${i}`, {
            threadRootId: threadId,
            relation: { rel_type: 'm.replace', event_id: '$target' },
          })
        );
      }
    });

    expect(harness.persistThreadEventCache).not.toHaveBeenCalled();

    await waitCompactionDebounce();

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [, events] = harness.persistThreadEventCache.mock.calls[0];
    expect(events).toEqual([target]);

    harness.unmount();
  });

  it('flushes pending upserts on document visibilitychange to hidden', () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: threadId });
    const edit = makeEvent('$edit-1', {
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$target' },
    });
    const { harness } = createHarness({
      threadId,
      findEventById: (id) => (id === '$target' ? target : id === threadId ? target : undefined),
    });

    act(() => {
      harness.fireLive(edit);
    });

    expect(harness.persistThreadEventCache).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  // Round-1 review fix coverage: non-replace events must keep persisting
  // synchronously — a regression that routes them through the debounce
  // would delay normal persistence and risk fire-time drops.
  it('persists non-replace thread events immediately, bypassing the debounce', () => {
    const threadId = '$thread-root';
    const reply = makeEvent('$reply-1', { threadRootId: threadId });
    const { harness } = createHarness({ threadId });

    act(() => {
      harness.fireLive(reply);
    });

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [, events] = harness.persistThreadEventCache.mock.calls[0];
    expect(events).toEqual([reply]);

    harness.unmount();
  });

  // Round-1 review fix: a fire-time target miss must fall back to
  // persisting the replace event standalone instead of silently dropping
  // the edit (the serializer keeps standalone replaces whose target is not
  // in the batch, and hydration applies them).
  it('falls back to persisting the replace standalone when the target is not in SDK memory', async () => {
    const threadId = '$thread-root';
    const edit = makeEvent('$edit-1', {
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$target' },
    });
    const { harness } = createHarness({
      threadId,
      findEventById: () => undefined,
    });

    act(() => {
      harness.fireLive(edit);
    });
    expect(harness.persistThreadEventCache).not.toHaveBeenCalled();

    await waitCompactionDebounce();

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [, events] = harness.persistThreadEventCache.mock.calls[0];
    expect(events).toEqual([edit]);

    harness.unmount();
  });

  // Round-1 review fix: cross-sender replaces never bundle into the target,
  // so compacting them would drop them from cache — they persist directly.
  it('persists cross-sender replaces directly instead of compacting them', () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', {
      threadRootId: threadId,
      sender: '@alice:example.org',
    });
    const crossSenderEdit = makeEvent('$edit-x', {
      threadRootId: threadId,
      sender: '@mallory:example.org',
      relation: { rel_type: 'm.replace', event_id: '$target' },
    });
    const { harness } = createHarness({
      threadId,
      findEventById: (id) => (id === '$target' ? target : undefined),
    });

    act(() => {
      harness.fireLive(crossSenderEdit);
    });

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [, events] = harness.persistThreadEventCache.mock.calls[0];
    expect(events).toEqual([crossSenderEdit]);

    harness.unmount();
  });

  // Round-1 review fix coverage for the room-view thread-target branch:
  // the thread attribution is captured at schedule time and the upsert goes
  // through persistThreadEventCache (fire-time re-derivation would fail for
  // a mid-debounce-redacted target).
  it('compacts room-view thread edits onto the target with captured thread attribution', async () => {
    const rootId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: rootId });
    const edit = makeEvent('$edit-1', {
      threadRootId: rootId,
      relation: { rel_type: 'm.replace', event_id: '$target' },
    });
    const { harness } = createHarness({
      findEventById: (id) => (id === '$target' ? target : undefined),
    });

    act(() => {
      harness.fireLive(edit);
    });
    expect(harness.persistThreadEventCache).not.toHaveBeenCalled();
    expect(harness.persistThreadCacheFromRoomEvents).not.toHaveBeenCalled();

    await waitCompactionDebounce();

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [scheduledThreadId, threadEvents] = harness.persistThreadEventCache.mock.calls[0];
    expect(scheduledThreadId).toBe(rootId);
    expect(threadEvents).toEqual([target]);

    harness.unmount();
  });

  it('persists non-replace room-view thread events immediately via the room-events path', () => {
    const rootId = '$thread-root';
    const reply = makeEvent('$reply-1', { threadRootId: rootId });
    const { harness } = createHarness({});

    act(() => {
      harness.fireLive(reply);
    });

    expect(harness.persistThreadCacheFromRoomEvents).toHaveBeenCalledTimes(1);
    const [events] = harness.persistThreadCacheFromRoomEvents.mock.calls[0];
    expect(events).toEqual([reply]);

    harness.unmount();
  });

  it('compacts room-level edits onto the target room cache record', async () => {
    const target = makeEvent('$room-msg');
    const edit = makeEvent('$edit-1', {
      relation: { rel_type: 'm.replace', event_id: '$room-msg' },
    });
    const { harness } = createHarness({
      findEventById: (id) => (id === '$room-msg' ? target : undefined),
    });

    act(() => {
      harness.fireLive(edit);
    });
    expect(harness.persistRoomEventCache).not.toHaveBeenCalled();

    await waitCompactionDebounce();

    expect(harness.persistRoomEventCache).toHaveBeenCalledTimes(1);
    expect(harness.persistRoomEventCache.mock.calls[0][0]).toEqual([target]);

    harness.unmount();
  });

  it('keeps thread and room compaction keys isolated for the same target id', async () => {
    const rootId = '$thread-root';
    const threadTarget = makeEvent('$target', { threadRootId: rootId });
    const roomTarget = makeEvent('$room-msg');
    const threadEdit = makeEvent('$edit-t', {
      threadRootId: rootId,
      relation: { rel_type: 'm.replace', event_id: '$target' },
    });
    const roomEdit = makeEvent('$edit-r', {
      relation: { rel_type: 'm.replace', event_id: '$room-msg' },
    });
    const { harness } = createHarness({
      findEventById: (id) =>
        id === '$target' ? threadTarget : id === '$room-msg' ? roomTarget : undefined,
    });

    act(() => {
      harness.fireLive(threadEdit);
      harness.fireLive(roomEdit);
    });

    await waitCompactionDebounce();

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);
    expect(harness.persistThreadEventCache.mock.calls[0][1]).toEqual([threadTarget]);
    // The thread edit also flows through the room-level persist path (the
    // harness mocks isThreadOnlyRoomActivity to false), so the room cache
    // sees both targets — under distinct keys, neither upsert swallowed the
    // other.
    const roomPersistedBatches = harness.persistRoomEventCache.mock.calls.map(
      (call) => call[0]
    );
    expect(roomPersistedBatches).toContainEqual([roomTarget]);
    expect(roomPersistedBatches).toContainEqual([threadTarget]);

    harness.unmount();
  });

  it('flushes pending upserts on unmount', () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: threadId });
    const edit = makeEvent('$edit-1', {
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$target' },
    });
    const { harness } = createHarness({
      threadId,
      findEventById: (id) => (id === '$target' ? target : id === threadId ? target : undefined),
    });

    act(() => {
      harness.fireLive(edit);
    });

    expect(harness.persistThreadEventCache).not.toHaveBeenCalled();

    harness.unmount();

    expect(harness.persistThreadEventCache).toHaveBeenCalledTimes(1);
  });
});
