// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { ROW_HEIGHT, ROW_WIDTH, standInForListMotion } from '../../ui/__tests__/listMotionStandIn';
import { CompactRoomView, type CompactRoomViewProps } from './CompactRoomView';
import type { CompactThreadSection } from './compactThreadSections';

const ROOM_ID = '!room:example.org';

const state = vi.hoisted(() => ({
  pinned: [] as string[],
  sections: undefined as CompactThreadSection[] | undefined,
}));

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
vi.mock('./useCompactThreadSections', () => ({ useCompactThreadSections: () => state.sections }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const room = { roomId: ROOM_ID } as unknown as Room;
let scrollMemory: CompactRoomViewProps['compactRoomScrollStateRef'];
const list = (
  threadRootIds: string[],
  filterBarShown = false,
  props?: Partial<CompactRoomViewProps>
) => (
  <CompactRoomView
    room={room}
    filterBarShown={filterBarShown}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={scrollMemory}
    {...props}
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
  state.sections = undefined;
  scrollMemory = { current: new Map() };
  motion = standInForListMotion();
});

afterEach(() => {
  cleanup();
  motion.restore();
  vi.unstubAllGlobals();
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

// Give the real keeper a scroll viewport and row geometry in jsdom. Native anchoring is absent,
// so an unchanged scrollTop means the keeper left the browser's position alone.
const scrollView = (container: HTMLElement, scrollTop: number, clientHeight: number) => {
  vi.stubGlobal('CSS', { supports: () => true });
  const view = container.querySelector<HTMLElement>('[data-compact-room-view]')!;
  const heading = '[data-pinned-threads] > :first-child';
  const rows = () => [
    ...view.querySelectorAll(`[data-scroll-anchor], [data-compact-section], ${heading}`),
  ];
  const height = (row: Element) => (row.matches(heading) ? 40 : ROW_HEIGHT);
  Object.defineProperties(view, {
    clientHeight: { value: clientHeight },
    scrollHeight: { get: () => rows().reduce((total, row) => total + height(row), 0) },
  });
  view.scrollTop = scrollTop;
  const measure = motion.rects.getMockImplementation()!;
  motion.rects.mockImplementation(function rect(this: HTMLElement) {
    const all = rows();
    const index = all.indexOf(this);
    if (index < 0) return measure.call(this);
    const top = all.slice(0, index).reduce((total, row) => total + height(row), -view.scrollTop);
    return new DOMRect(0, top, ROW_WIDTH, height(this));
  });
  return view;
};

describe('the Compact reading landmark', () => {
  it('leaves the first card in view still when a Board card joins below it', () => {
    const { container, rerender } = render(list(['$a', '$b', '$c', '$d', '$e', '$f', '$g']));
    const view = scrollView(container, 130, 450);
    rerender(list(['$a', '$b', '$new', '$c', '$d', '$e', '$f', '$g']));

    expect(view.scrollTop).toBe(130);
  });

  it('uses a visible survivor when no row in view is in every longest subsequence', () => {
    const { container, rerender } = render(list(['$a', '$b', '$c', '$d', '$e']));
    const view = scrollView(container, 100, 100);
    rerender(list(['$e', '$d', '$c', '$b', '$a']));

    expect(view.scrollTop).toBe(300);
  });

  it('leaves native scrolling alone when the reader reverses the sort', () => {
    const ids = Array.from({ length: 9 }, (_, index) => `$row${index}`);
    const { container, rerender } = render(list(ids, false, { landmarkSortKey: 'lastReply:desc' }));
    const view = scrollView(container, 100, 200);
    rerender(list([...ids].reverse(), false, { landmarkSortKey: 'lastReply:asc' }));

    expect(container.querySelector('[data-compact-room-view]')).toBe(view);
    expect(view.querySelector('[data-scroll-anchor]')?.getAttribute('data-scroll-anchor')).toBe(
      ids.at(-1)
    );
    expect(view.scrollTop).toBe(100);
  });

  it('keeps the partly visible Pinned heading still when a new pin leads the group', () => {
    const ids = ['$a', '$b', '$c', '$d', '$e', '$f'];
    state.pinned = ['$b', '$c'];
    const { container, rerender } = render(list(ids));
    const view = scrollView(container, 20, 400);
    const heading = view.querySelector('[data-pinned-threads] > :first-child');
    expect(heading?.getBoundingClientRect().top).toBe(-20);
    state.pinned = ['$a', '$b', '$c'];
    rerender(list(ids));

    expect(
      view
        .querySelector('[data-pinned-threads] [data-scroll-anchor]')
        ?.getAttribute('data-scroll-anchor')
    ).toBe('$a');
    expect(heading?.getBoundingClientRect().top).toBe(-20);
  });

  it('does not follow a shared section header into another room', () => {
    state.sections = [
      { id: 'working', rootIds: ['$a'] },
      { id: 'needsYou', rootIds: ['$b', '$c', '$d'] },
    ];
    const { container, rerender } = render(list(['$a', '$b', '$c', '$d']));
    const view = scrollView(container, 150, 450);
    state.sections = [{ id: 'needsYou', rootIds: ['$e', '$f', '$g', '$h', '$i', '$j'] }];
    rerender(
      list(['$e', '$f', '$g', '$h', '$i', '$j'], false, {
        room: { roomId: '!other:example.org' } as unknown as Room,
      })
    );

    expect(container.querySelector('[data-compact-room-view]')).toBe(view);
    expect(view.scrollTop).toBe(150);
  });
});
