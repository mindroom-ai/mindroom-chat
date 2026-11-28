// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import { createSyncEngine } from '../../event-store/engine/syncEngine';
import type { ThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import * as roomThreadList from '../../event-store/threads/roomThreadList';
import * as threadRecord from '../../event-store/threads/threadRecord';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../../event-store/timeline/roomTimelineViewState';
import { PassivePeekContext } from '../../lib/hooks/usePaneCollapsed';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  useThreadOverviewListenedFirst,
  useThreadOverviewRefreshCounter,
  type ThreadOverviewRefresh,
} from './threadOverviewRefreshCounter';
import { useThreadIndex, type UseThreadIndexResult } from './useThreadIndex';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('freezes matching Compact peeks and refreshes the warm snapshot when the drag commits', async () => {
  const userId = '@self:example.org';
  const roomId = '!warm-peek:example.org';
  const mx = createClient({ baseUrl: 'https://matrix.example.org', userId });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const engine = createSyncEngine({ mx });
  const room = new Room(roomId, mx, userId);
  const queryClient = new QueryClient();
  const message = (id: string, body: string, ts: number, threadId?: string) =>
    new MatrixEvent({
      type: 'm.room.message',
      room_id: roomId,
      event_id: id,
      sender: '@member:example.org',
      origin_server_ts: ts,
      content: {
        msgtype: 'm.text',
        body,
        ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
      },
    });
  const first = message('$root-1', 'First topic', 1_000);
  const second = message('$root-2', 'Second topic', 2_000);
  await room.addLiveEvents([first], { addToState: false });
  const linkedTimelines = [room.getLiveTimeline()];
  let entries = [{ event: first, absoluteIndex: 0 }];
  const ignoredUsersSet = new Set<string>();
  const threadResolutionMap = new Map();
  const summaryMap = new Map();
  const onStoreThreadSummary = () => undefined;

  const build = vi.spyOn(threadRecord, 'buildThreadRecordMap');
  const sort = vi.spyOn(roomThreadList, 'sortThreadsByActivity');
  const load = vi.spyOn(roomThreadList, 'loadRoomThreads').mockResolvedValue(undefined);
  const clearWork = () => {
    build.mockClear();
    sort.mockClear();
    load.mockClear();
  };

  type Props = { focus?: 'event' | 'overview'; filter?: ThreadFilterState };
  type IndexProps = Props & { listened: ThreadOverviewRefresh | undefined };
  let committed: UseThreadIndexResult | undefined;
  let waitingCommits = 0;
  function Index({ focus, filter = DIRECT_ROOM_TIMELINE_FILTER_STATE, listened }: IndexProps) {
    const { overviewRefreshCounter, overviewChanges } = useThreadOverviewRefreshCounter(
      room,
      undefined,
      listened
    );
    const index = useThreadIndex({
      room,
      threadId: undefined,
      eventId: focus ? '$root-2' : undefined,
      focusEventInRoom: focus === 'event',
      focusedRoomOverviewRequested: focus === 'overview',
      compactViewRequested: true,
      effectiveViewMode: 'compact',
      linkedTimelines,
      renderableEventEntries: entries,
      ignoredUsersSet,
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      summaryMap,
      threadResolutionMap,
      currentUserId: userId,
      requestedThreadFilterState: filter,
      threadSortFreezeState: null,
      overviewRefreshCounter,
      overviewChanges,
      sessionId: engine.sessionId,
      mx,
      onStoreThreadSummary,
    });
    useLayoutEffect(() => {
      committed = index;
      return () => {
        committed = undefined;
      };
    }, [index]);
    return null;
  }
  function List(props: Props) {
    const listened = useThreadOverviewListenedFirst(room, undefined, true);
    useLayoutEffect(() => {
      if (listened === 'waiting') waitingCommits += 1;
    }, [listened]);
    return listened === 'waiting' ? null : <Index {...props} listened={listened} />;
  }
  const page = (passive: boolean, props: Props | null = {}) => (
    <QueryClientProvider client={queryClient}>
      <MatrixClientProvider value={mx}>
        <SyncEngineProvider engine={engine}>
          <PassivePeekContext.Provider value={passive}>
            {props && <List {...props} />}
          </PassivePeekContext.Provider>
        </SyncEngineProvider>
      </MatrixClientProvider>
    </QueryClientProvider>
  );
  const snapshot = () => {
    if (!committed) throw new Error('Expected a committed index');
    return committed;
  };
  const cards = () => snapshot().compactOverviewOrdering.displayOrderedIds;
  const expectFrozen = (warm: UseThreadIndexResult) => {
    expect(cards()).toBe(warm.compactOverviewOrdering.displayOrderedIds);
    expect(snapshot().compactThreadRecordMap).toBe(warm.compactThreadRecordMap);
    expect(build).not.toHaveBeenCalled();
    expect(sort).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  };

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(page(false));
    await Promise.resolve();
  });
  expect(cards()).toEqual(['$root-1']);
  const frozen = snapshot();
  view.rerender(page(false, null));
  await room.addLiveEvents([second], { addToState: false });
  entries = [...entries, { event: second, absoluteIndex: 1 }];

  clearWork();
  waitingCommits = 0;
  view.rerender(page(true));
  expect(waitingCommits).toBe(0);
  expectFrozen(frozen);

  // Isolate each focus flag with the same cache key, then return to the frozen snapshot.
  for (const focus of ['event', 'overview'] as const) {
    view.rerender(page(true, { focus }));
    expect(build).toHaveBeenCalled();
    expect(sort).toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(new Set(cards())).toEqual(new Set(['$root-1', '$root-2']));
    clearWork();
    view.rerender(page(true));
    expectFrozen(frozen);
  }

  const filter = { ...DIRECT_ROOM_TIMELINE_FILTER_STATE, freeText: 'second' };
  view.rerender(page(true, { filter }));
  expect(build).toHaveBeenCalled();
  expect(cards()).toEqual(['$root-2']);

  view.rerender(page(false, null));
  clearWork();
  view.rerender(page(true));
  // Creating a thread delivers a real ThreadEvent.New while the peek is paused.
  await act(async () => {
    const reply = message('$reply-2', 'New reply', 2_100, '$root-2');
    room.createThread('$root-2', second, [reply], false);
    await Promise.resolve();
  });
  expectFrozen(frozen);

  await act(async () => {
    view.rerender(page(false));
    await Promise.resolve();
  });
  expect(build).toHaveBeenCalled();
  expect(new Set(cards())).toEqual(new Set(['$root-1', '$root-2']));
  const refreshed = snapshot();
  const presentation = refreshed.compactThreadRecordMap.get('$root-2')?.presentation;
  expect(presentation?.latestReplyPreviewText).toBe('New reply');

  view.rerender(page(false, null));
  clearWork();
  view.rerender(page(true));
  expectFrozen(refreshed);
});
