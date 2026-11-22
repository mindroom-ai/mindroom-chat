// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { runShortcut } from '../../shortcuts/useShortcut';
import { CompactRoomView } from './CompactRoomView';

const state = vi.hoisted(() => ({
  pinned: [] as string[],
  resolved: [] as string[],
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
vi.mock('./useCompactThreadSections', () => ({ useCompactThreadSections: () => undefined }));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({ ThreadActionsMenu: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const list = (roomId: string, threadRootIds: string[]) => (
  <CompactRoomView
    room={{ roomId } as unknown as Room}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: new Map() }}
  />
);

const card = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-thread-root-id="${id}"]`)!;
const resolveKeys = (): boolean => runShortcut('resolveThread', new KeyboardEvent('keydown'));

beforeEach(() => {
  state.pinned = [];
  state.resolved = [];
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

  it('tabs across a spacer from a retained focused card to its logical neighbour', () => {
    vi.useFakeTimers();
    try {
      const ids = Array.from({ length: 96 }, (_, index) => `$card${index}`);
      render(list('!tab:example.org', ids));
      for (let i = 0; i < 12; i += 1)
        act(() => {
          vi.advanceTimersByTime(17);
        });
      const firstShell = card('$card0').closest<HTMLElement>('[data-scroll-anchor]')!;
      card('$card0').focus();
      const view = document.querySelector<HTMLElement>('[data-compact-room-view]')!;
      view.scrollTop = 6000;
      fireEvent.scroll(view);
      // $card0 is retained alone with a spacer between it and the deep window.
      expect(card('$card1')).toBeNull();
      expect(firstShell.nextElementSibling?.hasAttribute('data-compact-spacer')).toBe(true);
      // Tab within the card stays native; Tab from the card's last button crosses the spacer to $card1.
      const cardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      card('$card0').dispatchEvent(cardTab);
      expect(cardTab.defaultPrevented).toBe(false);
      const actions = [...firstShell.querySelectorAll<HTMLElement>('button:not([disabled])')];
      const lastAction = actions.at(-1)!;
      lastAction.focus();
      const crossTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      act(() => {
        lastAction.dispatchEvent(crossTab);
      });
      expect(crossTab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(card('$card1'));
      // Shift+Tab across the leading spacer from the first mounted deep card materializes its neighbour.
      view.scrollTop = 6000;
      fireEvent.scroll(view);
      const deepFirst = card('$card48');
      expect(card('$card47')).toBeNull();
      deepFirst.focus();
      const backTab = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        deepFirst.dispatchEvent(backTab);
      });
      expect(backTab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(card('$card47'));
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
