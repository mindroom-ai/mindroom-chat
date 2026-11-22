// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { runShortcut } from '../../shortcuts/useShortcut';
import type { CompactFocusRequest } from './compactFocusRequest';
import type { CompactThreadSection } from './compactThreadSections';
import { CompactRoomView } from './CompactRoomView';

const state = vi.hoisted(() => ({
  pinned: [] as string[],
  resolved: [] as string[],
  sections: undefined as CompactThreadSection[] | undefined,
  setResolved: vi.fn(async () => undefined),
}));

const viewModel = (roomId: string, threadRootId: string): CompactThreadCardViewModel => ({
  id: { roomId, threadRootId },
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
  isResolved: state.resolved.includes(threadRootId),
  isUnread: false,
  isStreaming: false,
});

vi.mock('./compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: ({
    room,
    threadRootIds,
  }: {
    room: Room;
    threadRootIds: string[];
  }) => threadRootIds.map((threadRootId) => viewModel(room.roomId, threadRootId)),
}));
vi.mock('../tags/useRoomThreadTags', () => ({
  useToggleThreadResolution: () => ({
    canToggle: true,
    setResolved: state.setResolved,
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
vi.mock('./useCompactThreadSections', () => ({
  useCompactThreadSections: () => state.sections,
}));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({ ThreadActionsMenu: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const list = (
  roomId: string,
  threadRootIds: string[],
  focusRequest?: CompactFocusRequest,
  memory = new Map()
) => (
  <CompactRoomView
    room={{ roomId } as unknown as Room}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: memory }}
    focusRequest={focusRequest}
  />
);

const card = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-thread-root-id="${id}"]`)!;
const resolveKeys = (): boolean => runShortcut('resolveThread', new KeyboardEvent('keydown'));

beforeEach(() => {
  state.pinned = [];
  state.resolved = [];
  state.sections = undefined;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: HTMLElement
  ) {
    if (this.dataset.compactRoomView) return new DOMRect(0, 0, 300, 300);
    const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
    let top = -(view?.scrollTop ?? 0);
    for (let row = this.previousElementSibling; row; row = row.previousElementSibling) {
      if (row instanceof HTMLElement && row.style.display !== 'none')
        top +=
          Number.parseFloat(row.style.height) || (row.hasAttribute('data-scroll-anchor') ? 100 : 0);
    }
    const h =
      this.style.display === 'none'
        ? 0
        : Number.parseFloat(this.style.height) ||
          (this.hasAttribute('data-scroll-anchor') ? 100 : 0);
    return new DOMRect(0, top, 300, h);
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the thread keys on the compact thread list', () => {
  it("resolves or reopens the focused card's thread and moves the focus on", () => {
    state.resolved = ['$c'];
    render(list('!keys:example.org', ['$a', '$b', '$c']));
    // No card has the focus: the keys are the open thread's.
    expect(resolveKeys()).toBe(false);

    card('$a').focus();
    expect(resolveKeys()).toBe(true);
    expect(state.setResolved).toHaveBeenLastCalledWith('$a', true);
    expect(document.activeElement).toBe(card('$b'));

    // The last card hands the focus to the one above it, reopened as well as resolved.
    card('$c').focus();
    expect(resolveKeys()).toBe(true);
    expect(state.setResolved).toHaveBeenLastCalledWith('$c', false);
    expect(document.activeElement).toBe(card('$b'));
  });

  it('materializes the logical End before focusing it, and returns to the pinned Home', () => {
    vi.useFakeTimers();
    try {
      const ids = Array.from({ length: 96 }, (_, index) => `$card${index}`);
      state.pinned = ['$card90'];
      render(list('!keyboard:example.org', ids));
      const first = card('$card90');
      first.focus();
      expect(card('$card95')).toBeNull();
      fireEvent.keyDown(first, { key: 'End' });
      for (let i = 0; i < 12; i += 1) {
        act(() => {
          vi.advanceTimersByTime(17);
        });
      }
      expect(document.activeElement).toBe(card('$card95'));
      fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      expect(document.activeElement).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolve-next reaches a logical neighbour that is not mounted in the filtered order', () => {
    vi.useFakeTimers();
    try {
      const ids = Array.from({ length: 96 }, (_, index) => `$card${index}`).filter(
        (id) => id !== '$card94'
      );
      render(list('!keyboard:example.org', ids));
      card('$card0').focus();
      fireEvent.keyDown(card('$card0'), { key: 'End' });
      for (let i = 0; i < 12; i += 1)
        act(() => {
          vi.advanceTimersByTime(17);
        });
      expect(document.activeElement).toBe(card('$card95'));
      expect(card('$card93')).toBeNull();
      act(() => {
        expect(resolveKeys()).toBe(true);
      });
      expect(state.setResolved).toHaveBeenLastCalledWith('$card95', true);
      expect(document.activeElement).toBe(card('$card93'));
    } finally {
      vi.useRealTimers();
    }
  });

  // Tab and Shift+Tab are the browser's: it stops on a spacer where the cards it stands for
  // would be, and the spacer hands the focus on. The tests focus the spacer as the browser does.
  describe('a spacer as the Tab stop of the cards that are not mounted', () => {
    const ids = Array.from({ length: 96 }, (_, index) => `$card${index}`);
    const settle = () => {
      for (let i = 0; i < 12; i += 1)
        act(() => {
          vi.advanceTimersByTime(17);
        });
    };
    const scrollTo = (top: number) => {
      const view = document.querySelector<HTMLElement>('[data-compact-room-view]')!;
      view.scrollTop = top;
      fireEvent.scroll(view);
    };
    const shell = (id: string) => card(id).closest<HTMLElement>('[data-scroll-anchor]')!;
    const more = (id: string) => shell(id).querySelector<HTMLElement>('[aria-haspopup="menu"]')!;
    // A button, as a card's controls are: a browser that tabs past buttons passes it as well.
    const tabTo = (spacer: Element | null | undefined) => {
      expect(spacer).toBeInstanceOf(HTMLButtonElement);
      expect(spacer?.hasAttribute('data-compact-spacer')).toBe(true);
      act(() => (spacer as HTMLElement).focus());
    };
    beforeEach(() => {
      vi.useFakeTimers();
      // jsdom lays nothing out: every control counts as shown.
      vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
        new DOMRect(),
      ] as unknown as DOMRectList);
    });
    afterEach(() => vi.useRealTimers());

    it('goes on to the next card from the last control of a card kept alone', () => {
      render(list('!tab:example.org', ids));
      settle();
      card('$card0').focus();
      scrollTo(6000);
      // $card0 is retained alone with a spacer between it and the deep window.
      expect(card('$card1')).toBeNull();
      more('$card0').focus();
      tabTo(shell('$card0').nextElementSibling);
      expect(document.activeElement).toBe(card('$card1'));
    });

    it('enters the card before at its last control on Shift+Tab', () => {
      render(list('!tab:example.org', ids));
      settle();
      scrollTo(6000);
      expect(card('$card47')).toBeNull();
      card('$card48').focus();
      tabTo(shell('$card48').previousElementSibling);
      expect(document.activeElement).toBe(more('$card47'));
    });

    it('reaches the first ordinary card from the pinned card, across the Pinned list', () => {
      state.pinned = ['$card90'];
      render(list('!tab:example.org', ids));
      settle();
      more('$card90').focus();
      scrollTo(6000);
      expect(card('$card0')).toBeNull();
      // The next stop of the page after the pinned card: the ordinary cards' first spacer.
      const pinned = document.querySelector('[data-pinned-threads]')!;
      expect(pinned.contains(more('$card90'))).toBe(true);
      tabTo(pinned.nextElementSibling);
      expect(document.activeElement).toBe(card('$card0'));
      // And back from there: the pinned card's last control is mounted, the browser's own stop.
      expect(pinned.nextElementSibling).toBe(shell('$card0'));
    });

    it("reaches a section's first card from its header, and the last card of the section before", () => {
      state.sections = [
        { id: 'needsYou', rootIds: ids.slice(0, 48) },
        { id: 'working', rootIds: ids.slice(48) },
      ];
      render(list('!tab:example.org', ids));
      settle();
      const header = document.querySelector<HTMLElement>('[data-compact-section="working"]')!;
      expect(card('$card47')).toBeNull();
      expect(card('$card48')).toBeNull();
      header.querySelector('button')!.focus();
      tabTo(header.nextElementSibling);
      expect(document.activeElement).toBe(card('$card48'));
      header.querySelector('button')!.focus();
      tabTo(header.previousElementSibling);
      expect(document.activeElement).toBe(more('$card47'));
    });

    it('leaves a pointer press on a spacer where it is', () => {
      render(list('!tab:example.org', ids));
      settle();
      scrollTo(6000);
      const spacer = shell('$card48').previousElementSibling as HTMLElement;
      vi.spyOn(spacer, 'matches').mockReturnValue(false);
      act(() => spacer.focus());
      expect(card('$card47')).toBeNull();
    });
  });

  it('moves to the logical End while the address asks for a card the filter hides', () => {
    vi.useFakeTimers();
    try {
      const ids = Array.from({ length: 96 }, (_, index) => `$card${index}`);
      const memory = new Map();
      const { rerender } = render(list('!hidden:example.org', ids, undefined, memory));
      for (let i = 0; i < 12; i += 1)
        act(() => {
          vi.advanceTimersByTime(17);
        });
      // A link followed to a card outside the shown order: its request stays unmet.
      rerender(
        list(
          '!hidden:example.org',
          ids,
          { eventId: '$gone', entryKey: 'pin', pushed: true },
          memory
        )
      );
      card('$card0').focus();
      fireEvent.keyDown(card('$card0'), { key: 'End' });
      expect(document.activeElement).toBe(card('$card95'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the keys from the open thread, and changes nothing, on a pinned card', () => {
    state.pinned = ['$a'];
    render(list('!pinned:example.org', ['$a', '$b']));
    card('$a').focus();
    expect(resolveKeys()).toBe(true);
    expect(state.setResolved).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(card('$a'));
  });
});
