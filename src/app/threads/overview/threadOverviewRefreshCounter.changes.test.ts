// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  ClientEvent,
  MatrixEventEvent,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  ThreadEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { keepSyncedEdits } from '../../matrix/client/syncedEdits';
import { rememberSeenThreadRoot } from '../../matrix/seenThreadRoots';
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';

// What the room's thread records are told of each event: the thread it may have changed, or the
// whole room. The records of the other threads are kept (`ThreadRecordReuse`), so each source a
// record reads has to be told here, each with its count.
const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';

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
  const client = Object.assign(new EventEmitter(), { getUserId: () => ME });
  const oldest = { ts: Infinity };
  const room = Object.assign(new EventEmitter(), {
    getOldestThreadedReceiptTs: () => oldest.ts,
    roomId: ROOM_ID,
    client,
    findEventById: (eventId: string) => held.get(eventId),
    getThread: () => null,
    // An unopened thread, whose summary names a reply no timeline holds.
    getThreads: () => [
      { id: '$unopened', replyToEvent: event({ id: '$summarized', threadRootId: '$unopened' }) },
    ],
  });
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
    return { marked, counted: state().overviewRefreshCounter > overviewRefreshCounter };
  };
  return { room, client, state, told, oldest, unmount: hook.unmount };
};

// A hook of an earlier test would hear the store of kept edits, which every client shares.
afterEach(cleanup);

