// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Direction } from 'matrix-js-sdk';
import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { Profiler } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import {
  buildThreadRecordMap,
  createThreadRecordChanges,
} from '../../event-store/threads/threadRecord';
import { filterThreadRecordRootIds } from '../../event-store/threads/threadRecordOverview';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import type { CompactRoomEmptyStateConfig } from './CompactRoomEmptyState';
import { CompactRoomView } from './CompactRoomView';
import { useRoomThreadList } from './useRoomThreadList';
import {
  bundledReply,
  createListingRoom,
  listedRoot,
  listInPages,
} from './useRoomThreadList.test.shared';

const originalListSupport = Thread.hasServerSideListSupport;
afterEach(() => {
  cleanup();
  Thread.hasServerSideListSupport = originalListSupport;
  vi.restoreAllMocks();
});

it('does not show All caught up in a cold back-peek or while the committed list is still paging', async () => {
  const request = vi.fn(() => Promise.reject(new Error('Unexpected SDK request')));
  const { mx, room, engine } = createListingRoom(request);
  const timeline = listInPages(room);
  const resolved = listedRoot('$resolved', 'File the sample');
  resolved.setUnsigned(bundledReply('$resolved-reply', '$resolved'));
  room.processThreadRoots([resolved], false);

  // The first page adds nothing to the resolved thread already held by the SDK.
  const fetch = vi.spyOn(room, 'fetchRoomThreads').mockResolvedValue(undefined);
  let releasePage!: () => void;
  const laterPage = new Promise<void>((resolve) => (releasePage = resolve));
  const paginate = vi.spyOn(mx, 'paginateEventTimeline').mockImplementation(async () => {
    await laterPage;
    const open = listedRoot('$open', 'Inspect the sample');
    open.setUnsigned(bundledReply('$open-reply', '$open'));
    room.processThreadRoots([open], false);
    timeline.setPaginationToken(null, Direction.Backward);
    return false;
  });

  const noop = () => undefined;
  const changes = createThreadRecordChanges();
  const threadResolutionMap = new Map([['$resolved', { isResolved: true, tags: null }]]);
  const memory: { current: ScrollAnchorMemory } = { current: new Map() };
  const emptyState: CompactRoomEmptyStateConfig = {
    filterState: { ...createDefaultThreadFilterState(), resolved: 'exclude' },
    now: Date.now(),
    canCompose: false,
    onReset: noop,
    onShowSnoozed: noop,
  };
  const emptyStateAttr = 'data-compact-room-empty-state';
  const emptyStateKind = () =>
    document.querySelector(`[${emptyStateAttr}]`)?.getAttribute(emptyStateAttr);
  const caughtUpCommits: ('peek' | 'committed')[] = [];
  function Compact({ peek }: { peek: boolean }) {
    const { threads, loading } = useRoomThreadList(room, true, changes, 0, peek);
    const ids = threads.map(({ id }) => id);
    const records = buildThreadRecordMap({ room, threadRootIds: ids, threadResolutionMap });
    // Room hydration is done; CompactRoomSurface passes through the list's pending state.
    return (
      <Profiler
        id="compact"
        onRender={() => {
          if (emptyStateKind() === 'inboxZero') caughtUpCommits.push(peek ? 'peek' : 'committed');
        }}
      >
        <CompactRoomView
          room={room}
          threadRootIds={filterThreadRecordRootIds(ids, emptyState.filterState, records)}
          threadRecordMap={records}
          indexPending={loading}
          compactRoomScrollStateRef={memory}
          onThreadClick={noop}
          emptyState={emptyState}
        />
      </Profiler>
    );
  }

  const { rerender } = render(<Compact peek />, {
    wrapper: ({ children }) => (
      <MatrixClientProvider value={mx}>
        <SyncEngineProvider engine={engine}>{children}</SyncEngineProvider>
      </MatrixClientProvider>
    ),
  });
  await act(async () => {});
  expect(fetch).not.toHaveBeenCalled();
  expect(paginate).not.toHaveBeenCalled();
  expect(['loading', 'inboxZero']).toContain(emptyStateKind());

  await act(async () => rerender(<Compact peek={false} />));
  expect(fetch).toHaveBeenCalledOnce();
  expect(paginate).toHaveBeenCalledOnce();

  await act(async () => releasePage());
  expect.soft(caughtUpCommits).toEqual([]);
  expect(document.querySelector('button[data-thread-root-id="$open"]')).not.toBeNull();
  expect(request).not.toHaveBeenCalled();
});
