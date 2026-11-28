// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { createClient, MatrixEvent, Room, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncEngine } from '../../event-store/engine/syncEngine';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import * as roomThreadListModule from '../../event-store/threads/roomThreadList';
import * as threadRecordModule from '../../event-store/threads/threadRecord';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../../event-store/timeline/roomTimelineViewState';
import { PassivePeekContext } from '../../lib/hooks/usePaneCollapsed';
import { keepRedactionsInSavedSync } from '../../matrix/client/savedSyncRedactions';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { useThreadOverviewListenedFirst } from './threadOverviewRefreshCounter';
import { useThreadIndex } from './useThreadIndex';

vi.mock('../../event-store/threads/roomThreadList', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../event-store/threads/roomThreadList')>()),
  loadRoomThreads: vi.fn(async () => undefined),
}));
vi.mock('../../event-store/cache/eventRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../event-store/cache/eventRepository')>()),
  loadCachedThreadRootsForRoom: vi.fn(async () => []),
  loadLatestCachedThreadEventsBatch: vi.fn(async () => new Map()),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EMPTY_IGNORED = new Set<string>();
const EMPTY_RESOLUTIONS = new Map();
const NOOP = () => undefined;
const msg = (roomId: string, eventId: string, body: string, ts: number) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: roomId,
    event_id: eventId,
    sender: '@member:example.org',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body },
  });

