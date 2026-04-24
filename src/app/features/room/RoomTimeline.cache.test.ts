import React, { createRef } from 'react';
import { Direction, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadRecord } from '../../mindroom/threads/types';
import {
  getThreadOpenSeedSnapshot,
  saveThreadOpenSeedSnapshot,
} from './threadOpenSeedCache';
import {
  compactPlaceholderType,
  create,
  createControlledRoomTimelineHarness,
  DEFAULT_THREAD_FILTER_STATE,
  directRoomState,
  flushAsyncWork,
  getClickableByText,
  getRenderedEventIds,
  isMembershipChangedMock,
  loadCachedRoomEventsBeforeMock,
  loadCachedRoomPaginationTokenMock,
  loadLatestCachedThreadSummaryInfoMock,
  loadLatestCachedRoomEventsMock,
  makeCachedRoomEvent,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  navigateRoomThreadMock,
  reactionOrEditEventMock,
  roomIntroType,
  roomThreadListThreadsMock,
  roomThreadOverviewType,
  saveRoomEventsToCacheMock,
  scrollToItemMock,
  scrollType,
  settingsState,
  TEST_DEFAULT_THREAD_FILTER_STATE,
  threadLastActivityTsMapMock,
  threadRenderStateMock,
  threadResolutionMapMock,
  virtualPaginatorState,
  waitForCondition,
} from './RoomTimeline.test.shared';

const makeThreadFilterRecord = (
  threadRootId: string,
  overrides: {
    status?: Partial<ThreadRecord['status']>;
    presentation?: Partial<ThreadRecord['presentation']>;
  } = {}
): ThreadRecord => ({
  roomId: '!room:test',
  threadRootId,
  rootEventId: threadRootId,
  absoluteIndex: 0,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 0,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: undefined,
    recentThreadSummaryText: undefined,
    ...overrides.presentation,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
    ...overrides.status,
  },
});

