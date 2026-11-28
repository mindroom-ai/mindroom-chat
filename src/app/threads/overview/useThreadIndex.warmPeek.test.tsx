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
    room.createThread('$root-2', root2, [reply2], true);
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

    // Matching passive peek -> commit (passive: true -> false) rebuilds fresh and runs loadRoomThreads.
    rendered.rerender(wrap(false, false, summaryV2));
    buildSpy.mockClear();
    loadThreadsMock.mockClear();
    rendered.rerender(wrap(true, true, summaryV2));
    expect(buildSpy).not.toHaveBeenCalled();
    await act(async () => {
      rendered.rerender(wrap(true, false, summaryV2));
      await Promise.resolve();
    });
    expect(buildSpy).toHaveBeenCalled();
    expect(loadThreadsMock).toHaveBeenCalledTimes(1);
    expect(lastCompactIds).toEqual(expect.arrayContaining(['$root-1', '$root-2']));
    expect(lastRootSummary).toBe('Updated title');
  });
});
