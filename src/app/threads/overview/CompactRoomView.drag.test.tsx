// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import {
  SecondThreadContext,
  type SecondThreadControl,
  THREAD_DRAG_TYPE,
} from '../../navigation/secondThread';
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
vi.mock('./useCompactThreadSections', () => ({ useCompactThreadSections: () => undefined }));
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

// A test's stand-in for the browser's drag data, which jsdom lacks.
const dragData = () => {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  };
};
const shellOf = (rootId: string) =>
  document.querySelector<HTMLElement>(`[data-scroll-anchor="${rootId}"]`)!;
// jsdom has no PointerEvent: a mouse event with the pointer's kind.
const press = (target: Element, pointerType: string) => {
  const event = new MouseEvent('pointerdown', { bubbles: true });
  Object.assign(event, { pointerId: 1, pointerType, isPrimary: true });
  fireEvent(target, event);
};
const onPage = (second: SecondThreadControl | undefined, ids: string[]) =>
  render(<SecondThreadContext.Provider value={second}>{list(ids)}</SecondThreadContext.Provider>);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('dragging a compact thread card toward the second column', () => {
  it('makes a card draggable only while the room page offers its thread a second column', () => {
    const offers = vi.fn((roomId: string, rootId: string) => roomId === ROOM_ID && rootId !== '$a');
    onPage({ offers, open: vi.fn() }, ['$a', '$b']);
    press(shellOf('$a'), 'mouse');
    press(shellOf('$b'), 'mouse');
    expect(shellOf('$a').getAttribute('draggable')).toBeNull();
    expect(shellOf('$b').getAttribute('draggable')).toBe('true');
    cleanup();
    // Off a room page (the Threads page, search) or on a phone, no card drags.
    onPage(undefined, ['$b']);
    press(shellOf('$b'), 'mouse');
    expect(shellOf('$b').getAttribute('draggable')).toBeNull();
  });

  it('drags for a mouse press only: a finger or a pen keeps its swipe and long press', () => {
    onPage({ offers: () => true, open: vi.fn() }, ['$b']);
    const shell = shellOf('$b');
    expect(shell.getAttribute('draggable')).toBeNull();
    press(shell, 'mouse');
    expect(shell.getAttribute('draggable')).toBe('true');
    press(shell, 'touch');
    expect(shell.getAttribute('draggable')).toBeNull();
    // A native drag a finger starts anyway carries no thread.
    const dataTransfer = dragData();
    expect(fireEvent.dragStart(shell, { dataTransfer })).toBe(false);
    expect(dataTransfer.types).toEqual([]);
    press(shell, 'pen');
    expect(shell.getAttribute('draggable')).toBeNull();
  });

  it("puts the card's room and thread in the drag, to be moved", () => {
    onPage({ offers: () => true, open: vi.fn() }, ['$b']);
    const dataTransfer = dragData();
    press(shellOf('$b'), 'mouse');
    fireEvent.dragStart(shellOf('$b'), { dataTransfer });
    expect(JSON.parse(dataTransfer.getData(THREAD_DRAG_TYPE))).toEqual({
      roomId: ROOM_ID,
      rootId: '$b',
    });
    expect(dataTransfer.effectAllowed).toBe('move');
  });

  it('still opens the thread on a plain click', () => {
    const onThreadClick = vi.fn();
    render(
      <SecondThreadContext.Provider value={{ offers: () => true, open: vi.fn() }}>
        {list(['$b'], onThreadClick)}
      </SecondThreadContext.Provider>
    );
    fireEvent.click(shellOf('$b').querySelector('[data-thread-root-id]')!);
    expect(onThreadClick.mock.calls[0]?.[0]).toBe('$b');
  });
});
