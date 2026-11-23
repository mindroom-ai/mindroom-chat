// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { runShortcut } from '../../shortcuts/useShortcut';
import type { CompactFocusRequest } from './compactFocusRequest';
import type { CompactThreadSection } from './compactThreadSections';
import { stubCompactLayout, tickFrames } from './compactBlocks.test.shared';
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
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key} ${options.count}`,
  }),
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

let layout: ReturnType<typeof stubCompactLayout>;

beforeEach(() => {
  state.pinned = [];
  state.resolved = [];
  state.sections = undefined;
  layout = stubCompactLayout();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  describe('windowed keyboard and Tab navigation', () => {
    const ids = Array.from({ length: 96 }, (_, index) => `$card${index}`);
    const view = () => document.querySelector<HTMLElement>('[data-compact-room-view]')!;
    const shell = (id: string) => card(id).closest<HTMLElement>('[data-scroll-anchor]')!;
    const more = (id: string) => shell(id).querySelector<HTMLElement>('[aria-haspopup="menu"]')!;
    const tabTo = (spacer: Element | null | undefined) => {
      expect(spacer).toBeInstanceOf(HTMLButtonElement);
      expect(spacer?.hasAttribute('data-compact-spacer')).toBe(true);
      act(() => (spacer as HTMLElement).focus());
    };
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
        new DOMRect(),
      ] as unknown as DOMRectList);
    });
    afterEach(() => vi.useRealTimers());

    it('materializes End (even with a hidden filter address), returns to pinned Home, and resolves to an unmounted neighbour', () => {
      const memory = new Map();
      const filtered = ids.filter((id) => id !== '$card94');
      state.pinned = ['$card90'];
      const { rerender } = render(list('!keyboard:example.org', filtered, undefined, memory));
      const first = card('$card90');
      first.focus();
      expect(card('$card95')).toBeNull();
      // A hidden filter address does not block End from materializing the last card.
      rerender(
        list(
          '!keyboard:example.org',
          filtered,
          { eventId: '$gone', entryKey: 'pin', pushed: true },
          memory
        )
      );
      fireEvent.keyDown(first, { key: 'End' });
      tickFrames(12);
      expect(document.activeElement).toBe(card('$card95'));
      // Home returns to the pinned first card; End again, then resolve moves to unmounted $card93.
      fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      expect(document.activeElement).toBe(first);
      fireEvent.keyDown(first, { key: 'End' });
      expect(document.activeElement).toBe(card('$card95'));
      expect(card('$card93')).toBeNull();
      act(() => {
        expect(resolveKeys()).toBe(true);
      });
      expect(state.setResolved).toHaveBeenLastCalledWith('$card95', true);
      expect(document.activeElement).toBe(card('$card93'));
    });

    it('gives up a pending End once the reader scrolls on before the last card is measured', () => {
      render(list('!wheel:example.org', ids));
      const first = card('$card0');
      first.focus();
      fireEvent.keyDown(first, { key: 'End' });
      fireEvent.wheel(view());
      layout.scroll(view(), 300);
      tickFrames(12);
      expect(document.activeElement).toBe(first);
      expect(view().scrollTop).toBe(300);
      fireEvent.keyDown(first, { key: 'End' });
      expect(document.activeElement).toBe(card('$card95'));
    });

    it('crosses spacers on Tab/Shift+Tab, ignores pointer focus, and activates the named button', () => {
      render(list('!tab:example.org', ids));
      tickFrames(12);
      layout.scroll(view(), 6000);
      expect(card('$card47')).toBeNull();
      const spacer = shell('$card48').previousElementSibling as HTMLElement;
      expect(spacer.hasAttribute('aria-hidden')).toBe(false);
      expect(spacer.getAttribute('aria-label')).toBe('threadNav.moreThreads 48');
      const matches = vi.spyOn(spacer, 'matches').mockReturnValue(false);
      act(() => spacer.focus());
      expect(card('$card47')).toBeNull();
      matches.mockRestore();

      // Activating the named button without focusing it shows its first card ($card0).
      fireEvent.click(spacer);
      tickFrames(12);
      expect(document.activeElement).toBe(card('$card0'));

      // Scrolling away retains $card0 alone; forward Tab from its menu crosses the spacer to $card1.
      layout.scroll(view(), 6000);
      expect(card('$card1')).toBeNull();
      more('$card0').focus();
      tabTo(shell('$card0').nextElementSibling);
      expect(document.activeElement).toBe(card('$card1'));

      // Shift+Tab across the spacer enters the previous card ($card47) at its last control.
      card('$card48').focus();
      layout.scroll(view(), 6000);
      expect(card('$card47')).toBeNull();
      tabTo(shell('$card48').previousElementSibling);
      expect(document.activeElement).toBe(more('$card47'));
    });

    it('crosses spacers on Tab/Shift+Tab from Pinned and across section headers', () => {
      state.pinned = ['$card90'];
      const { unmount } = render(list('!tab-pin:example.org', ids));
      tickFrames(12);
      more('$card90').focus();
      layout.scroll(view(), 6000);
      expect(card('$card0')).toBeNull();
      const pinned = document.querySelector('[data-pinned-threads]')!;
      expect(pinned.contains(more('$card90'))).toBe(true);
      tabTo(pinned.nextElementSibling);
      expect(document.activeElement).toBe(card('$card0'));
      expect(pinned.nextElementSibling).toBe(shell('$card0'));
      unmount();

      state.pinned = [];
      state.sections = [
        { id: 'needsYou', rootIds: ids.slice(0, 48) },
        { id: 'working', rootIds: ids.slice(48) },
      ];
      render(list('!tab-sec:example.org', ids));
      tickFrames(12);
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
