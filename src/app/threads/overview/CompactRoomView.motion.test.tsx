// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
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
vi.mock('./ThreadCardDetails', () => ({ ThreadCardDetails: () => null }));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({ ThreadActionsMenu: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
// The sections read the threads' signals, whose modules load the app's translations.
vi.mock('./useCompactThreadSections', () => ({ useCompactThreadSections: () => undefined }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const room = { roomId: ROOM_ID } as unknown as Room;
const list = (
  threadRootIds: string[],
  filterBarShown = false,
  threadRecordMap: ReadonlyMap<string, ThreadRecord> = new Map()
) => (
  <CompactRoomView
    room={room}
    filterBarShown={filterBarShown}
    threadRootIds={threadRootIds}
    threadRecordMap={threadRecordMap}
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

  it('takes only the card that moved up out of the page while the list is scrolled', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const ids = Array.from({ length: 10 }, (_, index) => `$${index}`);
    const { rerender, container } = render(list(ids));
    const view = container.querySelector<HTMLElement>('[data-compact-room-view]');
    const cards = [...container.querySelectorAll('[data-scroll-anchor]')];
    if (view) view.scrollTop = 700;
    const observer = new MutationObserver(() => undefined);
    observer.observe(container, { childList: true, subtree: true });

    rerender(list(['$9', ...ids.slice(0, 9)]));
    const taken = observer.takeRecords().flatMap((record) => [...record.removedNodes]);
    observer.disconnect();
    vi.unstubAllGlobals();

    // The scroll anchor of the browser is one of the cards it passed: those stay in the page.
    expect(taken).toEqual([cards[9]]);
    expect(
      [...container.querySelectorAll('[data-scroll-anchor]')].map((card) =>
        card.getAttribute('data-scroll-anchor')
      )
    ).toEqual(['$9', ...ids.slice(0, 9)]);
    // The card that moved is a new one, which the list's motion still finds by its row.
    expect(container.querySelector('[data-scroll-anchor="$9"]')).not.toBe(cards[9]);
    expect(glided()).toContain('$9');
    expect(motion.left()).toEqual([]);
  });

  it('gives no card a new key in a list that shows the oldest reply first', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const ids = Array.from({ length: 10 }, (_, index) => `$${index}`);
    // Each thread's last reply came after the one before it, until the last reply of $9 goes.
    const records = (gone: boolean) =>
      new Map(
        ids.map((id, index) => [
          id,
          { status: { lastActivityTs: gone && id === '$9' ? 0 : index + 1 } } as ThreadRecord,
        ])
      );
    const { rerender, container } = render(list(ids, false, records(false)));
    const view = container.querySelector<HTMLElement>('[data-compact-room-view]');
    const cards = [...container.querySelectorAll('[data-scroll-anchor]')];
    if (view) view.scrollTop = 700;

    rerender(list(['$9', ...ids.slice(0, 9)], false, records(true)));
    vi.unstubAllGlobals();

    // In a list that shows the newest first, $9 would be a new card (the test above).
    expect([...container.querySelectorAll('[data-scroll-anchor]')]).toEqual([
      cards[9],
      ...cards.slice(0, 9),
    ]);
  });

  it('keeps the cards in view in the page when one card moves up and another down at once', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const ids = Array.from({ length: 10 }, (_, index) => `$${index}`);
    const { rerender, container } = render(list(ids));
    const view = container.querySelector<HTMLElement>('[data-compact-room-view]');
    const cards = [...container.querySelectorAll('[data-scroll-anchor]')];
    if (view) view.scrollTop = 700;
    const observer = new MutationObserver(() => undefined);
    observer.observe(container, { childList: true, subtree: true });

    // $5 moves to the top and $1 to the end, as when a held order is let go.
    const order = ['$5', '$0', '$2', '$3', '$4', '$6', '$7', '$8', '$9', '$1'];
    rerender(list(order));
    const taken = new Set(observer.takeRecords().flatMap((record) => [...record.removedNodes]));
    observer.disconnect();
    vi.unstubAllGlobals();

    // Only the two that moved left the page: the one that went up for a new card, the one that
    // went down to be put back where it stands now.
    expect(taken).toEqual(new Set([cards[5], cards[1]]));
    const now = [...container.querySelectorAll('[data-scroll-anchor]')];
    expect(now.map((card) => card.getAttribute('data-scroll-anchor'))).toEqual(order);
    expect(now[0]).not.toBe(cards[5]);
    expect(now[9]).toBe(cards[1]);
  });

  it('glides a card into the Pinned section', () => {
    const { rerender } = render(list(['$a', '$b', '$c']));
    state.pinned = ['$c'];
    rerender(list(['$a', '$b', '$c']));

    expect(glided().sort()).toEqual(['$a', '$b', '$c']);
  });
});
