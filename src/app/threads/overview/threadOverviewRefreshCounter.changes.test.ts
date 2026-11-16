// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import {
  ClientEvent,
  MatrixEventEvent,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  ThreadEvent,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  ROOM_MARK_INTERVAL_MS,
  useThreadOverviewRefreshCounter,
} from './threadOverviewRefreshCounter';

// What the room's thread records are told of each event: the thread it may have changed, or the
// whole room. The records of the other threads are kept (`ThreadRecordReuse`), so each source a
// record reads has to be told here, also the ones that raise no count.
type Listener = (...args: unknown[]) => void;

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';

const emitter = () => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: (name: string, listener: Listener) => {
      listeners.set(name, (listeners.get(name) ?? new Set<Listener>()).add(listener));
    },
    removeListener: (name: string, listener: Listener) => {
      listeners.get(name)?.delete(listener);
    },
    emit: (name: string, ...args: unknown[]) => {
      [...(listeners.get(name) ?? [])].forEach((listener) => listener(...args));
    },
  };
};

type FakeEvent = {
  id?: string;
  threadRootId?: string;
  isThreadRoot?: boolean;
  relatesTo?: string;
  roomId?: string;
  type?: string;
  content?: Record<string, unknown>;
};

const event = ({
  id,
  threadRootId,
  isThreadRoot = false,
  relatesTo,
  roomId = ROOM_ID,
  type = 'm.room.message',
  content = {},
}: FakeEvent) =>
  ({
    getId: () => id,
    getRoomId: () => roomId,
    getType: () => type,
    getContent: () => content,
    isThreadRoot,
    threadRootId,
    getAssociatedId: () => relatesTo,
    getRelation: () => (relatesTo ? { event_id: relatesTo } : null),
  } as unknown as MatrixEvent);

const receiptOf = (userId: string, threadId?: string) =>
  event({
    type: 'm.receipt',
    content: {
      $read: { 'm.read': { [userId]: { ts: 1, ...(threadId ? { thread_id: threadId } : {}) } } },
    },
  });

const setup = (threadId?: string) => {
  // The events the room holds: a reply of the thread `$root`, and a message outside any thread.
  const held = new Map([
    ['$reply', event({ id: '$reply', threadRootId: '$root' })],
    ['$plain', event({ id: '$plain' })],
  ]);
  const client = { ...emitter(), getUserId: () => ME };
  const oldest = { ts: Infinity };
  const room = {
    ...emitter(),
    getOldestThreadedReceiptTs: () => oldest.ts,
    roomId: ROOM_ID,
    client,
    findEventById: (eventId: string) => held.get(eventId),
    getThread: () => null,
  };
  const hook = renderHook(() => useThreadOverviewRefreshCounter(room as unknown as Room, threadId));
  const state = () => hook.result.current;
  /** Runs `change` and tells what it marked (`'room'`, or the threads) and whether it counted. */
  const told = (change: () => void) => {
    const { overviewChanges, overviewRefreshCounter } = state();
    const before = overviewChanges.count;
    act(change);
    const after = state().overviewChanges;
    const marked: string | string[] =
      after.room > before
        ? 'room'
        : [...after.threads].filter(([, count]) => count > before).map(([id]) => id);
    return { marked, counted: state().overviewRefreshCounter - overviewRefreshCounter };
  };
  return { room, client, state, told, oldest };
};

