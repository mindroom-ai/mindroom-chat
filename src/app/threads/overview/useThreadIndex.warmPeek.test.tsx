// @vitest-environment jsdom
import { Activity } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { createClient, MatrixEvent, Room, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncEngine } from '../../event-store/engine/syncEngine';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../../event-store/timeline/roomTimelineViewState';
import * as threadRecordModule from '../../event-store/threads/threadRecord';
import { loadRoomThreads } from '../../event-store/threads/roomThreadList';
import { PaneCollapsedContext } from '../../lib/hooks/usePaneCollapsed';
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

const makeMessage = (roomId: string, eventId: string, body: string, ts: number) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: roomId,
    event_id: eventId,
    sender: '@member:example.org',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body },
  });

describe('warm Activity back-peek invariant', () => {
  it('performs 0 buildThreadRecordMap rebuilds on warm reveal and during live sync events while peeking, then flushes cleanly on commit', async () => {
    const mx = createClient({
      baseUrl: 'https://matrix.example.org',
      userId: '@self:example.org',
    });
    const engine = createSyncEngine({ mx });
    const roomId = '!warm-peek:example.org';
    const room = new Room(roomId, mx, '@self:example.org');
    const rootEvent = makeMessage(roomId, '$root-1', 'First topic', 1_000);
    await room.addLiveEvents([rootEvent], { addToState: false });
    const linkedTimelines = [room.getLiveTimeline()];
    const renderableEventEntries = [{ event: rootEvent, absoluteIndex: 0 }];

    const buildSpy = vi.spyOn(threadRecordModule, 'buildThreadRecordMap');
    const loadThreadsMock = vi.mocked(loadRoomThreads);
    loadThreadsMock.mockClear();

    let lastCompactIds: string[] = [];
    let lastRootSummary: string | undefined;
    let waitedCount = 0;

    function WarmCompactRoom({ summaryMap }: { summaryMap: Map<string, ThreadSummaryInfo> }) {
      const listened = useThreadOverviewListenedFirst(room, undefined, true);
      if (listened === 'waiting') {
        waitedCount += 1;
        return null;
      }
      return <WarmCompactRoomBody listened={listened!} summaryMap={summaryMap} />;
    }

    function WarmCompactRoomBody({
      listened,
      summaryMap,
    }: {
      listened: NonNullable<Exclude<ReturnType<typeof useThreadOverviewListenedFirst>, 'waiting'>>;
      summaryMap: Map<string, ThreadSummaryInfo>;
    }) {
      const index = useThreadIndex({
        room,
        threadId: undefined,
        eventId: undefined,
        focusedRoomOverviewRequested: false,
        compactViewRequested: true,
        effectiveViewMode: 'compact',
        linkedTimelines,
        renderableEventEntries,
        ignoredUsersSet: EMPTY_IGNORED,
        showHiddenEvents: false,
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
        summaryMap,
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
      lastCompactIds = index.compactThreadRootData.ids;
      lastRootSummary =
        index.compactThreadRecordMap.get('$root-1')?.presentation.summaryInfo?.summaryText;
      return <div data-testid="warm-compact">{index.compactThreadRootData.ids.join(',')}</div>;
    }

    const queryClient = new QueryClient();
    const summaryV1 = new Map<string, ThreadSummaryInfo>();
    const wrap = (
      mode: 'visible' | 'hidden',
      collapsed: boolean,
      summaryMap: Map<string, ThreadSummaryInfo>
    ) => (
      <QueryClientProvider client={queryClient}>
        <MatrixClientProvider value={mx}>
          <SyncEngineProvider engine={engine}>
            <PaneCollapsedContext.Provider value={collapsed}>
              <Activity mode={mode}>
                <WarmCompactRoom summaryMap={summaryMap} />
              </Activity>
            </PaneCollapsedContext.Provider>
          </SyncEngineProvider>
        </MatrixClientProvider>
      </QueryClientProvider>
    );

    // 1. Active warm room builds its thread index once.
    let rendered!: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(wrap('visible', false, summaryV1));
      await Promise.resolve();
    });
    expect(buildSpy.mock.calls.length).toBeGreaterThan(0);
    expect(lastCompactIds).toEqual(['$root-1']);
    expect(loadThreadsMock).toHaveBeenCalledTimes(1);

    // 2. Open thread -> park warm room in Activity hidden.
    rendered.rerender(wrap('hidden', true, summaryV1));

    // Mutate room while parked (new thread + updated summaryMap).
    const secondRoot = makeMessage(roomId, '$root-2', 'Second topic', 2_000);
    await room.addLiveEvents([secondRoot], { addToState: false });
    const summaryV2 = new Map<string, ThreadSummaryInfo>([
      ['$root-1', { summaryText: 'Updated title', messageCount: 2, eventTs: 2_500 }],
    ]);

    buildSpy.mockClear();
    loadThreadsMock.mockClear();
    waitedCount = 0;

    // 3. Swipe-back peek reveals warm Activity with PaneCollapsedContext=true:
    //    must NOT reset to waiting, must perform 0 buildThreadRecordMap rebuilds and 0 loadRoomThreads.
    rendered.rerender(wrap('visible', true, summaryV2));
    expect(waitedCount).toBe(0);
    expect(buildSpy).not.toHaveBeenCalled();
    expect(loadThreadsMock).not.toHaveBeenCalled();

    // Live sync events while dragging must also trigger 0 rebuilds.
    act(() => {
      room.emit(RoomEvent.Receipt, undefined as unknown as MatrixEvent, room);
      room.emit(ThreadEvent.Update, undefined as never);
    });
    expect(buildSpy).not.toHaveBeenCalled();
    expect(loadThreadsMock).not.toHaveBeenCalled();

    // 4. Cancel swipe -> re-hide Activity: still 0 rebuilds.
    rendered.rerender(wrap('hidden', true, summaryV2));
    expect(buildSpy).not.toHaveBeenCalled();

    // 5. Commit swipe -> visible & uncollapsed: flushes buffered updates cleanly and refreshes.
    await act(async () => {
      rendered.rerender(wrap('visible', false, summaryV2));
      await Promise.resolve();
    });
    expect(buildSpy).toHaveBeenCalled();
    expect(loadThreadsMock).toHaveBeenCalledTimes(1);
    expect(lastCompactIds).toContain('$root-1');
    expect(lastRootSummary).toBe('Updated title');
  });
});
