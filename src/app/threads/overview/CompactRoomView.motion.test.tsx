// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { standInForListMotion } from '../../ui/__tests__/listMotionStandIn';
import { CompactRoomView } from './CompactRoomView';

const ROOM_ID = '!room:example.org';

const state = vi.hoisted(() => ({ pinned: [] as string[], preview: 'No replies yet' }));

const viewModel = (threadRootId: string): CompactThreadCardViewModel => ({
  id: { roomId: ROOM_ID, threadRootId },
  titleText: threadRootId,
  displayTitleText: threadRootId,
  previewText: state.preview,
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
  options: { orderKey?: string; pageLimit?: number } = {}
) => (
  <CompactRoomView
    {...options}
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
  state.preview = 'No replies yet';
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

const row = (id: string) => document.querySelector(`[data-scroll-anchor="${id}"]`);
const order = () =>
  [...document.querySelectorAll('[data-scroll-anchor]')].map((element) =>
    element.getAttribute('data-scroll-anchor')
  );
const pill = () => screen.queryByRole('button', { name: /showUpdatedOrder/ });
const scroll = (top: number) => {
  const view = document.querySelector<HTMLElement>('[data-compact-room-view]')!;
  view.scrollTop = top;
  fireEvent.scroll(view);
};

describe('the calm compact list', () => {
  it.each([-1, 0, 0.25, 30])('reads offset %s before the scroll event', (offset) => {
    const { container, rerender } = render(list(['$a', '$b']));
    container.querySelector<HTMLElement>('[data-compact-room-view]')!.scrollTop = offset;
    rerender(list(['$b', '$a']));
    expect(order()).toEqual(offset > 0 ? ['$a', '$b'] : ['$b', '$a']);
    expect(!!pill()).toBe(offset > 0);
  });

  it('keeps pins in their parent with fresh content and drops the offer when the update reverts', () => {
    const { rerender } = render(list(['$a', '$b', '$c']));
    const incumbent = row('$c');
    scroll(30);
    state.pinned = ['$c'];
    state.preview = 'Fresh preview';
    rerender(list(['$c', '$a', '$b']));
    expect(row('$c')).toBe(incumbent);
    expect(incumbent?.textContent).toContain('Fresh preview');
    expect(incumbent?.closest('[data-pinned-threads]')).toBeNull();
    expect(pill()).not.toBeNull();
    state.pinned = [];
    rerender(list(['$a', '$b', '$c']));
    expect(pill()).toBeNull();
  });

  it.each([false, true])(
    'joins at the live edge despite a pending pin (keyboard focus: %s)',
    (focused) => {
      const { rerender } = render(list(['$a', '$b', '$c']));
      scroll(30);
      const card = row('$c')!.querySelector<HTMLButtonElement>('[data-thread-root-id]')!;
      if (focused) act(() => card.focus());
      state.pinned = ['$c'];
      rerender(list(['$c', '$a', '$b']));
      expect(order()).toEqual(['$a', '$b', '$c']);

      rerender(list(['$c', '$new', '$a', '$b']));
      expect(order()).toEqual(['$new', '$a', '$b', '$c']);
      expect(row('$c')?.contains(card)).toBe(true);
      expect(row('$c')?.closest('[data-pinned-threads]')).toBeNull();
      if (focused) expect(document.activeElement).toBe(card);
    }
  );

  it('releases scroll and pointer holds independently, but resets both on a control change', () => {
    const { rerender } = render(list(['$a', '$b']));
    const cards = row('$a')!.parentElement!;
    fireEvent.pointerEnter(cards);
    scroll(30);
    rerender(list(['$b', '$a']));
    scroll(0);
    expect(order()).toEqual(['$a', '$b']);
    scroll(30);
    fireEvent.pointerLeave(cards);
    expect(order()).toEqual(['$a', '$b']);
    fireEvent.pointerEnter(cards);
    rerender(list(['$b', '$a'], false, { orderKey: 'new filter' }));
    expect(order()).toEqual(['$b', '$a']);
    expect(pill()).toBeNull();
  });

  it('keeps page survivors, fills departures and expands a held page immediately', () => {
    const { rerender } = render(list(['$a', '$b', '$c', '$d'], false, { pageLimit: 2 }));
    expect(order()).toEqual(['$a', '$b']);
    scroll(30);
    rerender(list(['$c', '$a', '$b', '$d'], false, { pageLimit: 2 }));
    expect(order()).toEqual(['$a', '$b']);
    expect(pill()).not.toBeNull();
    rerender(list(['$c', '$b', '$d'], false, { pageLimit: 2 }));
    expect(order()).toEqual(['$c', '$b']);
    rerender(list(['$c', '$b', '$d'], false, { pageLimit: 3 }));
    expect(order()).toEqual(['$c', '$b', '$d']);
    expect(pill()).toBeNull();
  });

  it('applies the offer at zero even while the pointer holds the list', () => {
    const { container, rerender } = render(list(['$a', '$b']));
    const view = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
    view.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
      view.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0;
    };
    scroll(30);
    rerender(list(['$b', '$a']));
    fireEvent.pointerEnter(row('$a')!.parentElement!);
    fireEvent.click(pill()!);
    fireEvent.scroll(view);
    expect(document.activeElement).toBe(view);
    expect(view.scrollTop).toBe(0);
    expect(order()).toEqual(['$b', '$a']);
    // Only the explicit activation overrides the hold, not the next live change.
    rerender(list(['$a', '$b']));
    expect(order()).toEqual(['$b', '$a']);
  });
});