describe('useThreadOverviewRefreshCounter changes', () => {
  it('marks the room and counts when it starts to listen', () => {
    const { state } = setup();

    // What the room heard between the render that built the records and these listeners.
    expect(state().overviewChanges.room).toBe(1);
    expect(state().overviewRefreshCounter).toBe(1);
  });

  it('marks nothing while a thread is open', () => {
    const { room, state } = setup('$open');

    act(() => {
      room.emit(ThreadEvent.Update, { id: '$root' });
    });

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

  it('marks the thread of an event a timeline loses, and counts', () => {
    const { room, told } = setup();
    const lost = event({ id: '$new', threadRootId: '$root' });

    expect(told(() => room.emit(RoomEvent.Timeline, lost, room, undefined, true))).toEqual({
      marked: ['$root'],
      counted: true,
    });
  });

  it('marks the thread of a thread update, and the room for one that names no thread', () => {
    const { room, told } = setup();

    expect(told(() => room.emit(ThreadEvent.Update, { id: '$root' }))).toEqual({
      marked: ['$root'],
      counted: true,
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
        counted: true,
      }
    );
    expect(told(() => room.emit(RoomEvent.Receipt, receiptOf(ME), room))).toEqual({
      marked: 'room',
      counted: true,
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
      counted: true,
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
      counted: true,
    });
  });

  it('marks the thread of every event that decrypts, also while a count is due', async () => {
    const { client, told, state: stateOf } = setup();
    const first = event({ id: '$a1', threadRootId: '$a' });
    const second = event({ id: '$b1', threadRootId: '$b' });

    const counter = stateOf().overviewRefreshCounter;
    expect(
      told(() => {
        client.emit(MatrixEventEvent.Decrypted, first);
        client.emit(MatrixEventEvent.Decrypted, second);
      })
    ).toEqual({ marked: ['$a', '$b'], counted: false });
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    // Both events wait for the one count of their batch.
    expect(stateOf().overviewRefreshCounter).toBe(counter + 1);
  });

  it('marks the thread of a local echo that moves on, and counts', () => {
    const { room, told } = setup();
    const echo = event({ id: '$new', threadRootId: '$root' });

    expect(told(() => room.emit(RoomEvent.LocalEchoUpdated, echo, room))).toEqual({
      marked: ['$root'],
      counted: true,
    });
  });

  it('marks the thread the room names for a redaction, which the redacted event has left', () => {
    const { room, told } = setup();
    // By then `$plain` is all the room holds of the redacted reply.
    const redaction = event({ id: '$redaction', type: 'm.room.redaction', relatesTo: '$plain' });

    expect(told(() => room.emit(RoomEvent.Redaction, redaction, room, '$root'))).toEqual({
      marked: ['$root', '$redaction', '$plain'],
      counted: true,
    });
    expect(told(() => room.emit(RoomEvent.Redaction, redaction, room, undefined)).marked).toEqual([
      '$redaction',
      '$plain',
    ]);
  });

  it('marks the room for a timeline of the room that starts over, and counts', () => {
    const { room, told } = setup();

    expect(told(() => room.emit(RoomEvent.TimelineReset, room, {}))).toEqual({
      marked: 'room',
      counted: true,
    });
  });

  it('marks only the thread whose timeline starts over, as one does for its first page', () => {
    const { room, told } = setup();

    expect(
      told(() => room.emit(RoomEvent.TimelineReset, room, { thread: { id: '$root' } }))
    ).toEqual({ marked: ['$root'], counted: true });
  });

  it('marks the thread of an event an edit is put on or taken off', () => {
    const { client, told } = setup();
    const emit = (fake: FakeEvent) => () => client.emit(MatrixEventEvent.Replaced, event(fake));

    expect(told(emit({ id: '$reply', threadRootId: '$root' }))).toEqual({
      marked: ['$root'],
      counted: true,
    });
    expect(
      told(emit({ id: '$reply', threadRootId: '$root', roomId: '!other:example.org' })).marked
    ).toEqual([]);
  });

  // A member who left shows the name of their newest member event the room has loaded.
  it.each([
    ['takes, as a page of history brings', true, false],
    ['loses', undefined, true],
  ])('marks the room and counts for a member event a timeline %s', (_what, toStart, removed) => {
    const { room, told } = setup();
    const member = event({ id: '$member', type: 'm.room.member' });

    expect(told(() => room.emit(RoomEvent.Timeline, member, room, toStart, removed))).toEqual({
      marked: 'room',
      counted: true,
    });
  });

  it('marks the room and counts for a root of this room this device takes for read', () => {
    const { told, unmount } = setup();
    const root = { getId: () => '$root', getTs: () => 1 } as unknown as MatrixEvent;
    const see = (roomId: string) => () => rememberSeenThreadRoot(ME, roomId, root, 0);

    // No receipt is sent for it, so no event of the room tells of it.
    expect(told(see(ROOM_ID))).toEqual({ marked: 'room', counted: true });
    expect(told(see('!other:example.org'))).toEqual({ marked: [], counted: false });
    unmount();
    expect(told(see(ROOM_ID))).toEqual({ marked: [], counted: false });
  });

  it('marks the thread of a message whose kept edits a full store drops, and counts', () => {
    const { client, told, unmount } = setup();
    const stop = keepSyncedEdits(
      Object.assign(client, { getRoom: () => null }) as unknown as MatrixClient
    );
    const editOf = (messageId: string) =>
      ({
        getId: () => `$edit-of-${messageId}`,
        getRoomId: () => '!other:example.org',
        getTs: () => 1,
        isRedacted: () => false,
        getWireContent: () => ({ 'm.relates_to': { rel_type: 'm.replace', event_id: messageId } }),
        getContent: () => ({}),
      } as unknown as MatrixEvent);
    /** The store keeps 5,000 messages: one more drops the one it heard of longest ago. */
    const fill = (from: number) => () => {
      for (let i = from; i < from + 5000; i += 1) client.emit(ClientEvent.Event, editOf(`$m${i}`));
    };
    client.emit(ClientEvent.Event, editOf('$reply'));

    // The store holds `$reply` and 4,999 more: the next message drops `$reply`.
    expect(told(fill(0))).toEqual({ marked: ['$root'], counted: true });
    const dropped = told(() => {
      client.emit(ClientEvent.Event, editOf('$summarized'));
      fill(5000)();
    });
    expect(dropped.marked).toContain('$unopened');
    // A message the room does not find may be a root no timeline holds, such as a pinned one.
    expect(dropped.marked).toContain('$m4999');
    expect(dropped.counted).toBe(true);
    unmount();
    client.emit(ClientEvent.Event, editOf('$reply'));
    expect(told(fill(10000)).marked).toEqual([]);
    stop();
  });

  it('says that it hears the room while it does', () => {
    const { state, unmount } = setup();
    const changes = state().overviewChanges;
    expect(changes.listened).toBe(true);

    unmount();

    expect(changes.listened).toBe(false);
    expect(setup('$open').state().overviewChanges.listened).toBe(false);
  });

  it('marks the thread of each event the client hears of this room, and counts', () => {
    const { client, told } = setup();
    const emit = (fake: FakeEvent) => () => client.emit(ClientEvent.Event, event(fake));

    expect(told(emit({ id: '$edit', threadRootId: '$root' }))).toEqual({
      marked: ['$root'],
      counted: true,
    });
    expect(told(emit({ id: '$edit', relatesTo: '$gone' })).marked).toBe('room');
    expect(
      told(emit({ id: '$edit', threadRootId: '$root', roomId: '!other:example.org' })).marked
    ).toEqual([]);
    // Typing, receipts and account data have no ID and change no record.
    expect(told(emit({ type: 'm.typing' })).marked).toEqual([]);
  });

  it.each([
    ['marks the room and counts for', 'its encryption', 'm.room.encryption', 'room'],
    // The sync repeats member events that change nothing; a member's change has its own events.
    ['marks nothing for', 'a member event', 'm.room.member', []],
    ['marks nothing for', 'its topic', 'm.room.topic', []],
  ])('%s a change of %s', (_what, _name, type, marked) => {
    const { client, told } = setup();
    const emit = (roomId: string) => () =>
      client.emit(RoomStateEvent.Events, event({ id: '$state', type }), { roomId });

    expect(told(emit(ROOM_ID))).toEqual({ marked, counted: marked === 'room' });
    expect(told(emit('!other:example.org'))).toEqual({ marked: [], counted: false });
  });

  it.each([
    ['name', RoomMemberEvent.Name],
    ['membership', RoomMemberEvent.Membership],
  ])("marks the room and counts for a member's new %s", (_name, name) => {
    const { client, told } = setup();
    const emit = (roomId: string) => () =>
      client.emit(name, event({ id: '$member', type: 'm.room.member' }), { roomId });

    expect(told(emit(ROOM_ID))).toEqual({ marked: 'room', counted: true });
    expect(told(emit('!other:example.org'))).toEqual({ marked: [], counted: false });
  });
});
