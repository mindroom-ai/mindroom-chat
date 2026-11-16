// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { LONG_PRESS_MS } from '../../lib/hooks/useLongPress';
import { CompactRoomView } from './CompactRoomView';

const ROOM_ID = '!room:example.org';

const { menuProps, setResolved } = vi.hoisted(() => ({
  menuProps: vi.fn(),
  setResolved: vi.fn(),
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
    canToggle: true,
    setResolved,
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
vi.mock('./ThreadCardDetails', () => ({ ThreadCardDetails: () => null }));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({
  ThreadActionsMenu: (props: unknown) => {
    menuProps(props);
    return null;
  },
}));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const room = { roomId: ROOM_ID } as unknown as Room;
const list = (threadRootIds: string[], onThreadClick = vi.fn()) => (
  <CompactRoomView
    room={room}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={onThreadClick}
    compactRoomScrollStateRef={{ current: new Map() }}
  />
);

const finger = (x: number, y: number) => ({ clientX: x, clientY: y, identifier: 1 });

beforeEach(() => {
  vi.useFakeTimers();
  menuProps.mockClear();
  setResolved.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a long press on a compact thread card', () => {
  it("opens the thread's menu at the finger after a long press on its card, and the lift opens no thread", async () => {
    const onThreadClick = vi.fn();
    render(list(['$a'], onThreadClick));
    const shell = document.querySelector<HTMLElement>('[data-scroll-anchor="$a"]')!;
    fireEvent.touchStart(shell, { touches: [finger(40, 60)] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    await act(async () => {}); // the menu is lazy
    expect(menuProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ rootId: '$a', anchor: { x: 40, y: 60, width: 0, height: 0 } })
    );
    expect(fireEvent.touchEnd(shell, { touches: [] })).toBe(false);
    expect(onThreadClick).not.toHaveBeenCalled();
  });

  it('opens no menu for a finger that swipes the card sideways', () => {
    render(list(['$a']));
    const shell = document.querySelector<HTMLElement>('[data-scroll-anchor="$a"]')!;
    fireEvent.touchStart(shell, { touches: [finger(40, 60)] });
    fireEvent.touchMove(shell, { touches: [finger(70, 60)] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(menuProps).not.toHaveBeenCalled();
  });

  it('keeps the native sideways swipe working while cancelling the long press', () => {
    const onThreadClick = vi.fn();
    render(list(['$a'], onThreadClick));
    const track = document.querySelector<HTMLElement>('[data-compact-card-swipe="track"]')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 100));
    track.setPointerCapture = vi.fn();
    // jsdom has no PointerEvent constructor; give the mouse event its touch pointer fields.
    const pointer = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 60 });
      Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true });
      fireEvent(track, event);
    };

    pointer('pointerdown', 300);
    expect(fireEvent.touchStart(track, { touches: [finger(300, 60)] })).toBe(true);
    expect(fireEvent.touchMove(track, { touches: [finger(295, 60)] })).toBe(true);
    pointer('pointermove', 290);
    pointer('pointermove', 170);
    expect(track.style.transform).toBe('translateX(-120px)');
    // Only an active sideways swipe makes the list's native listener prevent default.
    // That must not stop the row's bubbling handler from cancelling the long press.
    expect(fireEvent.touchMove(track, { touches: [finger(170, 60)] })).toBe(false);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(menuProps).not.toHaveBeenCalled();
    pointer('pointerup', 170);
    expect(fireEvent.touchEnd(track, { touches: [] })).toBe(true);
    expect(setResolved).toHaveBeenCalledWith('$a', true);
    expect(track.style.transform).toBe('');
    fireEvent.click(track.querySelector<HTMLButtonElement>('[data-thread-root-id]')!, {
      detail: 1,
    });
    expect(onThreadClick).not.toHaveBeenCalled();
  });
});