describe('useThreadOverviewRefreshCounter changes', () => {
  it('marks the room when it starts to listen', () => {
    const { state } = setup();

    expect(state().overviewChanges.room).toBe(1);
  });

  it('marks nothing while a thread is open', () => {
    const { room, state } = setup('$open');

    act(() => room.emit(ThreadEvent.Update, { id: '$root' }));

    expect(state().overviewChanges.count).toBe(0);
  });

  it.each([
    ['a reply', { id: '$new', threadRootId: '$root' }, ['$root']],
    ['a root', { id: '$root', isThreadRoot: true }, ['$root']],
    [
      'an event related to a reply the room holds',
      { id: '$edit', relatesTo: '$reply' },
      ['$edit', '$root'],
    ],
    [
      'a message that answers one outside a thread',
      { id: '$r', relatesTo: '$plain' },
      ['$r', '$plain'],
    ],
    ['a message of its own', { id: '$message' }, ['$message']],
    ['an event related to one the room does not hold', { id: '$edit', relatesTo: '$gone' }, 'room'],
  ])('marks the thread of a timeline event: %s', (_name, fake, marked) => {
    const { room, told } = setup();

    expect(
      told(() => room.emit(RoomEvent.Timeline, event(fake), room, false, false)).marked
    ).toEqual(marked);
  });

  it('marks the thread of an event a timeline loses, which raises no count', () => {
    const { room, told } = setup();
    const lost = event({ id: '$new', threadRootId: '$root' });

    expect(told(() => room.emit(RoomEvent.Timeline, lost, room, undefined, true))).toEqual({
      marked: ['$root'],
      counted: 0,
    });
  });

  it('marks the thread of a thread update, and the room for one that names no thread', () => {
    const { room, told } = setup();

    expect(told(() => room.emit(ThreadEvent.Update, { id: '$root' }))).toEqual({
      marked: ['$root'],
      counted: 1,
    });
    expect(told(() => room.emit(ThreadEvent.NewReply, { id: '$other' })).marked).toEqual([
      '$other',
    ]);
    expect(told(() => room.emit(ThreadEvent.New, { id: '$new' })).marked).toEqual(['$new']);
    expect(told(() => room.emit(ThreadEvent.Delete, { id: '$new' })).marked).toEqual(['$new']);
    expect(told(() => room.emit(ThreadEvent.Update)).marked).toBe('room');
  });

  it("marks the room for the reader's receipt and nothing for someone else's; both count", () => {
    const { room, told } = setup();

    expect(told(() => room.emit(RoomEvent.Receipt, receiptOf('@alice:example.org'), room))).toEqual(
      {
        marked: [],
        counted: 1,
      }
    );
    expect(told(() => room.emit(RoomEvent.Receipt, receiptOf(ME), room))).toEqual({
      marked: 'room',
      counted: 1,
    });
    expect(told(() => room.emit(RoomEvent.Receipt, receiptOf(ME, 'main'), room)).marked).toBe(
      'room'
    );
    expect(told(() => room.emit(RoomEvent.Receipt, undefined, room)).marked).toBe('room');
  });

  it("marks the thread of the reader's thread receipt, as the receipt of their own reply is", () => {
    const { room, told } = setup();

    expect(told(() => room.emit(RoomEvent.Receipt, receiptOf(ME, '$root'), room))).toEqual({
      marked: ['$root'],
      counted: 1,
    });
    // Someone else's receipt for the main timeline in the same event changes nothing.
    const mixed = event({
      type: 'm.receipt',
      content: {
        $a: { 'm.read': { [ME]: { ts: 1, thread_id: '$root' } } },
        $b: {
          'm.read': { '@alice:example.org': { ts: 1 } },
          'm.read.private': { [ME]: { ts: 1, thread_id: '$other' } },
        },
      },
    });
    expect(told(() => room.emit(RoomEvent.Receipt, mixed, room)).marked).toEqual([
      '$root',
      '$other',
    ]);
  });

  it("marks the room when the reader's oldest thread receipt of the room changes", () => {
    const { room, told, oldest } = setup();

    oldest.ts = 5;
    expect(told(() => room.emit(RoomEvent.Receipt, receiptOf(ME, '$root'), room)).marked).toBe(
      'room'
    );
    expect(told(() => room.emit(RoomEvent.Receipt, receiptOf(ME, '$root'), room)).marked).toEqual([
      '$root',
    ]);
  });

  it('marks the room when a caller asks for a recompute', () => {
    const { state, told } = setup();

    expect(told(() => state().setOverviewRefreshCounter((count) => count + 1))).toEqual({
      marked: 'room',
      counted: 1,
    });
  });

  it('marks the thread of every event that decrypts, also while a count is due', async () => {
    const { client, told } = setup();
    const first = event({ id: '$a1', threadRootId: '$a' });
    const second = event({ id: '$b1', threadRootId: '$b' });

    expect(
      told(() => {
        client.emit(MatrixEventEvent.Decrypted, first);
        client.emit(MatrixEventEvent.Decrypted, second);
      }).marked
    ).toEqual(['$a', '$b']);
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  });

  // Sources a record reads that raise no count: main showed each at the next count of any event.
  it('marks the thread of a local echo that moves on without a count', () => {
    const { room, told } = setup();
    const echo = event({ id: '$new', threadRootId: '$root' });

    expect(told(() => room.emit(RoomEvent.LocalEchoUpdated, echo, room))).toEqual({
      marked: ['$root'],
      counted: 0,
    });
  });

  it('marks the thread the room names for a redaction, which the redacted event has left', () => {
    const { room, told } = setup();
    // By then `$plain` is all the room holds of the redacted reply.
    const redaction = event({ id: '$redaction', type: 'm.room.redaction', relatesTo: '$plain' });

    expect(told(() => room.emit(RoomEvent.Redaction, redaction, room, '$root'))).toEqual({
      marked: ['$root', '$redaction', '$plain'],
      counted: 0,
    });
    expect(told(() => room.emit(RoomEvent.Redaction, redaction, room, undefined)).marked).toEqual([
      '$redaction',
      '$plain',
    ]);
  });

  it('marks the room for a timeline that starts over, without a count', () => {
    const { room, told } = setup();

    expect(told(() => room.emit(RoomEvent.TimelineReset, room))).toEqual({
      marked: 'room',
      counted: 0,
    });
  });

  it('marks the thread of an event an edit is put on or taken off', () => {
    const { client, told } = setup();
    const emit = (fake: FakeEvent) => () => client.emit(MatrixEventEvent.Replaced, event(fake));

    expect(told(emit({ id: '$reply', threadRootId: '$root' }))).toEqual({
      marked: ['$root'],
      counted: 0,
    });
    expect(
      told(emit({ id: '$reply', threadRootId: '$root', roomId: '!other:example.org' })).marked
    ).toEqual([]);
  });

  it('marks the room at the first count of each second, for what no event tells of', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const { room, told } = setup();
    const update = () => room.emit(ThreadEvent.Update, { id: '$root' });

    now.mockReturnValue(10_000 + ROOM_MARK_INTERVAL_MS - 1);
    expect(told(update).marked).toEqual(['$root']);
    now.mockReturnValue(10_000 + ROOM_MARK_INTERVAL_MS);
    // The room's mark comes after the thread's, so it stands.
    expect(told(update).marked).toBe('room');
    expect(told(update).marked).toEqual(['$root']);
    now.mockRestore();
  });

  it('marks the thread of each event the client hears of this room, without a count', () => {
    const { client, told } = setup();
    const emit = (fake: FakeEvent) => () => client.emit(ClientEvent.Event, event(fake));

    expect(told(emit({ id: '$edit', threadRootId: '$root' }))).toEqual({
      marked: ['$root'],
      counted: 0,
    });
    expect(told(emit({ id: '$edit', relatesTo: '$gone' })).marked).toBe('room');
    expect(
      told(emit({ id: '$edit', threadRootId: '$root', roomId: '!other:example.org' })).marked
    ).toEqual([]);
    // Typing, receipts and account data have no ID and change no record.
    expect(told(emit({ type: 'm.typing' })).marked).toEqual([]);
  });

  it.each([
    ['its encryption', 'm.room.encryption', 'room'],
    // The sync repeats member events that change nothing; a member's change has its own events.
    ['a member event', 'm.room.member', []],
    ['its topic', 'm.room.topic', []],
  ])('marks the room for a change of %s', (_name, type, marked) => {
    const { client, told } = setup();
    const emit = (roomId: string) => () =>
      client.emit(RoomStateEvent.Events, event({ id: '$state', type }), { roomId });

    expect(told(emit(ROOM_ID))).toEqual({ marked, counted: 0 });
    expect(told(emit('!other:example.org')).marked).toEqual([]);
  });

  it.each([
    ['name', RoomMemberEvent.Name],
    ['membership', RoomMemberEvent.Membership],
  ])("marks the room for a member's new %s", (_name, name) => {
    const { client, told } = setup();
    const emit = (roomId: string) => () =>
      client.emit(name, event({ id: '$member', type: 'm.room.member' }), { roomId });

    expect(told(emit(ROOM_ID))).toEqual({ marked: 'room', counted: 0 });
    expect(told(emit('!other:example.org')).marked).toEqual([]);
  });
});
