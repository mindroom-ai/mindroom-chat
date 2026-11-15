// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { CompactRoomView } from './CompactRoomView';

const ROOM_ID = '!room:example.org';
const CARD_HEIGHT = 60;

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
const list = (threadRootIds: string[]) => (
  <CompactRoomView
    room={room}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: new Map() }}
  />
);

let moved: HTMLElement[] = [];
const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
const cardOf = (element: HTMLElement) =>
  element.closest('[data-scroll-anchor]')?.getAttribute('data-scroll-anchor');

beforeEach(() => {
  moved = [];
  state.pinned = [];
  // jsdom lays nothing out: a card's place is its place among the cards.
  rects.mockImplementation(function rect(this: HTMLElement) {
    const card = this.closest('[data-scroll-anchor]');
    const index = [...document.querySelectorAll('[data-scroll-anchor]')].indexOf(card as Element);
    const top = Math.max(index, 0) * CARD_HEIGHT;
    return {
      top,
      left: 0,
      bottom: top + CARD_HEIGHT,
      right: 300,
      width: 300,
      height: CARD_HEIGHT,
    } as DOMRect;
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, keyframes: Keyframe[]) {
      if ('translate' in (keyframes[0] ?? {}) && !('opacity' in (keyframes[0] ?? {}))) {
        moved.push(this);
      }
      return { finished: new Promise(() => undefined), cancel: () => undefined };
    },
  });
});

afterEach(() => {
  cleanup();
  rects.mockReset();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

describe('the compact thread list in motion', () => {
  it('glides the cards after one that left, and fades that one where it stood', () => {
    const { container, rerender } = render(list(['$a', '$b', '$c']));
    rerender(list(['$a', '$c']));

    expect(moved.map(cardOf)).toEqual(['$c']);
    const left = container.querySelector('[inert]');
    expect(left?.textContent).toContain('$b');
    // The card that fades is no card to the list: nothing restores the scroll against it.
    expect(left?.closest('[data-scroll-anchor]')).toBeNull();
    expect(left?.querySelector('[data-scroll-anchor]')).toBeNull();
  });

  it('moves a card inside the element the scroll position is measured on, never that one', () => {
    const { rerender } = render(list(['$a', '$b']));
    rerender(list(['$b', '$a']));

    expect(moved).toHaveLength(2);
    moved.forEach((element) => {
      expect(element.hasAttribute('data-scroll-anchor')).toBe(false);
      expect(element.parentElement?.hasAttribute('data-scroll-anchor')).toBe(true);
    });
  });

  it('glides a card into the Pinned section', () => {
    const { rerender } = render(list(['$a', '$b', '$c']));
    state.pinned = ['$c'];
    rerender(list(['$a', '$b', '$c']));

    expect(moved.map(cardOf).sort()).toEqual(['$a', '$b', '$c']);
  });
});