describe('RoomTimeline', () => {
  describe('cache and overview', () => {
    it('renders without thread render hook initialization errors', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    expect(() =>
      create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      )
    ).not.toThrow();
  });

  it('only hydrates the latest room cache slice when it is newer than the loaded room tail', async () => {
    const { shouldHydrateLatestRoomCache } = await import('./RoomTimeline');

    expect(
      shouldHydrateLatestRoomCache(makeCachedRoomEvent('$loaded', 100), makeCachedRoomEvent('$cached', 200))
    ).toBe(true);
    expect(
      shouldHydrateLatestRoomCache(makeCachedRoomEvent('$loaded', 200), makeCachedRoomEvent('$cached', 200))
    ).toBe(false);
    expect(
      shouldHydrateLatestRoomCache(makeCachedRoomEvent('$loaded', 300), makeCachedRoomEvent('$cached', 200))
    ).toBe(false);
  });

  it('deduplicates cached room hydration events against already loaded SDK events', async () => {
    const { filterLatestRoomCacheHydrationEvents } = await import('./RoomTimeline');

    expect(
      filterLatestRoomCacheHydrationEvents(
        [makeCachedRoomEvent('$loaded', 100), makeCachedRoomEvent('$new', 200)],
        [makeEvent('$loaded', { ts: 100 })] as never
      )
    ).toEqual([makeCachedRoomEvent('$new', 200)]);
  });

  it('shows zero visible replies when a loaded thread only contains hidden threaded metadata relations', async () => {
    const { getThreadReplyCount, shouldRenderZeroReplyThreadBadge } = await import(
      '../../mindroom/threads/threadBadgeViewModel'
    );
    const rootEvent = makeEvent('$thread-root', {
      isThreadRoot: true,
      ts: 100,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 3,
            latest_event: {
              type: 'com.mindroom.thread.tag',
            },
          },
        },
      },
    });
    const hiddenTagEvents = [
      makeEvent('$thread-tag-1', {
        threadRootId: '$thread-root',
        relation: { event_id: '$thread-root', rel_type: 'm.thread' },
        type: 'com.mindroom.thread.tag',
        ts: 200,
      }),
      makeEvent('$thread-tag-2', {
        threadRootId: '$thread-root',
        relation: { event_id: '$thread-root', rel_type: 'm.thread' },
        type: 'com.mindroom.thread.tag',
        ts: 210,
      }),
      makeEvent('$thread-tag-3', {
        threadRootId: '$thread-root',
        relation: { event_id: '$thread-root', rel_type: 'm.thread' },
        type: 'com.mindroom.thread.tag',
        ts: 220,
      }),
    ];
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = (eventId: string) =>
      eventId === '$thread-root'
        ? ({
            events: hiddenTagEvents,
            length: 3,
            rootEvent,
            timeline: hiddenTagEvents,
          } as never)
        : null;

    expect(getThreadReplyCount(room as never, rootEvent as never, undefined, true)).toBe(0);
    expect(shouldRenderZeroReplyThreadBadge(room as never, rootEvent as never)).toBe(true);
  });

  it('preserves bundled thread counts when a thread root is visible before replies are loaded', async () => {
    const { getThreadReplyCount, shouldRenderZeroReplyThreadBadge } = await import(
      '../../mindroom/threads/threadBadgeViewModel'
    );
    const rootEvent = makeEvent('$thread-root', {
      isThreadRoot: true,
      ts: 100,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 3,
            latest_event: {
              type: 'm.room.message',
            },
          },
        },
      },
    });
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = (eventId: string) =>
      eventId === '$thread-root'
        ? ({
            events: [],
            length: 3,
            rootEvent,
            timeline: [],
          } as never)
        : null;

    expect(getThreadReplyCount(room as never, rootEvent as never)).toBe(3);
    expect(shouldRenderZeroReplyThreadBadge(room as never, rootEvent as never)).toBe(false);
  });

  it('hydrates cached room events into the live timeline', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { hydrateCachedEvents } = await import('./eventCacheEditUtils');
    const room = makeRoom({
      liveEvents: [makeEvent('$loaded', { ts: 100 })],
    });
    const roomInputRef = createRef<HTMLElement>();
    const editor = {} as Editor;
    let renderer: ReturnType<typeof create> | undefined;

    loadLatestCachedRoomEventsMock.mockResolvedValue({
      beforeToken: undefined,
      events: [makeCachedRoomEvent('$cached', 200)],
      hasMoreBefore: false,
    });

    try {
      await act(async () => {
        renderer = create(
          React.createElement(RoomTimeline, {
            room,
            roomInputRef,
            editor,
            summaryMap: new Map(),
            onStoreThreadSummary: vi.fn(),
            threadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
            threadSortFreezeState: null,
            onToggle: vi.fn(),
            onSortDirectionChange: vi.fn(),
            onToggleThreadSortFreeze: vi.fn(),
            setThreadSortFreezeState: vi.fn(),
            onCycleTag: vi.fn(),
            onAddTag: vi.fn(),
            onRemoveTag: vi.fn(),
            onReset: vi.fn(),
            onApplyPreset: vi.fn(),
            onSearchQueryChange: vi.fn(),
            viewMode: 'default',
            onViewModeChange: vi.fn(),
          })
        );
        await flushAsyncWork();
      });

      expect(hydrateCachedEvents).toHaveBeenCalledWith({
        room,
        events: expect.arrayContaining([
          expect.objectContaining({
            getId: expect.any(Function),
          }),
        ]),
      });
      expect(room.addLiveEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            getId: expect.any(Function),
          }),
        ]),
        expect.objectContaining({
          fromCache: true,
          timelineWasEmpty: false,
          addToState: false,
        })
      );
      expect(room.getLiveTimeline().getEvents().map((event) => event.getId())).toEqual([
        '$loaded',
        '$cached',
      ]);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('logs room cache hydration failures instead of swallowing them', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const hydrationError = new Error('hydrate failed');
    const room = makeRoom({
      liveEvents: [makeEvent('$loaded', { ts: 100 })],
    });
    const roomInputRef = createRef<HTMLElement>();
    const editor = {} as Editor;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let renderer: ReturnType<typeof create> | undefined;

    loadLatestCachedRoomEventsMock.mockResolvedValue({
      beforeToken: undefined,
      events: [makeCachedRoomEvent('$cached', 200)],
      hasMoreBefore: false,
    });
    room.addLiveEvents.mockRejectedValueOnce(hydrationError);

    try {
      await act(async () => {
        renderer = create(
          React.createElement(RoomTimeline, {
            room,
            roomInputRef,
            editor,
            summaryMap: new Map(),
            onStoreThreadSummary: vi.fn(),
            threadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
            threadSortFreezeState: null,
            onToggle: vi.fn(),
            onSortDirectionChange: vi.fn(),
            onToggleThreadSortFreeze: vi.fn(),
            setThreadSortFreezeState: vi.fn(),
            onCycleTag: vi.fn(),
            onAddTag: vi.fn(),
            onRemoveTag: vi.fn(),
            onReset: vi.fn(),
            onApplyPreset: vi.fn(),
            onSearchQueryChange: vi.fn(),
            viewMode: 'default',
            onViewModeChange: vi.fn(),
          })
        );
        await flushAsyncWork();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to hydrate latest room cache for',
        room.roomId,
        hydrationError
      );
    } finally {
      consoleErrorSpy.mockRestore();
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('preserves an explicit null backward token when hydrating cached room history', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvent = makeEvent('$live-event', { ts: 10 });
    const cachedEvent = makeCachedRoomEvent('$cached-event', 5);
    const liveTimeline = makeTimeline([liveEvent], {
      backwardToken: 'stale-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    loadCachedRoomEventsBeforeMock.mockResolvedValueOnce({
      events: [cachedEvent],
      hasMoreBefore: false,
      beforeToken: null,
    });

    await act(async () => {
      await virtualPaginatorState.lastOptions?.onEnd?.(true);
      await flushAsyncWork();
    });

    expect(room.addEventsToTimeline).toHaveBeenCalled();
    expect(room.addEventsToTimeline.mock.lastCall?.[4]).toBeNull();

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('shows RoomIntro on room re-entry for a reused room object that already reached the top', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvent = makeEvent('$live-event', { ts: 10 });
    const liveTimeline = makeTimeline([liveEvent], {
      backwardToken: 'stale-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    loadCachedRoomPaginationTokenMock.mockResolvedValue(null);

    let firstRenderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      firstRenderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      firstRenderer?.unmount();
      await flushAsyncWork(1);
    });

    let secondRenderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      secondRenderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(secondRenderer?.root.findAllByType(roomIntroType)).toHaveLength(1);
    expect(secondRenderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);

    await act(async () => {
      secondRenderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('falls back to the existing SDK backward token when cached room history has no beforeToken metadata', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvent = makeEvent('$live-event', { ts: 10 });
    const cachedEvent = makeCachedRoomEvent('$cached-event', 5);
    const liveTimeline = makeTimeline([liveEvent], {
      backwardToken: 'server-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    loadCachedRoomEventsBeforeMock.mockResolvedValueOnce({
      events: [cachedEvent],
      hasMoreBefore: false,
    });

    await act(async () => {
      await virtualPaginatorState.lastOptions?.onEnd?.(true);
      await flushAsyncWork();
    });

    expect(room.addEventsToTimeline).toHaveBeenCalled();
    expect(room.addEventsToTimeline.mock.lastCall?.[4]).toBe('server-back-token');

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('recovers a stale room backward token only when cache metadata proves the room start', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvent = makeEvent('$live-event', { ts: 10 });
    const liveTimeline = makeTimeline([liveEvent], {
      backwardToken: 'stale-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    loadCachedRoomPaginationTokenMock.mockResolvedValue(null);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(liveTimeline.getPaginationToken(Direction.Backward)).toBeNull();
    expect(liveTimeline.setPaginationToken).toHaveBeenCalledWith(null, Direction.Backward);
    expect(renderer?.root.findAllByType(roomIntroType)).toHaveLength(1);
    expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    expect(saveRoomEventsToCacheMock).toHaveBeenCalled();
    expect(saveRoomEventsToCacheMock.mock.lastCall?.[3]).toBeNull();

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('keeps eager-preloading past fifty batches in thread-heavy rooms until the configured limit is reached', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    settingsState.paginationLimit = 60;

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const liveEvents = [makeEvent('$visible-0', { ts: 1_000 })];
    const liveTimeline = makeTimeline(liveEvents, {
      backwardToken: 'page-0',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const preloadTarget = 59;
    let page = 0;
    let renderer: ReturnType<typeof create> | undefined;

    matrixClientMock.paginateEventTimeline.mockImplementation(async () => {
      page += 1;
      liveEvents.unshift(
        makeEvent(`$visible-${page}`, { ts: 1_000 - page * 10 }),
        ...Array.from({ length: 4 }, (_, index) =>
          makeEvent(`$thread-${page}-${index}`, {
            ts: 1_000 - page * 10 - index - 1,
            threadRootId: `$root-${page}`,
          })
        )
      );
      liveTimeline.__paginationTokens.backward = page < preloadTarget ? `page-${page}` : null;
      return true;
    });

    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await new Promise((resolve) => {
          setTimeout(resolve, 150);
        });
        await flushAsyncWork(10);
      });

      await act(async () => {
        await waitForCondition(
          () => matrixClientMock.paginateEventTimeline.mock.calls.length >= preloadTarget,
          800
        );
        await flushAsyncWork(20);
      });

      expect(matrixClientMock.paginateEventTimeline).toHaveBeenCalledTimes(preloadTarget);
      expect(page).toBe(preloadTarget);
      expect(virtualPaginatorState.lastOptions?.count).toBe(60);
    } finally {
      consoleLogSpy.mockRestore();
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('uses cache ordering for same-timestamp earliest room events when resolving room-start state', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const sdkFirstEvent = makeEvent('$b-event', { ts: 10 });
    const cacheFirstEvent = makeEvent('$a-event', { ts: 10 });
    const liveTimeline = makeTimeline([sdkFirstEvent, cacheFirstEvent], {
      backwardToken: 'stale-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    loadCachedRoomPaginationTokenMock.mockImplementation(
      async (_sessionId: string, _roomId: string, eventId?: string) =>
        eventId === '$a-event' ? null : undefined
    );

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(loadCachedRoomPaginationTokenMock.mock.calls).not.toHaveLength(0);
    expect(loadCachedRoomPaginationTokenMock.mock.calls.every(([, , eventId]) => eventId === '$a-event')).toBe(
      true
    );
    expect(liveTimeline.getPaginationToken(Direction.Backward)).toBeNull();
    expect(renderer?.root.findAllByType(roomIntroType)).toHaveLength(1);
    expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    expect(saveRoomEventsToCacheMock).toHaveBeenCalled();
    expect(saveRoomEventsToCacheMock.mock.lastCall?.[3]).toBeNull();

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('renders the room thread overview outside thread view', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
      })
    );

    const overview = renderer.root.findByType(roomThreadOverviewType);

    expect(renderer.root.findAllByType(roomThreadOverviewType)).toHaveLength(1);
    expect(renderer.root.findByType(scrollType).findAllByType(roomThreadOverviewType)).toHaveLength(
      0
    );
    expect(overview.props.state).toEqual({ ...TEST_DEFAULT_THREAD_FILTER_STATE, tags: new Map() });
    expect(overview.props.threadCount).toBe(0);
    expect(overview.props.onToggle).toBeTypeOf('function');
  });

  it('passes visible room thread counts to the overview', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const unresolvedThread = makeEvent('$thread-unresolved', { isThreadRoot: true });
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const messageEvent = makeEvent('$message');
    const room = makeRoom({
      liveEvents: [messageEvent, unresolvedThread, resolvedThread],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
      })
    );

    expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(2);
  });

  it('counts fallback-only thread roots in the room thread overview', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const fallbackRoot = makeEvent('$thread-root');
    const fallbackReply = makeEvent('$thread-reply', {
      threadRootId: fallbackRoot.getId(),
    });
    const room = makeRoom({
      liveEvents: [fallbackRoot, fallbackReply],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
      })
    );

    expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(1);
  });

  it('counts old standalone zero-reply message roots in the room thread overview', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const standaloneRoot = makeEvent('$thread-root', {
      ts: 1_000,
      content: { body: 'Older standalone root', msgtype: 'm.text' },
    });
    const room = makeRoom({
      liveEvents: [standaloneRoot],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    try {
      const renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );

      expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not count standalone m.notice messages as zero-reply roots', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const noticeRoot = makeEvent('$notice-root', {
      ts: 1_000,
      content: { body: 'Notice root', msgtype: 'm.notice' },
    });
    const room = makeRoom({
      liveEvents: [noticeRoot],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
      })
    );

    expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(0);
  });

  it('shows pending encrypted local-echo zero-reply roots immediately in compact view', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const firstThread = makeEvent('$thread-1', {
      isThreadRoot: true,
      ts: 100,
    });
    const secondThread = makeEvent('$thread-2', {
      isThreadRoot: true,
      ts: 200,
    });
    const liveEvents = [firstThread, secondThread];
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    roomThreadListThreadsMock.push(
      { id: firstThread.getId(), rootEvent: firstThread },
      { id: secondThread.getId(), rootEvent: secondThread }
    );
    threadLastActivityTsMapMock.set(firstThread.getId(), 100);
    threadLastActivityTsMapMock.set(secondThread.getId(), 200);

    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
            initialThreadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
          })
        );
        await flushAsyncWork(2);
      });

      const pendingRoot = makeEvent('~pending-root', {
        content: { body: 'Pending compact root' },
        isSending: true,
        ts: 0,
        type: 'm.room.encrypted',
      });
      liveEvents.push(pendingRoot);

      await act(async () => {
        room.__listeners.get(RoomEvent.Timeline)?.(pendingRoot, room, false, false, {
          liveEvent: true,
        });
        await flushAsyncWork(2);
      });

      expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
        pendingRoot.getId(),
        secondThread.getId(),
        firstThread.getId(),
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('preserves zero replies for recent standalone roots in the regular timeline thread badge logic', async () => {
    const { getThreadReplyCount, shouldRenderZeroReplyThreadBadge } = await import(
      '../../mindroom/threads/threadBadgeViewModel'
    );
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const standaloneRoot = makeEvent('$thread-root', {
      ts: 999_000,
      content: { body: 'Recent standalone root' },
    });
    const room = makeRoom();

    try {
      expect(shouldRenderZeroReplyThreadBadge(room as never, standaloneRoot as never)).toBe(true);
      expect(getThreadReplyCount(room as never, standaloneRoot as never, undefined, true)).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('counts reply-backed thread roots in preload surface counts even when the root is not renderable in the room timeline', async () => {
    const { getRoomPreloadCounts } = await import('./RoomTimeline');
    const fallbackRoot = makeEvent('$thread-root');
    const fallbackReply = makeEvent('$thread-reply', {
      threadRootId: fallbackRoot.getId(),
    });
    const liveTimeline = makeTimeline([fallbackReply]);
    const room = makeRoom({
      liveTimeline,
      findEventById: (eventId: string) => (eventId === fallbackRoot.getId() ? fallbackRoot : undefined),
    });

    expect(
      getRoomPreloadCounts([liveTimeline] as never, room as never, {
        threadId: undefined,
        ignoredUsersSet: new Set<string>(),
        showHiddenEvents: false,
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
      })
    ).toEqual({
      cacheCount: 0,
      renderableCount: 0,
      surfaceCount: 1,
    });
  });

  it('renders reply-backed thread roots in overview mode when only replies are loaded in the room timeline', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const fallbackRoot = makeEvent('$thread-root');
    const fallbackReply = makeEvent('$thread-reply', {
      threadRootId: fallbackRoot.getId(),
    });
    const room = makeRoom({
      liveEvents: [fallbackReply],
      findEventById: (eventId: string) => (eventId === fallbackRoot.getId() ? fallbackRoot : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
        initialThreadFilter: 'unresolved',
      })
    );

    expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(1);
    expect(renderer.root.findByType(roomThreadOverviewType).props.statusCounts).toEqual({
      resolved: 0,
      streaming: 0,
      scheduled: 0,
      unread: 0,
      idle: 0,
    });
    expect(
      renderer.root.findAllByProps({
        eventId: fallbackRoot.getId(),
      })
    ).toHaveLength(1);
  });

  it('keeps the frozen expanded overview order while metadata updates', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
    const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
    const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
    const room = makeRoom({
      liveEvents: [firstThread, secondThread, thirdThread],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadLastActivityTsMapMock.set(firstThread.getId(), 100);
    threadLastActivityTsMapMock.set(secondThread.getId(), 200);
    threadLastActivityTsMapMock.set(thirdThread.getId(), 300);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
      await flushAsyncWork(2);
    });

    expect(getRenderedEventIds(renderer!)).toEqual([
      thirdThread.getId(),
      secondThread.getId(),
      firstThread.getId(),
    ]);

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
      await flushAsyncWork(2);
    });

    threadLastActivityTsMapMock.set(firstThread.getId(), 500);

    await act(async () => {
      room.__listeners.get(ThreadEvent.Update)?.();
      await flushAsyncWork(2);
    });

    expect(getRenderedEventIds(renderer!)).toEqual([
      thirdThread.getId(),
      secondThread.getId(),
      firstThread.getId(),
    ]);

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
      await flushAsyncWork(2);
    });

    expect(getRenderedEventIds(renderer!)).toEqual([
      firstThread.getId(),
      thirdThread.getId(),
      secondThread.getId(),
    ]);
  });

  it('appends new matching roots and drops removed roots while frozen', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
    const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
    const liveEvents = [firstThread, secondThread];
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadLastActivityTsMapMock.set(firstThread.getId(), 100);
    threadLastActivityTsMapMock.set(secondThread.getId(), 200);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
      await flushAsyncWork(2);
    });

    const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
    threadLastActivityTsMapMock.set(thirdThread.getId(), 300);
    liveEvents.push(thirdThread);

    await act(async () => {
      room.__listeners.get(RoomEvent.Timeline)?.(thirdThread, room, false, false, {
        liveEvent: true,
      });
      await flushAsyncWork(2);
    });

    expect(getRenderedEventIds(renderer!)).toEqual([
      secondThread.getId(),
      firstThread.getId(),
      thirdThread.getId(),
    ]);

    liveEvents.splice(liveEvents.indexOf(firstThread), 1);

    await act(async () => {
      room.__listeners.get(ThreadEvent.Delete)?.();
      await flushAsyncWork(2);
    });

    expect(getRenderedEventIds(renderer!)).toEqual([
      secondThread.getId(),
      thirdThread.getId(),
    ]);
  });

  it('resnapshots on control changes without disabling freeze', async () => {
    vi.useFakeTimers();
    try {
    const { RoomTimeline } = await import('./RoomTimeline');
    const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
    const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
    const resolvedThread = makeEvent('$thread-3', { isThreadRoot: true });
    const room = makeRoom({
      liveEvents: [firstThread, secondThread, resolvedThread],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });
    threadLastActivityTsMapMock.set(firstThread.getId(), 100);
    threadLastActivityTsMapMock.set(secondThread.getId(), 200);
    threadLastActivityTsMapMock.set(resolvedThread.getId(), 300);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      await flushAsyncWork(2);
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
      await flushAsyncWork(2);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.isThreadSortFrozen).toBe(true);
    expect(getRenderedEventIds(renderer!)).toEqual([secondThread.getId(), firstThread.getId()]);

    threadLastActivityTsMapMock.set(firstThread.getId(), 500);

    await act(async () => {
      room.__listeners.get(ThreadEvent.Update)?.();
      await flushAsyncWork(2);
    });

    expect(getRenderedEventIds(renderer!)).toEqual([secondThread.getId(), firstThread.getId()]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the frozen ordering for compact view thread ids', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
    const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
    const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
    const room = makeRoom({
      liveEvents: [firstThread, secondThread, thirdThread],
      threads: [
        { id: firstThread.getId(), rootEvent: firstThread },
        { id: secondThread.getId(), rootEvent: secondThread },
        { id: thirdThread.getId(), rootEvent: thirdThread },
      ],
    });
    roomThreadListThreadsMock.push(
      { id: firstThread.getId(), rootEvent: firstThread },
      { id: secondThread.getId(), rootEvent: secondThread },
      { id: thirdThread.getId(), rootEvent: thirdThread }
    );
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadLastActivityTsMapMock.set(firstThread.getId(), 100);
    threadLastActivityTsMapMock.set(secondThread.getId(), 200);
    threadLastActivityTsMapMock.set(thirdThread.getId(), 300);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          initialViewMode: 'compact',
        })
      );
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
      await flushAsyncWork(2);
    });

    expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
      thirdThread.getId(),
      secondThread.getId(),
      firstThread.getId(),
    ]);

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
      await flushAsyncWork(2);
    });

    threadLastActivityTsMapMock.set(firstThread.getId(), 500);

    await act(async () => {
      room.__listeners.get(ThreadEvent.Update)?.();
      await flushAsyncWork(2);
    });

    expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
      thirdThread.getId(),
      secondThread.getId(),
      firstThread.getId(),
    ]);
  });

  it('keeps direct rooms on the message timeline even with compact overview state', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const directMessage = makeEvent('$dm-message');
    const room = makeRoom({
      liveEvents: [directMessage],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    directRoomState.value = true;

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          initialViewMode: 'compact',
          initialThreadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
        })
      );
      await flushAsyncWork(2);
    });

    expect(getRenderedEventIds(renderer!)).toEqual([directMessage.getId()]);
    expect(renderer?.root.findAllByType(roomThreadOverviewType)).toHaveLength(0);
    expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
  });

  it('redirects frozen compact-order permalinks into thread view', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
    const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
    const compactOnlyThread = makeEvent('$thread-3', { isThreadRoot: true });
    const roomThreads = [
      { id: firstThread.getId(), rootEvent: firstThread, length: 1 },
      { id: secondThread.getId(), rootEvent: secondThread, length: 1 },
      { id: compactOnlyThread.getId(), rootEvent: compactOnlyThread, length: 1 },
    ];
    const room = makeRoom({
      liveEvents: [firstThread, secondThread],
      threads: roomThreads as never,
    });
    roomThreadListThreadsMock.push(...(roomThreads as never));
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadLastActivityTsMapMock.set(firstThread.getId(), 100);
    threadLastActivityTsMapMock.set(secondThread.getId(), 200);
    threadLastActivityTsMapMock.set(compactOnlyThread.getId(), 300);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          initialViewMode: 'compact',
        })
      );
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
      await flushAsyncWork(2);
    });

    threadLastActivityTsMapMock.set(firstThread.getId(), 500);

    await act(async () => {
      room.__listeners.get(ThreadEvent.Update)?.();
      await flushAsyncWork(2);
    });

    expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
      compactOnlyThread.getId(),
      secondThread.getId(),
      firstThread.getId(),
    ]);

    scrollToItemMock.mockClear();
    navigateRoomThreadMock.mockClear();

    await act(async () => {
      renderer?.update(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: firstThread.getId(),
          initialViewMode: 'compact',
        })
      );
      await flushAsyncWork(2);
    });

    expect(scrollToItemMock).not.toHaveBeenCalled();
    expect(navigateRoomThreadMock).toHaveBeenCalledWith(
      room.roomId,
      firstThread.getId(),
      undefined,
      { replace: true }
    );
  });

  it('preloads cached overview metadata in the frozen display order', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
    const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
    const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
    const room = makeRoom({
      liveEvents: [firstThread, secondThread, thirdThread],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadLastActivityTsMapMock.set(firstThread.getId(), 100);
    threadLastActivityTsMapMock.set(secondThread.getId(), 200);
    threadLastActivityTsMapMock.set(thirdThread.getId(), 300);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
      await flushAsyncWork(2);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
      await flushAsyncWork(2);
    });

    vi.mocked(loadLatestCachedThreadEvents).mockClear();
    threadLastActivityTsMapMock.set(firstThread.getId(), 500);

    await act(async () => {
      room.__listeners.get(ThreadEvent.Update)?.();
      await flushAsyncWork(2);
    });

    expect(
      vi.mocked(loadLatestCachedThreadEvents).mock.calls.map((call) => call[2])
    ).toEqual([thirdThread.getId(), secondThread.getId(), firstThread.getId()]);
  });

  it('does not issue per-visible-thread summary cache reads from the render path', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
    const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
    const room = makeRoom({
      liveEvents: [firstThread, secondThread],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(3);
    });

    expect(loadLatestCachedThreadSummaryInfoMock).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('collects room-loaded thread events in chronological order without surfacing relation rows', async () => {
    const { getLoadedRoomThreadEvents, getLoadedRoomThreadSeedEvents } = await import('./RoomTimeline');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1 });
    const newerReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 4,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'thinking...' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadedEdit = makeEvent('$thread-edit-1', {
      content: {
        body: '* edited reply',
        'm.new_content': {
          body: 'edited reply',
          msgtype: 'm.text',
        },
      },
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
      ts: 3,
    });
    const editRedaction = makeEvent('$thread-edit-redaction', {
      associatedId: '$thread-edit-1',
      isRedaction: true,
      threadRootId: threadId,
      ts: 5,
    });
    const olderTimeline = makeTimeline([rootEvent, firstReply, threadedEdit, editRedaction]);
    const liveTimeline = makeTimeline([newerReply]);
    (
      olderTimeline as ReturnType<typeof makeTimeline> & {
        getNeighbouringTimeline: (direction: Direction) => ReturnType<typeof makeTimeline> | null;
      }
    ).getNeighbouringTimeline = (direction: Direction) =>
      direction === Direction.Forward ? liveTimeline : null;
    (
      liveTimeline as ReturnType<typeof makeTimeline> & {
        getNeighbouringTimeline: (direction: Direction) => ReturnType<typeof makeTimeline> | null;
      }
    ).getNeighbouringTimeline = (direction: Direction) =>
      direction === Direction.Backward ? olderTimeline : null;
    const room = makeRoom({
      liveTimeline,
      timelinesByEventId: new Map([
        [threadId, olderTimeline],
        ['$thread-reply-1', olderTimeline],
        ['$thread-edit-1', olderTimeline],
        ['$thread-edit-redaction', olderTimeline],
      ]),
    });

    expect(getLoadedRoomThreadEvents(room as never, threadId).map((event) => event.getId())).toEqual([
      '$thread-root',
      '$thread-reply-1',
      '$thread-reply-2',
    ]);
    expect(getLoadedRoomThreadSeedEvents(room as never, threadId).map((event) => event.getId())).toEqual(
      ['$thread-root', '$thread-reply-1', '$thread-edit-1', '$thread-reply-2', '$thread-edit-redaction']
    );
  });

  it('seeds thread fallback immediately from room-loaded replies for targeted opens before thread cache hydration resolves', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { hydrateCachedEvents } = await import('./eventCacheEditUtils');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'thinking...' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadedEdit = makeEvent('$thread-edit-1', {
      content: {
        body: '* edited reply',
        'm.new_content': {
          body: 'edited reply',
          msgtype: 'm.text',
        },
      },
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
      ts: 3,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 4,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([secondReply, threadedEdit, rootEvent, firstReply]),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            eventId: '$thread-reply-1',
            threadId,
          })
        );
      });

      await waitForCondition(
        () => vi.mocked(hydrateCachedEvents).mock.calls.length > 0,
        50
      );
      expect(vi.mocked(hydrateCachedEvents)).toHaveBeenCalledWith({
        room,
        events: [rootEvent, firstReply, threadedEdit, secondReply],
        timelineSets: [room.getUnfilteredTimelineSet()],
      });
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        rootEvent,
        firstReply,
        secondReply,
      ]);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      renderer?.unmount();
    }
  });

  it('warms thread-open seed snapshots from room-preloaded thread events', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'thinking...' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadedEdit = makeEvent('$thread-edit-1', {
      content: {
        body: '* edited reply',
        'm.new_content': {
          body: 'edited reply',
          msgtype: 'm.text',
        },
      },
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
      ts: 3,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 4,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([secondReply, threadedEdit, firstReply, rootEvent], {
        backwardToken: null,
        forwardToken: null,
      }),
      findEventById: (eventId: string) =>
        [threadId, '$thread-reply-1', '$thread-reply-2'].includes(eventId)
          ? ({
              [threadId]: rootEvent,
              '$thread-reply-1': firstReply,
              '$thread-reply-2': secondReply,
            } as const)[eventId]
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
      });

      await waitForCondition(
        () => getThreadOpenSeedSnapshot(room as never, threadId).length === 4,
        50
      );

      expect(getThreadOpenSeedSnapshot(room as never, threadId).map((mEvent) => mEvent.getId())).toEqual([
        threadId,
        '$thread-reply-1',
        '$thread-edit-1',
        '$thread-reply-2',
      ]);
    } finally {
      renderer?.unmount();
    }
  });

  it('prioritizes large thread seeds from the room thread list even when they are outside the viewport', async () => {
    const { collectPriorityThreadSeedPrewarmRoots } = await import('./RoomTimeline');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 25,
          },
        },
      },
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent], {
        backwardToken: null,
        forwardToken: null,
      }),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThreads = () =>
      [
        {
          id: threadId,
          length: 25,
          rootEvent,
        },
      ] as never;
    const visibleSmallRoot = makeEvent('$visible-root', {
      isThreadRoot: true,
      ts: 5,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 2,
          },
        },
      },
    });

    expect(
      collectPriorityThreadSeedPrewarmRoots({
        room: room as never,
        threadFilteredEventEntries: [{ event: visibleSmallRoot }] as never,
        threadReplyCountMap: new Map(),
        threadResolutionMap: new Map(),
        rangeStart: 0,
        rangeEnd: 1,
      })
    ).toEqual([
      {
        threadId,
        replyCount: 25,
        visible: false,
      },
    ]);
  });

  it('prioritizes threads from the active overview range over larger off-screen room threads', async () => {
    const { collectPriorityThreadSeedPrewarmRoots } = await import('./RoomTimeline');
    const visibleRoots = Array.from({ length: 12 }, (_, index) =>
      makeEvent(`$thread-root-${index + 1}`, {
        isThreadRoot: true,
        ts: index + 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 25,
            },
          },
        },
      })
    );
    const largeOffscreenRoot = makeEvent('$thread-root-large-offscreen', {
      isThreadRoot: true,
      ts: 100,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 400,
          },
        },
      },
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([...visibleRoots, largeOffscreenRoot], {
        backwardToken: null,
        forwardToken: null,
      }),
    });
    room.getThreads = () =>
      [
        {
          id: largeOffscreenRoot.getId(),
          length: 400,
          rootEvent: largeOffscreenRoot,
        },
      ] as never;

    expect(
      collectPriorityThreadSeedPrewarmRoots({
        room: room as never,
        threadFilteredEventEntries: visibleRoots.map((event) => ({ event })) as never,
        threadReplyCountMap: new Map(),
        threadResolutionMap: new Map(),
        rangeStart: 10,
        rangeEnd: 12,
      }).slice(0, 2)
    ).toEqual([
      {
        threadId: '$thread-root-3',
        replyCount: 25,
        visible: true,
      },
      {
        threadId: '$thread-root-4',
        replyCount: 25,
        visible: true,
      },
    ]);
  });

  it('ignores room thread-list entries without a root event or known reply count', async () => {
    const { collectPriorityThreadSeedPrewarmRoots } = await import('./RoomTimeline');
    const visibleRoot = makeEvent('$visible-thread-root', {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 25,
          },
        },
      },
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([visibleRoot], {
        backwardToken: null,
        forwardToken: null,
      }),
    });
    room.getThreads = () =>
      [
        {
          id: '$thread-without-root',
          length: 0,
          rootEvent: undefined,
        },
      ] as never;

    expect(() =>
      collectPriorityThreadSeedPrewarmRoots({
        room: room as never,
        threadFilteredEventEntries: [{ event: visibleRoot }] as never,
        threadReplyCountMap: new Map(),
        threadResolutionMap: new Map(),
        rangeStart: 0,
        rangeEnd: 1,
      })
    ).not.toThrow();
  });

  it('seeds untargeted first open from the richer in-memory thread snapshot when room and model seeds are thinner', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { hydrateCachedEvents } = await import('./eventCacheEditUtils');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'thinking...' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadedEdit = makeEvent('$thread-edit-1', {
      content: {
        body: '* edited reply',
        'm.new_content': {
          body: 'edited reply',
          msgtype: 'm.text',
        },
      },
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
      ts: 3,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 4,
    });
    const thirdReply = makeEvent('$thread-reply-3', {
      threadRootId: threadId,
      ts: 5,
    });
    const threadTimeline = makeTimeline([rootEvent, secondReply], {
      backwardToken: null,
    });
    const threadTimelineSet = {
      getLiveTimeline: () => threadTimeline,
      getTimelineForEvent: (eventId: string) =>
        [threadId, '$thread-reply-2'].includes(eventId) ? threadTimeline : undefined,
    };
    const threadModel = {
      rootEvent,
      events: [secondReply],
      getUnfilteredTimelineSet: () => threadTimelineSet,
    };
    const room = makeRoom({
      liveTimeline: makeTimeline([threadedEdit, rootEvent, firstReply]),
      findEventById: (eventId: string) =>
        [threadId, '$thread-reply-1'].includes(eventId)
          ? ({
              [threadId]: rootEvent,
              '$thread-reply-1': firstReply,
            } as const)[eventId]
          : undefined,
    });
    room.getMember = ((userId: string) => ({ name: userId })) as never;
    room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    saveThreadOpenSeedSnapshot(room as never, threadId, [
      rootEvent,
      firstReply,
      threadedEdit,
      secondReply,
      thirdReply,
    ]);
    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
      });

      await waitForCondition(
        () =>
          threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
            ([expectedThreadId, events]) =>
              expectedThreadId === threadId && Array.isArray(events) && events.length === 5
          ),
        50
      );

      expect(vi.mocked(hydrateCachedEvents)).toHaveBeenCalledWith({
        room,
        events: [rootEvent, firstReply, threadedEdit],
        timelineSets: [room.getUnfilteredTimelineSet()],
      });
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        rootEvent,
        firstReply,
        threadedEdit,
        secondReply,
        thirdReply,
      ]);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      renderer?.unmount();
    }
  });

  it('seeds untargeted thread reopen immediately from an existing local thread model before cache hydration resolves', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      threadRootId: threadId,
      ts: 2,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 3,
    });
    const threadTimeline = makeTimeline([rootEvent, firstReply, secondReply], {
      backwardToken: null,
    });
    const threadTimelineSet = {
      getLiveTimeline: () => threadTimeline,
      getTimelineForEvent: (eventId: string) =>
        [threadId, '$thread-reply-1', '$thread-reply-2'].includes(eventId)
          ? threadTimeline
          : undefined,
    };
    const threadModel = {
      rootEvent,
      events: [firstReply, secondReply],
      getUnfilteredTimelineSet: () => threadTimelineSet,
    };
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        rootEvent,
        firstReply,
        secondReply,
      ]);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      renderer?.unmount();
    }
  });

  it('seeds untargeted zero-reply thread opens from the locally available root before cache hydration resolves', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '~pending-root';
    const rootEvent = makeEvent(threadId, {
      content: { body: 'YOLO' },
      isSending: true,
      isThreadRoot: true,
      ts: 0,
      txnId: 'txn-yolo',
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
      });

      await waitForCondition(
        () =>
          threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
            ([expectedThreadId, events]) =>
              expectedThreadId === threadId &&
              Array.isArray(events) &&
              events.length === 1 &&
              events[0] === rootEvent
          ),
        50
      );
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        rootEvent,
      ]);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      renderer?.unmount();
    }
  });

  it('opens confirmed zero-reply roots without warning when no sdk thread model exists yet', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const threadId = '$zero-reply-root';
    const rootEvent = makeEvent(threadId, {
      content: { body: 'Fresh compact root' },
      ts: 999_000,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValue({
      events: [],
      hasMoreBefore: false,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(5);
      });

      await waitForCondition(
        () =>
          threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
            ([expectedThreadId, events]) =>
              expectedThreadId === threadId &&
              Array.isArray(events) &&
              events.length === 1 &&
              events[0] === rootEvent
          ),
        50
      );
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        'Could not create thread object for',
        threadId
      );
    } finally {
      nowSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      await act(async () => {
        await Promise.resolve();
      });
      renderer?.unmount();
    }
  });

  it('reuses the in-memory thread snapshot on untargeted reopen before cache hydration resolves', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 2,
          },
        },
      },
    });
    const firstReply = makeEvent('$thread-reply-1', {
      threadRootId: threadId,
      ts: 2,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 3,
    });
    const partialThreadTimeline = makeTimeline([rootEvent, firstReply], {
      backwardToken: null,
    });
    const partialThreadTimelineSet = {
      getLiveTimeline: () => partialThreadTimeline,
      getTimelineForEvent: (eventId: string) =>
        [threadId, '$thread-reply-1'].includes(eventId) ? partialThreadTimeline : undefined,
    };
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThread = (eventId: string) =>
      eventId === threadId
        ? ({
            rootEvent,
            events: [firstReply],
            getUnfilteredTimelineSet: () => partialThreadTimelineSet,
          } as never)
        : null;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    saveThreadOpenSeedSnapshot(room as never, threadId, [firstReply, secondReply]);
    expect(getThreadOpenSeedSnapshot(room as never, threadId).map((mEvent) => mEvent.getId())).toEqual([
      '$thread-reply-1',
      '$thread-reply-2',
    ]);

    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let secondRenderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        secondRenderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );
      const reopenCall = threadRenderStateMock.setSupplementalThreadEvents.mock.calls.find(
        ([expectedThreadId]) => expectedThreadId === threadId
      );
      expect(reopenCall).toBeDefined();
      expect(
        (reopenCall?.[1] as { getId?: () => string }[]).map((mEvent) => mEvent?.getId?.())
      ).toEqual([threadId, '$thread-reply-1', '$thread-reply-2']);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      secondRenderer?.unmount();
    }
  });

  it('hydrates every cached thread page before falling back to network bootstrap', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadCachedThreadEventsBefore, loadLatestCachedThreadEvents } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root';
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: undefined,
      events: [
        {
          content: {
            body: 'reply-3',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 3,
        },
      ],
      hasMoreBefore: true,
      rootEvent: undefined,
      snapshotComplete: false,
      tailLoaded: false,
    } as never);
    vi.mocked(loadCachedThreadEventsBefore).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 1,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 2,
        },
      ],
      hasMoreBefore: false,
      rootEvent: undefined,
      snapshotComplete: false,
      tailLoaded: false,
    } as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () =>
          threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
            ([expectedThreadId, events]) =>
              expectedThreadId === threadId &&
              Array.isArray(events) &&
              events.length === 3
          ),
        50
      );

      expect(loadCachedThreadEventsBefore).toHaveBeenCalledTimes(1);
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        expect.objectContaining({ getId: expect.any(Function) }),
        expect.objectContaining({ getId: expect.any(Function) }),
        expect.objectContaining({ getId: expect.any(Function) }),
      ]);
      const latestCall = threadRenderStateMock.setSupplementalThreadEvents.mock.calls
        .filter(([expectedThreadId]) => expectedThreadId === threadId)
        .at(-1);
      expect(latestCall?.[1].map((event: ReturnType<typeof makeEvent>) => event.getId())).toEqual([
        '$thread-reply-1',
        '$thread-reply-2',
        '$thread-reply-3',
      ]);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('skips thread bootstrap but still refreshes the latest relations tail on untargeted complete cache hits', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadRenderStateMock.threadEvents = [
      makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
      }),
      makeEvent('$thread-reply-1', {
        threadRootId: threadId,
        ts: 2,
      }),
    ];
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
        },
        {
          content: {
            body: 'reply',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
        },
      ],
      hasMoreBefore: false,
      rootEvent: undefined,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );

      expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.relations).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('prefers cached thread hydrate over a tiny room seed on untargeted open', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const roomSeedReply = makeEvent('$room-seed-reply', {
      threadRootId: threadId,
      ts: 2,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, roomSeedReply]),
      findEventById: (eventId: string) =>
        eventId === threadId ? rootEvent : eventId === '$room-seed-reply' ? roomSeedReply : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'cached reply 1',
            msgtype: 'm.text',
          },
          event_id: '$cached-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'cached reply 2',
            msgtype: 'm.text',
          },
          event_id: '$cached-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'reply-3',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 4,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );

      const threadCalls = threadRenderStateMock.setSupplementalThreadEvents.mock.calls.filter(
        ([expectedThreadId]) => expectedThreadId === threadId
      );
      expect(threadCalls.length).toBeGreaterThan(0);
      expect(
        threadCalls.some(
          ([, events]) =>
            Array.isArray(events) &&
            events.map((event: ReturnType<typeof makeEvent>) => event.getId()).join(',') ===
              '$cached-reply-1,$cached-reply-2'
        )
      ).toBe(true);
      expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('repairs complete cached thread snapshots that are missing relation hydration', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
          },
        },
      },
    });
    const room = makeRoom({
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            sender?: string;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                relation: rawEvent.content?.['m.relates_to'] as
                  | { rel_type?: string; event_id?: string }
                  | undefined,
                sender: rawEvent.sender,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'Thinking...  ⋯',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
          sender: '@bot:example.org',
        },
      ],
      hasMoreBefore: false,
      relationSnapshotComplete: false,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        sender: '@alice:example.org',
      },
      snapshotComplete: true,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'Thinking...  ⋯',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
          sender: '@bot:example.org',
        },
        {
          content: {
            'm.new_content': {
              body: 'Final answer',
              msgtype: 'm.text',
            },
            'm.relates_to': {
              event_id: '$thread-reply-1',
              rel_type: 'm.replace',
            },
            body: '* Final answer',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1-edit',
          origin_server_ts: 3,
          sender: '@bot:example.org',
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);

      expect(matrixClientMock.fetchRelations).toHaveBeenCalledWith(
        '!room:example.org',
        threadId,
        null,
        null,
        expect.objectContaining({
          dir: Direction.Backward,
          limit: 200,
          recurse: true,
        })
      );
      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
      expect(
        vi.mocked(saveThreadEventsToCache).mock.calls.some(
          (call) => call[2] === threadId && call[9] === true
        )
      ).toBe(true);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('infers a complete cached thread snapshot from the persisted expected reply count when root counts are sparse', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom({
      findEventById: (eventId: string) =>
        eventId === threadId
          ? makeEvent(threadId, {
              isThreadRoot: true,
              ts: 1,
            })
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 2,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
      },
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'reply-3',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 4,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );

      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not trust stale complete cache flags when the persisted expected reply count is larger than the cached reply set', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom({
      findEventById: (eventId: string) =>
        eventId === threadId
          ? makeEvent(threadId, {
              isThreadRoot: true,
              ts: 1,
            })
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 3,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
      expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('prefers fresher room root counts over stale cached root counts when checking complete cached thread snapshots', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root';
    const room = makeRoom({
      findEventById: (eventId: string) =>
        eventId === threadId
          ? makeEvent(threadId, {
              isThreadRoot: true,
              ts: 1,
              unsigned: {
                'm.relations': {
                  'm.thread': {
                    count: 3,
                  },
                },
              },
            })
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 2,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 2,
            },
          },
        },
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'reply-3',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 4,
          'm.thread.root': threadId,
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
      expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
      expect(
        vi.mocked(saveThreadEventsToCache).mock.calls.some(
          (call) => call[2] === threadId && call[8] === 3 && call[9] === true
        )
      ).toBe(true);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('falls back to the cached root count when the fresher room root is sparse', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom({
      findEventById: (eventId: string) =>
        eventId === threadId
          ? makeEvent(threadId, {
              isThreadRoot: true,
              ts: 1,
            })
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: undefined,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 2,
            },
          },
        },
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );

      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('fills incomplete cached thread snapshots from thread relations before falling back to sdk bootstrap', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 3,
          },
        },
      },
    });
    const staleThreadTimeline = makeTimeline([rootEvent], {
      backwardToken: 'stale-backward-token',
    });
    const threadTimelineSet = {
      getLiveTimeline: () => staleThreadTimeline,
      getTimelineForEvent: (eventId: string) =>
        eventId === threadId ? staleThreadTimeline : undefined,
    };
    (
      staleThreadTimeline as ReturnType<typeof makeTimeline> & {
        getTimelineSet?: () => typeof threadTimelineSet;
      }
    ).getTimelineSet = () => threadTimelineSet;
    const room = makeRoom({
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThread = () =>
      ({
        events: [rootEvent],
        getUnfilteredTimelineSet: () => threadTimelineSet,
        rootEvent,
      }) as never;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 3,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 3,
            },
          },
        },
      },
      snapshotComplete: false,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'reply-3',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 4,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);

      expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
      expect(staleThreadTimeline.getPaginationToken(Direction.Backward)).toBeNull();
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
          expect.objectContaining({ event_id: '$thread-reply-2' }),
          expect.objectContaining({ event_id: '$thread-reply-3' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        null,
        true,
        true,
        3,
        true
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not treat an empty relations backfill as complete when the known reply count is still unmet', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root-empty-backfill';
    const firstReplyId = '$thread-reply-1-empty-backfill';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 3,
          },
        },
      },
    });
    const firstReply = makeEvent(firstReplyId, {
      content: { body: 'reply-1' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadTimeline = makeTimeline([rootEvent, firstReply]);
    const threadTimelineSet = {
      getLiveTimeline: () => threadTimeline,
      getTimelineForEvent: (eventId: string) =>
        eventId === threadId || eventId === firstReplyId ? threadTimeline : undefined,
    };
    const room = makeRoom({
      findEventById: (eventId: string) => {
        if (eventId === threadId) return rootEvent;
        if (eventId === firstReplyId) return firstReply;
        return undefined;
      },
    });
    room.getThread = () =>
      ({
        events: [rootEvent, firstReply],
        getUnfilteredTimelineSet: () => threadTimelineSet,
        rootEvent,
      }) as never;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: firstReplyId,
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 3,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 3,
            },
          },
        },
      },
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([expect.objectContaining({ event_id: firstReplyId })]),
        expect.objectContaining({ event_id: threadId }),
        null,
        true,
        false,
        3,
        true
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('clears stale sdk backward tokens on complete cached thread hydrate', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const threadReply = makeEvent('$thread-reply-1', {
      threadRootId: threadId,
      ts: 2,
    });
    const staleThreadTimeline = makeTimeline([rootEvent, threadReply], {
      backwardToken: 'stale-backward-token',
    });
    const threadTimelineSet = {
      getLiveTimeline: () => staleThreadTimeline,
      getTimelineForEvent: (eventId: string) =>
        eventId === threadId || eventId === '$thread-reply-1' ? staleThreadTimeline : undefined,
    };
    (
      staleThreadTimeline as ReturnType<typeof makeTimeline> & {
        getTimelineSet?: () => typeof threadTimelineSet;
      }
    ).getTimelineSet = () => threadTimelineSet;
    const room = makeRoom({
      findEventById: (eventId: string) => {
        if (eventId === threadId) return rootEvent;
        if (eventId === '$thread-reply-1') return threadReply;
        return undefined;
      },
    });
    room.getThread = () =>
      ({
        events: [rootEvent, threadReply],
        getUnfilteredTimelineSet: () => threadTimelineSet,
        rootEvent,
      }) as never;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
        },
        {
          content: {
            body: 'reply',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
        },
      ],
      hasMoreBefore: false,
      rootEvent: undefined,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => staleThreadTimeline.getPaginationToken(Direction.Backward) === null,
        50
      );

      expect(staleThreadTimeline.getPaginationToken(Direction.Backward)).toBeNull();
      expect(() => getClickableByText(renderer!, 'Load Older Messages')).toThrow();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not treat a sparse cached thread page as complete without a loaded tail marker', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
        },
      ],
      hasMoreBefore: false,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
      },
      snapshotComplete: false,
      tailLoaded: false,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
      expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('marks room-derived thread cache snapshots complete only when the known reply count is satisfied', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
          },
        },
      },
    });
    const threadedReply = makeEvent('$thread-reply-1', {
      content: { body: 'reply' },
      threadRootId: threadId,
      ts: 2,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, threadedReply]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        null,
        true,
        true,
        1,
        undefined
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('keeps room-derived thread cache snapshots incomplete when only a subset of replies is loaded', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 5,
          },
        },
      },
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'reply-1' },
      threadRootId: threadId,
      ts: 2,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      content: { body: 'reply-2' },
      threadRootId: threadId,
      ts: 3,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, firstReply, secondReply]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
          expect.objectContaining({ event_id: '$thread-reply-2' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        undefined,
        true,
        false,
        5,
        undefined
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not downgrade room-derived thread cache completeness when the room tail is still unknown', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 5,
          },
        },
      },
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'reply-1' },
      threadRootId: threadId,
      ts: 2,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      content: { body: 'reply-2' },
      threadRootId: threadId,
      ts: 3,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, firstReply, secondReply], {
        forwardToken: 'forward-gap',
      }),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
          expect.objectContaining({ event_id: '$thread-reply-2' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        undefined,
        undefined,
        undefined,
        5,
        undefined
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not treat sdk thread length as authoritative when root counts are sparse', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const threadedReply = makeEvent('$thread-reply-1', {
      content: { body: 'reply' },
      threadRootId: threadId,
      ts: 2,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, threadedReply]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThread = () =>
      ({
        length: 1,
      }) as never;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        undefined,
        true,
        undefined,
        undefined,
        undefined
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('persists root-targeted relations into the thread cache during room cache persistence', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const reactionEvent = makeEvent('$thread-root-reaction', {
      associatedId: threadId,
      relation: { event_id: threadId, rel_type: 'm.annotation' },
      ts: 2,
      type: 'm.reaction',
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, reactionEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(
        vi
          .mocked(saveThreadEventsToCache)
          .mock.calls.some(
            ([, , expectedThreadId, rawEvents]) =>
              expectedThreadId === threadId &&
              Array.isArray(rawEvents) &&
              rawEvents.some(
                (rawEvent) =>
                  typeof rawEvent?.event_id === 'string' &&
                  rawEvent.event_id === '$thread-root-reaction'
              )
          )
      ).toBe(true);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('persists redactions targeting thread replies into the thread cache during room cache persistence', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const replyEvent = makeEvent('$thread-reply-1', {
      content: { body: 'reply' },
      threadRootId: threadId,
      ts: 2,
    });
    const redactionEvent = makeEvent('$thread-reply-1-redaction', {
      associatedId: '$thread-reply-1',
      isRedaction: true,
      ts: 3,
      type: 'm.room.redaction',
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, replyEvent, redactionEvent]),
      findEventById: (eventId: string) =>
        eventId === threadId ? rootEvent : eventId === '$thread-reply-1' ? replyEvent : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(
        vi
          .mocked(saveThreadEventsToCache)
          .mock.calls.some(
            ([, , expectedThreadId, rawEvents]) =>
              expectedThreadId === threadId &&
              Array.isArray(rawEvents) &&
              rawEvents.some(
                (rawEvent) =>
                  typeof rawEvent?.event_id === 'string' &&
                  rawEvent.event_id === '$thread-reply-1-redaction'
              )
          )
      ).toBe(true);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('persists paginated thread-only room events into the thread cache', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const paginatedReply = makeEvent('$thread-reply-paginated', {
      content: { body: 'older reply' },
      threadRootId: threadId,
      ts: 2,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      const timelineHandler = room.__listeners.get(RoomEvent.Timeline);
      expect(timelineHandler).toBeTypeOf('function');

      await act(async () => {
        timelineHandler?.(paginatedReply, room, true, false, {
          liveEvent: false,
        });
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () =>
          vi.mocked(saveThreadEventsToCache).mock.calls.some(
            ([, , expectedThreadId, rawEvents]) =>
              expectedThreadId === threadId &&
              Array.isArray(rawEvents) &&
              rawEvents.some(
                (rawEvent) =>
                  typeof rawEvent?.event_id === 'string' &&
                  rawEvent.event_id === '$thread-reply-paginated'
              )
          ),
        50
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('filters room events by thread resolution state', async () => {
    const { getThreadFilteredEvents } = await import('./RoomTimeline');
    const room = makeRoom();
    const unresolvedEvent = makeEvent('$thread-unresolved', { isThreadRoot: true });
    const resolvedEvent = makeEvent('$thread-resolved', { isThreadRoot: true });
    const messageEvent = makeEvent('$message');
    const renderableEvents = [messageEvent, unresolvedEvent, resolvedEvent];
    const resolutionMap = new Map([['$thread-resolved', { isResolved: true }]]);
    const threadRecordMap = new Map<string, ThreadRecord>([
      ['$thread-unresolved', makeThreadFilterRecord('$thread-unresolved')],
      [
        '$thread-resolved',
        makeThreadFilterRecord('$thread-resolved', { status: { isResolved: true } }),
      ],
    ]);

    expect(
      getThreadFilteredEvents(
        renderableEvents as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
        undefined,
        threadRecordMap
      ).map((event) => event.getId())
    ).toEqual(['$thread-unresolved']);
    expect(
      getThreadFilteredEvents(
        renderableEvents as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'include' as const, tags: new Map() },
        undefined,
        threadRecordMap
      ).map((event) => event.getId())
    ).toEqual(['$thread-resolved']);
  });

  it('treats fallback reply counts as visible thread roots for filtering', async () => {
    const { getThreadFilteredEvents } = await import('./RoomTimeline');
    const room = makeRoom();
    const fallbackRoot = makeEvent('$thread-root');
    const messageEvent = makeEvent('$message');
    const fallbackCounts = new Map([[fallbackRoot.getId(), 2]]);
    const resolutionMap = new Map<string, { isResolved: boolean }>();

    expect(
      getThreadFilteredEvents(
        [messageEvent, fallbackRoot] as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
        fallbackCounts,
        new Map([['$thread-root', makeThreadFilterRecord('$thread-root')]])
      ).map((event) => event.getId())
    ).toEqual(['$thread-root']);

    resolutionMap.set(fallbackRoot.getId(), { isResolved: true, tags: null });
    expect(
      getThreadFilteredEvents(
        [messageEvent, fallbackRoot] as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'include' as const, tags: new Map() },
        fallbackCounts,
        new Map([
          ['$thread-root', makeThreadFilterRecord('$thread-root', { status: { isResolved: true } })],
        ])
      ).map((event) => event.getId())
    ).toEqual(['$thread-root']);
  });

  it('does not treat thread replies as visible thread roots for filtering', async () => {
    const { getThreadFilteredEvents } = await import('./RoomTimeline');
    const room = makeRoom();
    const fakeReply = makeEvent('$reply-event', {
      threadRootId: '$actual-root',
    });
    const actualRoot = makeEvent('$actual-root');
    const fallbackCounts = new Map([
      [fakeReply.getId(), 1],
      [actualRoot.getId(), 1],
    ]);
    const resolutionMap = new Map<string, { isResolved: boolean }>([
      ['$reply-event', { isResolved: false, tags: null }],
      ['$actual-root', { isResolved: false, tags: null }],
    ]);

    expect(
      getThreadFilteredEvents(
        [fakeReply, actualRoot] as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
        fallbackCounts,
        new Map([
          ['$reply-event', makeThreadFilterRecord('$reply-event')],
          ['$actual-root', makeThreadFilterRecord('$actual-root')],
        ])
      ).map((event) => event.getId())
    ).toEqual(['$actual-root']);
  });

  it('filters hidden relations, thread replies, and ignored senders in isRenderableEvent', async () => {
    const { isRenderableEvent } = await import('./RoomTimeline');
    const baseArgs = [
      makeRoom() as never,
      undefined,
      new Set<string>(),
      false,
      false,
      false,
    ] as const;

    const messageEvent = makeEvent('$message');
    expect(isRenderableEvent(messageEvent as never, ...baseArgs)).toBe(true);

    const threadReply = makeEvent('$thread-reply', { threadRootId: '$thread-root' });
    expect(isRenderableEvent(threadReply as never, ...baseArgs)).toBe(false);

    const relationEvent = makeEvent('$edit', {
      associatedId: '$message',
      relation: { rel_type: 'm.replace', event_id: '$message' },
    });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === relationEvent.getId());
    expect(isRenderableEvent(relationEvent as never, ...baseArgs)).toBe(false);

    const ignoredEvent = makeEvent('$ignored', { sender: '@ignored:example.org' });
    expect(
      isRenderableEvent(
        ignoredEvent as never,
        makeRoom() as never,
        undefined,
        new Set(['@ignored:example.org']),
        false,
        false,
        false
      )
    ).toBe(false);
  });

  it('applies membership and hidden-event toggles in isRenderableEvent', async () => {
    const { isRenderableEvent } = await import('./RoomTimeline');
    const room = makeRoom();
    const membershipEvent = makeEvent('$member', { type: 'm.room.member' });
    isMembershipChangedMock.mockReturnValue(true);

    expect(
      isRenderableEvent(
        membershipEvent as never,
        room as never,
        undefined,
        new Set(),
        false,
        true,
        false
      )
    ).toBe(false);

    isMembershipChangedMock.mockReturnValue(false);
    expect(
      isRenderableEvent(
        membershipEvent as never,
        room as never,
        undefined,
        new Set(),
        false,
        false,
        true
      )
    ).toBe(false);

    const hiddenEvent = makeEvent('$hidden', {
      type: 'io.example.hidden',
      content: { body: 'hidden' },
    });
    expect(
      isRenderableEvent(hiddenEvent as never, room as never, undefined, new Set(), false, false, false)
    ).toBe(false);
    expect(
      isRenderableEvent(hiddenEvent as never, room as never, undefined, new Set(), true, false, false)
    ).toBe(true);

    const toolApprovalEvent = makeEvent('$approval', {
      type: 'io.mindroom.tool_approval',
      content: {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
      },
    });
    expect(
      isRenderableEvent(
        toolApprovalEvent as never,
        room as never,
        undefined,
        new Set(),
        false,
        false,
        false
      )
    ).toBe(true);
  });

  it('keeps filtered mode pinned to the full filtered range when live non-matching events arrive', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const unresolvedEvents = [
      makeEvent('$thread-1', { isThreadRoot: true }),
      makeEvent('$thread-2', { isThreadRoot: true }),
      makeEvent('$thread-3', { isThreadRoot: true }),
    ];
    const liveEvents = [...unresolvedEvents, makeEvent('$message-1')];
    const room = makeRoom({ liveEvents });
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.count).toBe(3);
    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 3 });

    const liveEventHandler = room.__listeners.get(RoomEvent.Timeline);
    expect(liveEventHandler).toBeTypeOf('function');

    liveEvents.push(makeEvent('$message-2'));

    await act(async () => {
      liveEventHandler?.(liveEvents[liveEvents.length - 1], room, false, false, {
        liveEvent: true,
      });
      await flushAsyncWork(1);
    });

    await waitForCondition(
      () =>
        virtualPaginatorState.lastOptions?.count === 3 &&
        virtualPaginatorState.lastOptions?.range?.start === 0 &&
        virtualPaginatorState.lastOptions?.range?.end === 3,
      50
    );
    expect(virtualPaginatorState.lastOptions?.count).toBe(3);
    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 3 });
  });

  it('re-renders the room timeline for non-renderable live events at bottom', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleMessage = makeEvent('$message');
    const hiddenEdit = makeEvent('$edit', {
      associatedId: visibleMessage.getId(),
      relation: { rel_type: 'm.replace', event_id: visibleMessage.getId() },
    });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
    const room = makeRoom({ liveEvents: [visibleMessage] });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    const callCountBefore = virtualPaginatorState.callCount;
    const liveEventHandler = room.__listeners.get(RoomEvent.Timeline);
    expect(liveEventHandler).toBeTypeOf('function');

    await act(async () => {
      liveEventHandler?.(hiddenEdit, room, false, false, {
        liveEvent: true,
      });
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.callCount).toBeGreaterThan(callCountBefore);

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });


  });
});
