// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompactThreadCardViewModel,
  ThreadRecord,
  ThreadStatusSnapshot,
} from '../../event-store/threads/types';
import {
  createDefaultThreadFilterState,
  selectThreadWorkflowTab,
} from '../../event-store/threads/roomThreadOverviewModel';
import { matchesThreadRecordFilterState } from '../../event-store/threads/threadRecordOverview';
import { clearCompactRoomSectionsStore } from './compactRoomSections';
import { CompactRoomView } from './CompactRoomView';

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';
const T0 = 1_000_000;
const WAKE = T0 + 60_000;

const viewModel = (threadRootId: string): CompactThreadCardViewModel => ({
  id: { roomId: ROOM_ID, threadRootId },
  titleText: threadRootId,
  displayTitleText: threadRootId,
  previewText: 'No replies yet',
  messageCount: 0,
  messageCountLabel: '0 replies',
  messageCountText: '0',
  attentionState: 'idle',
  attentionStatusText: 'Idle',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
});

vi.mock('../cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({ read: () => undefined }),
}));
vi.mock('./compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: ({ threadRootIds }: { threadRootIds: string[] }) =>
    threadRootIds.map(viewModel),
}));
vi.mock('../tags/useRoomThreadTags', () => ({
  useToggleThreadResolution: () => ({
    canToggle: false,
    setResolved: vi.fn(),
    updatingThreadRootIds: new Set(),
    error: undefined,
  }),
}));
vi.mock('../../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({
    canPin: true,
    pinnedEventIds: [],
    setPinned: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));
vi.mock('../useInitializeShownThread', () => ({ useInitializeShownThread: () => undefined }));
vi.mock('./useThreadRootLiveCallRow', () => ({ useThreadRootLiveCallRow: () => undefined }));
vi.mock('./ThreadCardBadges', () => ({ ThreadCardBadges: () => null }));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({ ThreadActionsMenu: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
vi.mock('./ThreadCardDetails', () => ({ ThreadCardDetails: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const room = { roomId: ROOM_ID, myUserId: ME, client: {} } as unknown as Room;

const record = (rootId: string, status: Partial<ThreadStatusSnapshot> = {}): ThreadRecord =>
  ({
    roomId: ROOM_ID,
    threadRootId: rootId,
    status: { isStreaming: false, isResolved: false, scheduledTaskCount: 0, tags: [], ...status },
    cache: {},
  } as unknown as ThreadRecord);

const records = new Map(
  [record('$read', { lastActivityTs: 10 }), record('$snoozed', { snoozedUntilTs: WAKE })].map(
    (item) => [item.threadRootId, item] as const
  )
);
const needsYou = selectThreadWorkflowTab(createDefaultThreadFilterState(), 'needsYou');
/** The Needs you tab's cards at the index's snooze clock `now`, as `useThreadIndex` lists them. */
const listedAt = (now: number) =>
  [...records.values()]
    .filter((item) => matchesThreadRecordFilterState(item, needsYou, now))
    .map((item) => item.threadRootId);

const view = (now: number) => (
  <CompactRoomView
    room={room}
    threadRootIds={listedAt(now)}
    threadRecordMap={records}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: new Map() }}
    sectionsNow={now}
  />
);

const rows = () =>
  [...document.querySelectorAll<HTMLElement>('[data-compact-section], [data-scroll-anchor]')].map(
    (row) =>
      row.dataset.compactSection !== undefined
        ? `#${row.dataset.compactSection}`
        : row.dataset.scrollAnchor
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearCompactRoomSectionsStore(ME);
  localStorage.clear();
});

describe('Compact sections and the snooze clock of the list', () => {
  it('puts a card whose snooze ended under Needs you while the order is held', () => {
    const { rerender } = render(view(T0));
    expect(rows()).toEqual(['#needsYou', '$read']);
    const list = document.querySelector<HTMLElement>('[data-compact-room-view] > div')!;
    act(() => {
      fireEvent.pointerEnter(list);
    });

    // The snooze ends: the index's clock renews, and the Needs you tab lists the thread again.
    vi.setSystemTime(WAKE + 1);
    rerender(view(WAKE + 1));
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(rows()).toEqual(['#needsYou', '$read', '$snoozed']);
  });
});
