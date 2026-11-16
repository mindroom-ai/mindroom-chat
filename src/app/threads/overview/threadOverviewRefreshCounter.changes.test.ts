// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import {
  ClientEvent,
  MatrixEventEvent,
  RoomEvent,
  RoomStateEvent,
  ThreadEvent,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';

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

const receiptOf = (userId: string) =>
  event({ type: 'm.receipt', content: { $read: { 'm.read': { [userId]: { ts: 1 } } } } });

const setup = (threadId?: string) => {
  // The events the room holds: a reply of the thread `$root`, and a message outside any thread.
  const held = new Map([
    ['$reply', event({ id: '$reply', threadRootId: '$root' })],
    ['$plain', event({ id: '$plain' })],
  ]);
  const client = { ...emitter(), getUserId: () => ME };
  const room = {
    ...emitter(),
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
  return { room, client, state, told };
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
    ['an event related to a reply the room holds', { id: '$edit', relatesTo: '$reply' }, ['$root']],
    [
      'an event related to a message outside a thread',
      { id: '$r', relatesTo: '$plain' },
      ['$plain'],
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
    expect(told(() => room.emit(RoomEvent.Receipt, undefined, room)).marked).toBe('room');
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
  it.each([
    ['a local echo that moves on', RoomEvent.LocalEchoUpdated],
    ['a redaction', RoomEvent.Redaction],
  ])('marks the thread of %s without a count', (_name, name) => {
    const { room, told } = setup();

    expect(told(() => room.emit(name, event({ id: '$new', threadRootId: '$root' }), room))).toEqual(
      {
        marked: ['$root'],
        counted: 0,
      }
    );
  });

  it('marks the thread of each event the client hears of this room, after the sync kept its edits', () => {
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
    ['a member', 'm.room.member', 'room'],
    ['its encryption', 'm.room.encryption', 'room'],
    ['its topic', 'm.room.topic', []],
  ])('marks the room for a change of %s', (_name, type, marked) => {
    const { client, told } = setup();
    const emit = (roomId: string) => () =>
      client.emit(RoomStateEvent.Events, event({ id: '$state', type }), { roomId });

    expect(told(emit(ROOM_ID))).toEqual({ marked, counted: 0 });
    expect(told(emit('!other:example.org')).marked).toEqual([]);
  });
});
