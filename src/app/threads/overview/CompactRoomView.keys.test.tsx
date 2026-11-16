// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import { runShortcut } from '../../shortcuts/useShortcut';
import { CompactRoomView } from './CompactRoomView';
import { stepCompactThread } from './compactCardKeys';

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
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({ ThreadActionsMenu: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const list = (roomId: string, threadRootIds: string[], keysStepHere = true) => (
  <CompactRoomView
    room={{ roomId } as unknown as Room}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: new Map() }}
    keysStepHere={keysStepHere}
  />
);

const card = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-thread-root-id="${id}"]`)!;
const resolveKeys = (): boolean => runShortcut('resolveThread', new KeyboardEvent('keydown'));

beforeEach(() => {
  state.pinned = [];
  state.resolved = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the thread keys on the compact thread list', () => {
  it("notes the order of the room's own list, pinned cards first", () => {
    state.pinned = ['$c'];
    render(list('!own:example.org', ['$a', '$b', '$c']));
    expect(stepCompactThread('!own:example.org', '$c', 1)).toBe('$a');
    expect(stepCompactThread('!own:example.org', '$a', 1)).toBe('$b');
  });

  it("leaves the order alone for a board's column of the room", () => {
    render(list('!board:example.org', ['$a', '$b']));
    render(list('!board:example.org', ['$b'], false));
    expect(stepCompactThread('!board:example.org', '$a', 1)).toBe('$b');
  });

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

  it('keeps the keys from the open thread, and changes nothing, on a pinned card', () => {
    state.pinned = ['$a'];
    render(list('!pinned:example.org', ['$a', '$b']));
    card('$a').focus();
    expect(resolveKeys()).toBe(true);
    expect(state.setResolved).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(card('$a'));
  });
});
