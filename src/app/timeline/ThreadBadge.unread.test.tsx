// @vitest-environment jsdom
import { forwardRef } from 'react';
import { EventEmitter } from 'node:events';
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { act, cleanup, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadBadge } from './ThreadBadge';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader } from '../threads/cross-room/threadSignalsReader';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import type { ThreadIndicatorUnread } from '../messages/ThreadIndicator';
import type { ThreadBadgeViewModel } from '../event-store/threads/types';

const mocks = vi.hoisted(() => ({
  readThreadSignals: vi.fn(),
  ThreadIndicator: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock('../messages/ThreadIndicator', () => ({
  ThreadIndicator: forwardRef<HTMLElement, Record<string, unknown>>((props) =>
    mocks.ThreadIndicator(props)
  ),
}));
// The real signals cache, over signals the test sets per thread.
vi.mock('../threads/cross-room/threadSignals', () => ({
  SIGNAL_EVENT_LIMIT: 40,
  readThreadSignals: mocks.readThreadSignals,
}));

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';

const signalsOf = (mentionedMe: boolean): ThreadSignals => ({
  newCount: 1,
  mentionedMe,
  newSenderIds: [],
  automation: false,
});

const entryOf = (threadRootId: string, generation = 1) =>
  ({
    key: getCrossRoomThreadIndexKey(ROOM_ID, threadRootId),
    roomId: ROOM_ID,
    threadRootId,
    generation,
    isResolved: false,
    isInvolved: true,
  } as CrossRoomThreadIndexEntry);

const receiptOf = (threadId: string) =>
  ({
    getContent: () => ({ $read: { 'm.read': { [ME]: { ts: 1, thread_id: threadId } } } }),
  } as unknown as MatrixEvent);

/**
 * A client with one room whose thread index holds `indexed`, and its chips as the timeline renders
 * them, each by root ID with its record's unread state.
 */
const setup = (signals: Record<string, ThreadSignals>, indexed: string[]) => {
  mocks.readThreadSignals.mockImplementation(
    (_room: Room, threadRootId: string) => signals[threadRootId] ?? signalsOf(false)
  );
  const room = {
    roomId: ROOM_ID,
    myUserId: ME,
    getThread: () => null,
    getThreadUnreadNotificationCount: () => 0,
    getOldestThreadedReceiptTs: () => Infinity,
  } as unknown as Room;
  const mx = Object.assign(new EventEmitter(), {
    getRoom: () => room,
    getRooms: () => [room],
    getSafeUserId: () => ME,
    stopClient: () => undefined,
    store: {},
  }) as unknown as MatrixClient;
  Object.assign(room, { client: mx });
  const read = vi.spyOn(getThreadSignalsReader(mx), 'read');

  const store = createStore();
  const setIndex = (entries: CrossRoomThreadIndexEntry[]) =>
    act(() =>
      store.set(crossRoomThreadIndexAtom, {
        ...emptyCrossRoomThreadIndexSnapshot(),
        entries: new Map(entries.map((entry) => [entry.key, entry])),
      })
    );
  const entries = indexed.map((rootId) => entryOf(rootId));
  setIndex(entries);

  const model = (threadRootId: string, isUnread: boolean): ThreadBadgeViewModel => ({
    id: { roomId: ROOM_ID, threadRootId },
    replyCount: 11,
    isResolved: false,
    isUnread,
  });
  const onClick = vi.fn();
  const chips = (unread: Record<string, boolean>) => (
    <Provider store={store}>
      {Object.entries(unread).map(([rootId, isUnread]) => (
        <ThreadBadge key={rootId} model={model(rootId, isUnread)} room={room} onClick={onClick} />
      ))}
    </Provider>
  );
  const clear = () => {
    mocks.ThreadIndicator.mockClear();
    read.mockClear();
    mocks.readThreadSignals.mockClear();
  };
  let rerender: (unread: Record<string, boolean>) => void = () => undefined;
  const mount = (unread: Record<string, boolean>) => {
    const view = render(chips(unread));
    rerender = (next) => view.rerender(chips(next));
  };
  /** The timeline renders its rows again, the chips with them. */
  const show = (unread: Record<string, boolean>) => {
    clear();
    rerender(unread);
  };

  /** The chip of `rootId` as it was last drawn since the last clear, and how often. */
  const chip = (rootId: string) => {
    const calls = mocks.ThreadIndicator.mock.calls.filter(
      ([props]) => props.threadRootId === rootId
    );
    return {
      renders: calls.length,
      unread: calls.at(-1)?.[0].unread as ThreadIndicatorUnread | undefined,
    };
  };
  const readsOf = (rootId: string) =>
    read.mock.calls.filter(([, entry]) => entry.threadRootId === rootId).length;

  return { mx, room, signals, entries, setIndex, mount, show, chip, readsOf, clear };
};

describe('ThreadBadge unread state', () => {
  afterEach(() => {
    cleanup();
    mocks.ThreadIndicator.mockClear();
    mocks.readThreadSignals.mockReset();
  });

  it('reads no signals for a read thread, even when they tell a mention', () => {
    const { mount, chip, readsOf, setIndex } = setup({ $a: signalsOf(true) }, ['$a']);

    mount({ $a: false });

    expect(chip('$a')).toEqual({ renders: 1, unread: undefined });
    expect(readsOf('$a')).toBe(0);
    // A read chip follows no index entry.
    setIndex([entryOf('$a', 2)]);
    expect(chip('$a').renders).toBe(1);
  });

  it("marks an unread thread, with the signals' mention", () => {
    const { mount, chip } = setup({ $a: signalsOf(false), $b: signalsOf(true) }, ['$a', '$b']);

    mount({ $a: true, $b: true });

    expect(chip('$a').unread).toEqual({ mentionsMe: false });
    expect(chip('$b').unread).toEqual({ mentionsMe: true });
  });

  it('is unread with no mention until the index holds the thread, then tells it', () => {
    const { mount, chip, readsOf, setIndex } = setup({ $a: signalsOf(true) }, []);

    mount({ $a: true });
    expect(chip('$a').unread).toEqual({ mentionsMe: false });
    expect(readsOf('$a')).toBe(0);

    setIndex([entryOf('$a')]);
    expect(chip('$a').unread).toEqual({ mentionsMe: true });
  });

  it("draws one chip again for its own thread's index entry, not for another thread's", () => {
    const { mount, chip, readsOf, setIndex, entries, signals, clear } = setup(
      { $a: signalsOf(false), $b: signalsOf(false) },
      ['$a', '$b']
    );
    mount({ $a: true, $b: true });
    clear();

    signals.$b = signalsOf(true);
    setIndex([entries[0]!, entryOf('$b', 2)]);

    expect(chip('$a').renders).toBe(0);
    expect(readsOf('$a')).toBe(0);
    expect(chip('$b').renders).toBe(1);
    expect(chip('$b').unread).toEqual({ mentionsMe: true });
  });

  it("drops the mention once the user's receipt reads it, the thread still unread", () => {
    const { mx, room, mount, show, chip, signals } = setup({ $a: signalsOf(true) }, ['$a']);
    mount({ $a: true });
    signals.$a = signalsOf(false);

    // A render with nothing heard keeps the cached signals.
    show({ $a: true });
    expect(chip('$a').unread).toEqual({ mentionsMe: true });

    // The receipt counts for the thread in the cache, and the timeline renders the chip again
    // for it (`useThreadOverviewRefresh`'s receipt listener).
    mx.emit(RoomEvent.Receipt, receiptOf('$a'), room);
    show({ $a: true });
    expect(chip('$a').unread).toEqual({ mentionsMe: false });
  });

  it('follows the record: unread once a reply comes, plain once the thread is read', () => {
    const { mount, show, chip } = setup({ $a: signalsOf(true) }, ['$a']);
    mount({ $a: false });
    expect(chip('$a').unread).toBeUndefined();

    show({ $a: true });
    expect(chip('$a').unread).toEqual({ mentionsMe: true });

    // The signals still tell the mention; the record says the thread is read.
    show({ $a: false });
    expect(chip('$a').unread).toBeUndefined();
  });
});