describe('passive back-peek warm snapshot reuse', () => {
  it('reuses warm snapshot in O(1) across remounts, bypasses cache on Compact focusEventInRoom peeks, misses on filter change, and rebuilds fresh on commit', async () => {
    const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@self:example.org' });
    const engine = createSyncEngine({ mx });
    const roomId = '!warm-peek:example.org';
    const room = new Room(roomId, mx, '@self:example.org');
    const root1 = msg(roomId, '$root-1', 'First topic', 1_000);
    await room.addLiveEvents([root1], { addToState: false });
    const linkedTimelines = [room.getLiveTimeline()];
    let entries = [{ event: root1, absoluteIndex: 0 }];

    const buildSpy = vi.spyOn(threadRecordModule, 'buildThreadRecordMap');
    const sortSpy = vi.spyOn(roomThreadListModule, 'sortThreadsByActivity');
    const loadThreadsMock = vi.mocked(roomThreadListModule.loadRoomThreads);
    loadThreadsMock.mockClear();

    let lastCompactIds: string[] = [];
    let lastRootSummary: string | undefined;
    let waitedCount = 0;

    type Props = {
      summaryMap: Map<string, ThreadSummaryInfo>;
      filter?: typeof DIRECT_ROOM_TIMELINE_FILTER_STATE;
      eventId?: string;
      focusEventInRoom?: boolean;
    };
    function WarmBody({
      listened,
      summaryMap,
      filter = DIRECT_ROOM_TIMELINE_FILTER_STATE,
      eventId,
      focusEventInRoom,
    }: Props & {
      listened: NonNullable<Exclude<ReturnType<typeof useThreadOverviewListenedFirst>, 'waiting'>>;
    }) {
      const index = useThreadIndex({
        room,
        threadId: undefined,
        eventId,
        focusEventInRoom,
        focusedRoomOverviewRequested: false,
        compactViewRequested: true,
        effectiveViewMode: 'compact',
        linkedTimelines,
        renderableEventEntries: entries,
        ignoredUsersSet: EMPTY_IGNORED,
        showHiddenEvents: false,
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
        summaryMap,
        threadResolutionMap: EMPTY_RESOLUTIONS,
        currentUserId: '@self:example.org',
        requestedThreadFilterState: filter,
        threadSortFreezeState: null,
        overviewRefreshCounter: listened.overviewRefreshCounter,
        overviewChanges: listened.overviewChanges,
        sessionId: engine.sessionId,
        mx,
        onStoreThreadSummary: NOOP,
      });
      lastCompactIds = index.compactOverviewOrdering.displayOrderedIds;
      lastRootSummary =
        index.compactThreadRecordMap.get('$root-1')?.presentation.summaryInfo?.summaryText;
      return <div data-testid="warm-compact">{lastCompactIds.join(',')}</div>;
    }
    function WarmCompactRoom(props: Props) {
      const listened = useThreadOverviewListenedFirst(room, undefined, true);
      if (listened === 'waiting') {
        waitedCount += 1;
        return null;
      }
      return <WarmBody listened={listened!} {...props} />;
    }

    const queryClient = new QueryClient();
    const wrap = (
      mounted: boolean,
      passive: boolean,
      summaryMap: Map<string, ThreadSummaryInfo>,
      filter = DIRECT_ROOM_TIMELINE_FILTER_STATE,
      focus?: { eventId: string; focusEventInRoom: boolean }
    ) => (
      <QueryClientProvider client={queryClient}>
        <MatrixClientProvider value={mx}>
          <SyncEngineProvider engine={engine}>
            <PassivePeekContext.Provider value={passive}>
              {mounted ? (
                <WarmCompactRoom
                  summaryMap={summaryMap}
                  filter={filter}
                  eventId={focus?.eventId}
                  focusEventInRoom={focus?.focusEventInRoom}
                />
              ) : null}
            </PassivePeekContext.Provider>
          </SyncEngineProvider>
        </MatrixClientProvider>
      </QueryClientProvider>
    );

    const summaryV1 = new Map<string, ThreadSummaryInfo>();
    let rendered!: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(wrap(true, false, summaryV1));
      await Promise.resolve();
    });
    expect(buildSpy).toHaveBeenCalled();
    expect(sortSpy).toHaveBeenCalled();
    expect(loadThreadsMock).toHaveBeenCalledTimes(1);
    expect(lastCompactIds).toEqual(['$root-1']);

    // Unmount (thread opens), mutate room while unmounted, then remount for passive back-peek.
    rendered.rerender(wrap(false, false, summaryV1));
    const root2 = msg(roomId, '$root-2', 'Second topic', 2_000);
    await room.addLiveEvents([root2], { addToState: false });
    entries = [
      { event: root1, absoluteIndex: 0 },
      { event: root2, absoluteIndex: 1 },
    ];
    const summaryV2 = new Map<string, ThreadSummaryInfo>([
      ['$root-1', { summaryText: 'Updated title', messageCount: 2, eventTs: 2_500 }],
    ]);

    buildSpy.mockClear();
    sortSpy.mockClear();
    loadThreadsMock.mockClear();
    waitedCount = 0;

    rendered.rerender(wrap(true, true, summaryV2));
    expect(waitedCount).toBe(0);
    expect(buildSpy).not.toHaveBeenCalled();
    expect(sortSpy).not.toHaveBeenCalled();
    expect(loadThreadsMock).not.toHaveBeenCalled();
    expect(lastCompactIds).toEqual(['$root-1']);

    // Live sync events while dragging trigger 0 rebuilds/sorts/loads.
    act(() => {
      room.emit(RoomEvent.Receipt, undefined as unknown as MatrixEvent, room);
      room.emit(ThreadEvent.Update, undefined as never);
    });
    expect(buildSpy).not.toHaveBeenCalled();
    expect(sortSpy).not.toHaveBeenCalled();
    expect(loadThreadsMock).not.toHaveBeenCalled();

    // Compact focus back-peek (focusEventInRoom + eventId) bypasses warm caches for both
    // useThreadIndex and useRoomThreadList so a newly created thread card is present before commit.
    const reply2 = new MatrixEvent({
      type: 'm.room.message',
      room_id: roomId,
      event_id: '$reply-2',
      sender: '@member:example.org',
      origin_server_ts: 2_100,
      content: {
        msgtype: 'm.text',
        body: 'Reply in new thread',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root-2' },
      },
    });
    const thread2 = room.createThread('$root-2', root2, [], false);
    thread2.addEvents([reply2], false);
    rendered.rerender(wrap(false, false, summaryV2));
    rendered.rerender(
      wrap(true, true, summaryV2, DIRECT_ROOM_TIMELINE_FILTER_STATE, {
        eventId: '$root-2',
        focusEventInRoom: true,
      })
    );
    expect(buildSpy).toHaveBeenCalled();
    expect(sortSpy).toHaveBeenCalled();
    expect(loadThreadsMock).not.toHaveBeenCalled();
    expect(lastCompactIds).toEqual(expect.arrayContaining(['$root-1', '$root-2']));

    // Filter mismatch during passive peek misses cache cleanly.
    buildSpy.mockClear();
    rendered.rerender(wrap(false, false, summaryV2));
    rendered.rerender(
      wrap(true, true, summaryV2, { ...DIRECT_ROOM_TIMELINE_FILTER_STATE, freeText: 'second' })
    );
    expect(buildSpy).toHaveBeenCalled();

    // Matching passive peek -> commit (passive: true -> false) with focusEventInRoom + eventId
    // still on the URL refreshes warm caches on commit so a subsequent unfocused passive peek
    // serves the updated snapshot containing $root-2 in O(1).
    rendered.rerender(wrap(false, false, summaryV2));
    buildSpy.mockClear();
    loadThreadsMock.mockClear();
    rendered.rerender(wrap(true, true, summaryV2));
    expect(buildSpy).not.toHaveBeenCalled();
    await act(async () => {
      rendered.rerender(
        wrap(true, false, summaryV2, DIRECT_ROOM_TIMELINE_FILTER_STATE, {
          eventId: '$root-2',
          focusEventInRoom: true,
        })
      );
      await Promise.resolve();
    });
    expect(buildSpy).toHaveBeenCalled();
    expect(loadThreadsMock).toHaveBeenCalledTimes(1);
    expect(lastCompactIds).toEqual(expect.arrayContaining(['$root-1', '$root-2']));
    expect(lastRootSummary).toBe('Updated title');

    // Subsequent unfocused passive peek (after opening a card from the committed focused room)
    // must hit the updated warm cache and still include $root-2 in O(1).
    rendered.rerender(wrap(false, false, summaryV2));
    buildSpy.mockClear();
    sortSpy.mockClear();
    rendered.rerender(wrap(true, true, summaryV2));
    expect(buildSpy).not.toHaveBeenCalled();
    expect(sortSpy).not.toHaveBeenCalled();
    expect(lastCompactIds).toEqual(expect.arrayContaining(['$root-1', '$root-2']));
  });

  it('invalidates the warm peek cache on ordinary reply redaction via addLiveEvents with zero persistent RoomEvent.Redaction listeners', async () => {
    const mx = createClient({
      baseUrl: 'https://matrix.example.org',
      userId: '@self:example.org',
    });
    vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
    const engine = createSyncEngine({ mx });
    const roomId = '!redaction-peek:example.org';
    const room = new Room(roomId, mx, '@self:example.org', { timelineSupport: true });
    mx.reEmitter.reEmit(room, [RoomEvent.Redaction]);
    const stopRedactions = keepRedactionsInSavedSync(mx);
    const root = msg(roomId, '$root-r1', 'Topic root', 1_000);
    const secretReply = new MatrixEvent({
      type: 'm.room.message',
      room_id: roomId,
      event_id: '$reply-secret',
      sender: '@member:example.org',
      origin_server_ts: 2_000,
      content: {
        msgtype: 'm.text',
        body: 'Secret reply to delete',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root-r1' },
      },
    });
    await room.addLiveEvents([root], { addToState: false });
    const thread = room.createThread('$root-r1', root, [], false);
    thread.addEvents([secretReply], false);
    const baseRedactionListeners = room.listenerCount(RoomEvent.Redaction);
    const linkedTimelines = [room.getLiveTimeline()];
    const entries = [{ event: root, absoluteIndex: 0 }];
    const buildSpy = vi.spyOn(threadRecordModule, 'buildThreadRecordMap');
    let lastPreview: string | undefined;

    function RedactionRoom() {
      const listened = useThreadOverviewListenedFirst(room, undefined, true);
      if (listened === 'waiting') return null;
      return <RedactionRoomBody listened={listened!} />;
    }
    function RedactionRoomBody({
      listened,
    }: {
      listened: NonNullable<Exclude<ReturnType<typeof useThreadOverviewListenedFirst>, 'waiting'>>;
    }) {
      const index = useThreadIndex({
        room,
        threadId: undefined,
        eventId: undefined,
        focusedRoomOverviewRequested: false,
        compactViewRequested: true,
        effectiveViewMode: 'compact',
        linkedTimelines,
        renderableEventEntries: entries,
        ignoredUsersSet: EMPTY_IGNORED,
        showHiddenEvents: false,
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
        summaryMap: new Map(),
        threadResolutionMap: EMPTY_RESOLUTIONS,
        currentUserId: '@self:example.org',
        requestedThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
        threadSortFreezeState: null,
        overviewRefreshCounter: listened.overviewRefreshCounter,
        overviewChanges: listened.overviewChanges,
        sessionId: engine.sessionId,
        mx,
        onStoreThreadSummary: NOOP,
      });
      lastPreview =
        index.compactThreadRecordMap.get('$root-r1')?.presentation.latestReplyPreviewText;
      return null;
    }

    const queryClient = new QueryClient();
    const wrap = (mounted: boolean, passive: boolean) => (
      <QueryClientProvider client={queryClient}>
        <MatrixClientProvider value={mx}>
          <SyncEngineProvider engine={engine}>
            <PassivePeekContext.Provider value={passive}>
              {mounted ? <RedactionRoom /> : null}
            </PassivePeekContext.Provider>
          </SyncEngineProvider>
        </MatrixClientProvider>
      </QueryClientProvider>
    );

    let rendered!: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(wrap(true, false));
      await Promise.resolve();
    });
    expect(lastPreview).toBe('Secret reply to delete');

    // Unmount room (thread is open): zero persistent RoomEvent.Redaction listeners remain.
    rendered.rerender(wrap(false, false));
    expect(room.listenerCount(RoomEvent.Redaction)).toBe(baseRedactionListeners);

    // Deliver the reply redaction through room.addLiveEvents while unmounted.
    const redaction = new MatrixEvent({
      type: 'm.room.redaction',
      room_id: roomId,
      event_id: '$redaction-1',
      sender: '@member:example.org',
      origin_server_ts: 3_000,
      redacts: '$reply-secret',
      content: { redacts: '$reply-secret' },
    });
    await room.addLiveEvents([redaction], { addToState: false });
    expect(secretReply.isRedacted()).toBe(true);
    expect(room.listenerCount(RoomEvent.Redaction)).toBe(baseRedactionListeners);

    // Passive back-peek must invalidate the warm cache and never preview deleted reply text.
    buildSpy.mockClear();
    rendered.rerender(wrap(true, true));
    expect(buildSpy).toHaveBeenCalled();
    expect(lastPreview).not.toBe('Secret reply to delete');

    rendered.unmount();
    stopRedactions();
    expect(mx.listenerCount(RoomEvent.Redaction)).toBe(0);
    expect(room.listenerCount(RoomEvent.Redaction)).toBe(baseRedactionListeners);
  });

  it('invalidates the warm peek cache when a bundled edit is redacted via addLiveEvents without emitting RoomEvent.Redaction', async () => {
    const mx = createClient({
      baseUrl: 'https://matrix.example.org',
      userId: '@self:example.org',
    });
    vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
    const engine = createSyncEngine({ mx });
    const roomId = '!bundled-edit-redaction-peek:example.org';
    const room = new Room(roomId, mx, '@self:example.org', { timelineSupport: true });
    mx.reEmitter.reEmit(room, [RoomEvent.Redaction]);
    const stopRedactions = keepRedactionsInSavedSync(mx);
    const baseRedactionListeners = room.listenerCount(RoomEvent.Redaction);
    const editedRoot = mx.getEventMapper()({
      type: 'm.room.message',
      room_id: roomId,
      event_id: '$root-be1',
      sender: '@member:example.org',
      origin_server_ts: 1_000,
      content: { msgtype: 'm.text', body: 'Original safe text' },
      unsigned: {
        'm.relations': {
          'm.replace': {
            type: 'm.room.message',
            room_id: roomId,
            event_id: '$edit-bundled-1',
            sender: '@member:example.org',
            origin_server_ts: 1_500,
            content: {
              msgtype: 'm.text',
              body: '* Retracted edit text',
              'm.new_content': { msgtype: 'm.text', body: 'Retracted edit text' },
              'm.relates_to': { rel_type: 'm.replace', event_id: '$root-be1' },
            },
          },
        },
      },
    });
    await room.addLiveEvents([editedRoot], { addToState: false });
    const linkedTimelines = [room.getLiveTimeline()];
    const entries = [{ event: editedRoot, absoluteIndex: 0 }];
    const buildSpy = vi.spyOn(threadRecordModule, 'buildThreadRecordMap');
    let lastRootPreview: string | undefined;

    function BundledEditRoom() {
      const listened = useThreadOverviewListenedFirst(room, undefined, true);
      if (listened === 'waiting') return null;
      return <BundledEditRoomBody listened={listened!} />;
    }
    function BundledEditRoomBody({
      listened,
    }: {
      listened: NonNullable<Exclude<ReturnType<typeof useThreadOverviewListenedFirst>, 'waiting'>>;
    }) {
      const index = useThreadIndex({
        room,
        threadId: undefined,
        eventId: undefined,
        focusedRoomOverviewRequested: false,
        compactViewRequested: true,
        effectiveViewMode: 'compact',
        linkedTimelines,
        renderableEventEntries: entries,
        ignoredUsersSet: EMPTY_IGNORED,
        showHiddenEvents: false,
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
        summaryMap: new Map(),
        threadResolutionMap: EMPTY_RESOLUTIONS,
        currentUserId: '@self:example.org',
        requestedThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
        threadSortFreezeState: null,
        overviewRefreshCounter: listened.overviewRefreshCounter,
        overviewChanges: listened.overviewChanges,
        sessionId: engine.sessionId,
        mx,
        onStoreThreadSummary: NOOP,
      });
      lastRootPreview = index.compactThreadRecordMap.get('$root-be1')?.presentation.rootPreviewText;
      return null;
    }

    const queryClient = new QueryClient();
    const wrap = (mounted: boolean, passive: boolean) => (
      <QueryClientProvider client={queryClient}>
        <MatrixClientProvider value={mx}>
          <SyncEngineProvider engine={engine}>
            <PassivePeekContext.Provider value={passive}>
              {mounted ? <BundledEditRoom /> : null}
            </PassivePeekContext.Provider>
          </SyncEngineProvider>
        </MatrixClientProvider>
      </QueryClientProvider>
    );

    let rendered!: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(wrap(true, false));
      await Promise.resolve();
    });
    expect(lastRootPreview).toBe('Retracted edit text');

    // Unmount room and redact the bundled edit via addLiveEvents:
    // room.redactedBundledEdits grows without emitting RoomEvent.Redaction.
    rendered.rerender(wrap(false, false));
    const redactionEventSpy = vi.fn();
    room.on(RoomEvent.Redaction, redactionEventSpy);
    const redactionOfBundledEdit = new MatrixEvent({
      type: 'm.room.redaction',
      room_id: roomId,
      event_id: '$redaction-bundled-edit',
      sender: '@member:example.org',
      origin_server_ts: 2_500,
      redacts: '$edit-bundled-1',
      content: { redacts: '$edit-bundled-1' },
    });
    await room.addLiveEvents([redactionOfBundledEdit], { addToState: false });
    room.removeListener(RoomEvent.Redaction, redactionEventSpy);
    expect(redactionEventSpy).not.toHaveBeenCalled();
    expect(room.redactedBundledEdits.size).toBe(1);
    expect(room.redactedBundledEdits.has('$edit-bundled-1')).toBe(true);

    // Passive back-peek must invalidate the warm cache and show the original text before commit.
    buildSpy.mockClear();
    rendered.rerender(wrap(true, true));
    expect(buildSpy).toHaveBeenCalled();
    expect(lastRootPreview).toBe('Original safe text');

    rendered.unmount();
    stopRedactions();
    expect(mx.listenerCount(RoomEvent.Redaction)).toBe(0);
    expect(room.listenerCount(RoomEvent.Redaction)).toBe(baseRedactionListeners);
  });
});
