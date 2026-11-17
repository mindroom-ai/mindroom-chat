// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import { runShortcut } from '../../shortcuts/useShortcut';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import { ThreadBoard } from './ThreadBoard';

// The board with the Compact view's real cards, so each way a card opens its thread runs as it
// does in the app; only the card's data, the thread's tags and the menu's contents are stand-ins.
const mocks = vi.hoisted(() => ({
  navigateRoomThread: vi.fn(),
  setResolved: vi.fn(async () => undefined),
}));

const ROOM_ID = '!room:example.org';
const room = { roomId: ROOM_ID } as Room;

vi.mock('../../background-jobs/useRoomBackgroundJobs', () => ({
  useRoomBackgroundJobs: () => ({ jobs: [], total: 0 }),
}));
vi.mock('../../schedules/useScheduledTaskEvents', () => ({ useScheduledTaskEvents: () => [] }));
vi.mock('../../event-store/threads/roomThreadList', () => ({
  loadRoomThreads: async () => undefined,
  roomThreadListIsComplete: () => true,
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: mocks.navigateRoomThread }),
}));
vi.mock('../overview/compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: ({ threadRootIds }: { threadRootIds: string[] }) =>
    threadRootIds.map(
      (threadRootId): CompactThreadCardViewModel => ({
        id: { roomId: ROOM_ID, threadRootId },
        titleText: threadRootId,
        displayTitleText: threadRootId,
        previewText: '',
        messageCount: 1,
        messageCountLabel: '1 reply',
        messageCountText: '1',
        attentionState: 'idle',
        attentionStatusText: 'Idle',
        participants: [],
        tags: [],
        isResolved: false,
        isUnread: false,
        isStreaming: false,
      })
    ),
}));
vi.mock('../tags/useRoomThreadTags', () => ({
  useToggleThreadResolution: () => ({
    canToggle: true,
    setResolved: mocks.setResolved,
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
vi.mock('../overview/useCompactThreadSections', () => ({
  useCompactThreadSections: () => undefined,
}));
vi.mock('../overview/useThreadRootLiveCallRow', () => ({
  useThreadRootLiveCallRow: () => undefined,
}));
vi.mock('../overview/ThreadCardBadges', () => ({ ThreadCardBadges: () => null }));
vi.mock('../overview/ThreadCardDetails', () => ({ ThreadCardDetails: () => null }));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));
// The menu's Open thread calls the `onOpenThread` it is given; its other actions (snooze, resolve)
// do their work and close it.
vi.mock('../ThreadActionsMenu', () => ({
  ThreadActionsMenu: ({
    onOpenThread,
    onClose,
  }: {
    onOpenThread?: () => void;
    onClose: () => void;
  }) => (
    <div role="menu">
      {onOpenThread && (
        <button type="button" role="menuitem" onClick={onOpenThread}>
          Open thread
        </button>
      )}
      <button type="button" role="menuitem" onClick={onClose}>
        Snooze
      </button>
    </div>
  ),
}));

const index = (rootIds: string[]) => {
  const entries = new Map<string, CrossRoomThreadIndexEntry>();
  rootIds.forEach((threadRootId) => {
    const threadRecord = {
      roomId: ROOM_ID,
      threadRootId,
      presentation: {},
      status: {
        isKnownThreadRoot: true,
        replyCount: 1,
        isResolved: false,
        isUnread: false,
        isStreaming: false,
        scheduledTaskCount: 0,
        tags: [],
      },
      cache: {},
      absoluteIndex: 0,
    } as unknown as ThreadRecord;
    entries.set(`${ROOM_ID}|${threadRootId}`, {
      roomId: ROOM_ID,
      threadRootId,
      threadRecord,
    } as CrossRoomThreadIndexEntry);
  });
  return { ...emptyCrossRoomThreadIndexSnapshot(), entries, bootstrapped: true };
};

const renderBoard = (onOpenThread?: (threadRootId: string) => void) => {
  const store = createStore();
  store.set(crossRoomThreadIndexAtom, index(['$a', '$b']));
  render(
    <Provider store={store}>
      <ThreadBoard room={room} onOpenThread={onOpenThread} />
    </Provider>
  );
};

const card = (rootId: string): HTMLElement =>
  document.querySelector<HTMLElement>(
    `[data-thread-board-column] [data-thread-root-id="${rootId}"]`
  )!;

/** Opens the card's menu as the keyboard does (the ContextMenu key); the menu loads lazily. */
const openMenu = async (rootId: string) => {
  fireEvent.keyDown(card(rootId), { key: 'ContextMenu' });
  await act(async () => {});
};

describe("ThreadBoard's onOpenThread", () => {
  beforeEach(() => {
    mocks.navigateRoomThread.mockReset();
    mocks.setResolved.mockClear();
  });
  afterEach(cleanup);

  it('is told the root of a card that is chosen, before the board opens its thread', () => {
    const onOpenThread = vi.fn();
    renderBoard(onOpenThread);
    // A click, a tap, and Enter or Space on the card, which is a button, all click it.
    fireEvent.click(card('$b'));
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    expect(onOpenThread).toHaveBeenCalledWith('$b');
    expect(mocks.navigateRoomThread).toHaveBeenCalledTimes(1);
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$b');
    expect(onOpenThread.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigateRoomThread.mock.invocationCallOrder[0]!
    );
  });

  it('is told again when the thread the room already shows is chosen again', () => {
    const onOpenThread = vi.fn();
    renderBoard(onOpenThread);
    fireEvent.click(card('$a'));
    fireEvent.click(card('$a'));
    expect(onOpenThread.mock.calls).toEqual([['$a'], ['$a']]);
  });

  it("is told once by the card menu's Open thread", async () => {
    const onOpenThread = vi.fn();
    renderBoard(onOpenThread);
    await openMenu('$a');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open thread' }));
    expect(onOpenThread.mock.calls).toEqual([['$a']]);
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$a');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it("is not told of the card's other actions: resolve, by its button or keys, or snooze", async () => {
    const onOpenThread = vi.fn();
    renderBoard(onOpenThread);
    fireEvent.click(document.querySelector('[data-compact-thread-resolve]')!);
    act(() => {
      card('$b').focus();
      runShortcut('resolveThread', new KeyboardEvent('keydown'));
    });
    expect(mocks.setResolved).toHaveBeenCalledTimes(2);
    await openMenu('$a');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onOpenThread).not.toHaveBeenCalled();
    expect(mocks.navigateRoomThread).not.toHaveBeenCalled();
  });

  it('still opens the thread without one', async () => {
    renderBoard();
    fireEvent.click(card('$a'));
    await openMenu('$b');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open thread' }));
    expect(mocks.navigateRoomThread.mock.calls).toEqual([
      [ROOM_ID, '$a'],
      [ROOM_ID, '$b'],
    ]);
  });
});
