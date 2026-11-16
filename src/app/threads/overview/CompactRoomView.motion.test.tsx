// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { standInForListMotion } from '../../ui/__tests__/listMotionStandIn';
import { CompactRoomView } from './CompactRoomView';

const ROOM_ID = '!room:example.org';

const state = vi.hoisted(() => ({ pinned: [] as string[] }));

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
    pinnedEventIds: state.pinned,
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
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const room = { roomId: ROOM_ID } as unknown as Room;
const list = (threadRootIds: string[], filterBarShown = false) => (
  <CompactRoomView
    room={room}
    filterBarShown={filterBarShown}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: new Map() }}
  />
);

let motion: ReturnType<typeof standInForListMotion>;
/** The cards whose moving part glided. */
const glided = () =>
  motion.glided().map((rootId) => {
    const row = document.querySelector(`[data-motion-row="${rootId ?? ''}"]`);
    // A card moves by the element inside the one the scroll position is measured on.
    expect(row?.hasAttribute('data-scroll-anchor')).toBe(false);
    return row?.parentElement?.getAttribute('data-scroll-anchor');
  });

beforeEach(() => {
  state.pinned = [];
  motion = standInForListMotion();
});

afterEach(() => {
  cleanup();
  motion.restore();
});

describe('the compact thread list in motion', () => {
  it('glides the cards after one that left, and fades that one where it stood', () => {
    const { rerender } = render(list(['$a', '$b', '$c']));
    rerender(list(['$a', '$c']));

    expect(glided()).toEqual(['$c']);
    const [left] = motion.left();
    expect(left?.textContent).toContain('$b');
    // The card that fades is no card to the list: nothing restores the scroll against it.
    expect(left?.closest('[data-scroll-anchor]')).toBeNull();
    expect(left?.querySelector('[data-scroll-anchor]')).toBeNull();
  });

  it('glides two cards that swap', () => {
    const { rerender } = render(list(['$a', '$b']));
    rerender(list(['$b', '$a']));

    expect(glided().sort()).toEqual(['$a', '$b']);
  });

  it('reads the cards when the filter bar comes or goes, which moves them all', () => {
    /** How often a card's moving part was measured. */
    const readsOfCards = () =>
      motion.rects.mock.contexts.filter((element) =>
        (element as HTMLElement).hasAttribute('data-motion-row')
      ).length;
    const { rerender } = render(list(['$a', '$b']));
    motion.rects.mockClear();
    rerender(list(['$a', '$b']));
    expect(readsOfCards()).toBe(0);

    rerender(list(['$a', '$b'], true));

    // Before the change and after it, to play each card from where it was.
    expect(readsOfCards()).toBeGreaterThan(0);
  });

  it('glides a card into the Pinned section', () => {
    const { rerender } = render(list(['$a', '$b', '$c']));
    state.pinned = ['$c'];
    rerender(list(['$a', '$b', '$c']));

    expect(glided().sort()).toEqual(['$a', '$b', '$c']);
  });
});
