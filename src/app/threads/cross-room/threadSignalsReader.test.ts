import { EventEmitter } from 'events';
import { ClientEvent, MatrixEventEvent, RoomEvent, RoomMemberEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { rememberSeenThreadRoot } from '../../matrix/seenThreadRoots';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';
import type { ThreadSignals } from './threadSignals';
import {
  createThreadSignalsReader,
  getThreadSignalsReader,
  subscribeRoomSignals,
} from './threadSignalsReader';

const mocks = vi.hoisted(() => ({ read: vi.fn(), receiptEvents: { version: 0 } }));
vi.mock('./threadSignals', () => ({ readThreadSignals: mocks.read }));
vi.mock('../../matrix/receiptReadTs', () => ({
  receiptEventsVersion: () => mocks.receiptEvents.version,
}));

const NOW = Date.UTC(2026, 10, 9, 12);
const quiet: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};

const entry = (generation = 1, isInvolved = true) =>
  ({
    key: 'k',
    roomId: '!r:x',
    threadRootId: '$root',
    generation,
    isInvolved,
  } as CrossRoomThreadIndexEntry);

const makeRoom = () => {
  const thread = { events: [{ getId: () => '$a' }] };
  const counts = { highlight: 0 };
  const room = {
    roomId: '!r:x',
    getThread: () => thread,
    getThreadUnreadNotificationCount: () => counts.highlight,
    getOldestThreadedReceiptTs: () => Infinity,
  } as unknown as Room;
  return { room, thread, counts };
};

afterEach(() => mocks.read.mockReset());

describe('createThreadSignalsReader', () => {
  it('reads a thread once while nothing about it changes', () => {
    mocks.read.mockReturnValue(quiet);
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW + 60_000);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    reader.read(room, entry(2), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again when the thread gains an event the index entry does not show', () => {
    mocks.read.mockReturnValue(quiet);
    const { room, thread } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    thread.events.push({ getId: () => '$reaction' });
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again once the count of changes of its thread goes up, in its room', () => {
    mocks.read.mockReturnValue(quiet);
    const { room } = makeRoom();
    const heard = new Map<string, number>();
    const reader = createThreadSignalsReader(
      (changedRoom, threadRootId) => heard.get(`${changedRoom.roomId} ${threadRootId}`) ?? 0
    );
    reader.read(room, entry(), '@me:x', NOW);
    heard.set('!r:x $other', 1);
    heard.set('!other:x $root', 1);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    heard.set('!r:x $root', 1);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again once the room holds or loses an event a receipt names', () => {
    mocks.read.mockReturnValue(quiet);
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.receiptEvents.version += 1;
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("reads again when the server counts the thread's mentions anew, with no event", () => {
    mocks.read.mockReturnValue(quiet);
    const { room, counts } = makeRoom();
    const reader = createThreadSignalsReader();
    counts.highlight = 1;
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    // A sync after Mark all read clears the count; no event or receipt comes with it.
    counts.highlight = 0;
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again once this device takes a thread root for read', () => {
    mocks.read.mockReturnValue(quiet);
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    // Mark all read with other main-timeline messages unread: no receipt, a record on this device.
    const root = { getId: () => '$root', getTs: () => 1000 } as MatrixEvent;
    rememberSeenThreadRoot('@me:x', '!r:x', root, 0);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('reads again once what the thread waits on lapses: an approval expires, a question ages out', () => {
    const question = { eventId: '$q', senderId: '@mindroom_a:x', text: 'q', options: [] };
    mocks.read.mockReturnValue({ ...quiet, pendingQuestion: question, waitsUntil: NOW + 30_000 });
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW + 10_000);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    reader.read(room, entry(), '@me:x', NOW + 60_000);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('asks the user only the questions of threads they take part in', () => {
    const question = { eventId: '$q', senderId: '@mindroom_a:x', text: 'q', options: [] };
    mocks.read.mockReturnValue({ ...quiet, pendingQuestion: question });
    const { room } = makeRoom();
    // Someone else's thread in a shared room: the agent asks them, not the user.
    expect(
      createThreadSignalsReader().read(room, entry(1, false), '@me:x', NOW).pendingQuestion
    ).toBeUndefined();
    expect(createThreadSignalsReader().read(room, entry(), '@me:x', NOW).pendingQuestion).toBe(
      question
    );
  });

  it('forgets threads the index no longer lists', () => {
    mocks.read.mockReturnValue(quiet);
    const { room } = makeRoom();
    const reader = createThreadSignalsReader();
    reader.read(room, entry(), '@me:x', NOW);
    reader.prune(new Set());
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
});

describe('getThreadSignalsReader', () => {
  const ME = '@me:x';
  const threadEntry = (threadRootId: string) =>
    ({
      key: `!r:x ${threadRootId}`,
      roomId: '!r:x',
      threadRootId,
      generation: 1,
      isInvolved: true,
    } as CrossRoomThreadIndexEntry);
  const A = threadEntry('$a');
  const B = threadEntry('$b');

  type EventInit = {
    id?: string;
    roomId?: string;
    threadRootId?: string;
    relatesTo?: string;
    state?: boolean;
  };
  const event = ({
    id = '$event',
    roomId = '!r:x',
    threadRootId,
    relatesTo,
    state = false,
  }: EventInit = {}) =>
    ({
      getId: () => id,
      getRoomId: () => roomId,
      isState: () => state,
      threadRootId,
      getAssociatedId: () => relatesTo,
      getRelation: () => (relatesTo ? { event_id: relatesTo } : null),
    } as unknown as MatrixEvent);
  /** An event without an ID: a live reply frame, typing. */
  const frame = { getId: () => undefined, getRoomId: () => '!r:x', isState: () => false };
  const receipt = (userId: string, threadId?: string) =>
    ({
      getContent: () => ({
        $read: { 'm.read': { [userId]: { ts: 1, ...(threadId ? { thread_id: threadId } : {}) } } },
      }),
    } as unknown as MatrixEvent);

  /** A client with one room of two threads, each read once, and which threads a change reads again. */
  const setup = () => {
    mocks.read.mockReturnValue(quiet);
    const held = new Map<string, MatrixEvent>();
    const receipts = { oldest: Infinity };
    const room = {
      roomId: '!r:x',
      getThread: () => ({ events: [] }),
      getThreadUnreadNotificationCount: () => 0,
      findEventById: (eventId: string) => held.get(eventId),
      getOldestThreadedReceiptTs: () => receipts.oldest,
    } as unknown as Room;
    const mx = Object.assign(new EventEmitter(), {
      getRoom: (roomId: string) => (roomId === room.roomId ? room : null),
      getSafeUserId: () => ME,
    });
    const reader = getThreadSignalsReader(mx as unknown as MatrixClient);
    const readAgain = (): string[] => {
      mocks.read.mockClear();
      [A, B].forEach((thread) => reader.read(room, thread, ME, NOW));
      return mocks.read.mock.calls.map(([, threadRootId]) => threadRootId as string);
    };
    expect(readAgain()).toEqual(['$a', '$b']);
    expect(readAgain()).toEqual([]);
    return { mx, room, held, receipts, readAgain };
  };

  it('keeps one reader per client', () => {
    const mx = new EventEmitter() as unknown as MatrixClient;
    expect(getThreadSignalsReader(mx)).toBe(getThreadSignalsReader(mx));
    expect(getThreadSignalsReader(new EventEmitter() as unknown as MatrixClient)).not.toBe(
      getThreadSignalsReader(mx)
    );
  });

  it.each([
    ['an event the client hears', ClientEvent.Event],
    ['an event a timeline takes', RoomEvent.Timeline],
    ['an event that decrypts', MatrixEventEvent.Decrypted],
    ['an event an edit is put on or taken off', MatrixEventEvent.Replaced],
    ["a local echo's progress", RoomEvent.LocalEchoUpdated],
  ])('reads only the thread of %s', (_what, name) => {
    const { mx, readAgain } = setup();
    mx.emit(name, event({ threadRootId: '$a' }));
    expect(readAgain()).toEqual(['$a']);
    mx.emit(name, event({ roomId: '!other:x', threadRootId: '$a' }));
    expect(readAgain()).toEqual([]);
  });

  it('reads the thread of the event that an edit or a reaction relates to', () => {
    const { mx, held, readAgain } = setup();
    held.set('$reply', event({ id: '$reply', threadRootId: '$b' }));
    mx.emit(ClientEvent.Event, event({ relatesTo: '$reply' }));
    expect(readAgain()).toEqual(['$b']);
  });

  it('reads the thread whose root an event is or relates to', () => {
    const { mx, held, readAgain } = setup();
    mx.emit(ClientEvent.Event, event({ id: '$a' }));
    expect(readAgain()).toEqual(['$a']);
    held.set('$b', event({ id: '$b' }));
    mx.emit(ClientEvent.Event, event({ relatesTo: '$b' }));
    expect(readAgain()).toEqual(['$b']);
  });

  it('reads the thread a message starts that answers another message of the room', () => {
    const { mx, held, readAgain } = setup();
    held.set('$b', event({ id: '$b' }));
    mx.emit(ClientEvent.Event, event({ id: '$a', relatesTo: '$b' }));
    expect(readAgain()).toEqual(['$a', '$b']);
  });

  it('reads every thread for an event related to one the room does not hold', () => {
    const { mx, readAgain } = setup();
    mx.emit(ClientEvent.Event, event({ relatesTo: '$unheld' }));
    expect(readAgain()).toEqual(['$a', '$b']);
  });

  it('reads no thread for an event without an ID: typing, a live reply frame', () => {
    const { mx, readAgain } = setup();
    mx.emit(ClientEvent.Event, frame);
    expect(readAgain()).toEqual([]);
  });

  it('reads no thread for a state event, such as an agent writing its jobs', () => {
    const { mx, readAgain } = setup();
    mx.emit(ClientEvent.Event, event({ id: '$a', state: true }));
    expect(readAgain()).toEqual([]);
  });

  it('reads the thread a redacted event left', () => {
    const { mx, room, held, readAgain } = setup();
    // The redacted reply is no longer in its thread; the room names the thread it was in.
    held.set('$reply', event({ id: '$reply' }));
    mx.emit(RoomEvent.Redaction, event({ id: '$redaction', relatesTo: '$reply' }), room, '$a');
    expect(readAgain()).toEqual(['$a']);
    held.set('$reply', event({ id: '$reply', threadRootId: '$b' }));
    mx.emit(RoomEvent.Redaction, event({ id: '$redaction', relatesTo: '$reply' }), room);
    expect(readAgain()).toEqual(['$b']);
  });

  it('reads every thread when a timeline of the room starts over, and one thread when its own does', () => {
    const { mx, room, readAgain } = setup();
    mx.emit(RoomEvent.TimelineReset, room, {});
    expect(readAgain()).toEqual(['$a', '$b']);
    mx.emit(RoomEvent.TimelineReset, room, { thread: { id: '$b' } });
    expect(readAgain()).toEqual(['$b']);
    mx.emit(RoomEvent.TimelineReset, undefined, {});
    expect(readAgain()).toEqual([]);
  });

  it('reads every thread when someone joins or leaves the room', () => {
    const { mx, readAgain } = setup();
    mx.emit(RoomMemberEvent.Membership, {}, { roomId: '!r:x' });
    expect(readAgain()).toEqual(['$a', '$b']);
    mx.emit(RoomMemberEvent.Membership, {}, { roomId: '!other:x' });
    expect(readAgain()).toEqual([]);
  });

  it("reads the thread of the user's receipt, and no thread for someone else's", () => {
    const { mx, room, readAgain } = setup();
    mx.emit(RoomEvent.Receipt, receipt(ME, '$b'), room);
    expect(readAgain()).toEqual(['$b']);
    mx.emit(RoomEvent.Receipt, receipt('@other:x', '$b'), room);
    mx.emit(RoomEvent.Receipt, receipt('@other:x'), room);
    expect(readAgain()).toEqual([]);
  });

  it("reads every thread for the user's receipt outside a thread", () => {
    const { mx, room, readAgain } = setup();
    mx.emit(RoomEvent.Receipt, receipt(ME), room);
    expect(readAgain()).toEqual(['$a', '$b']);
    mx.emit(RoomEvent.Receipt, receipt(ME, 'main'), room);
    expect(readAgain()).toEqual(['$a', '$b']);
  });

  it('tells who listens to a room of an event, a reset, a receipt, a member change and a redaction', () => {
    const { mx, room } = setup();
    const onChange = vi.fn();
    const unsubscribe = subscribeRoomSignals(mx as unknown as MatrixClient, '!r:x', onChange);
    const elsewhere = vi.fn();
    subscribeRoomSignals(mx as unknown as MatrixClient, '!other:x', elsewhere);

    mx.emit(ClientEvent.Event, event({ threadRootId: '$a' }));
    mx.emit(RoomEvent.TimelineReset, room, {});
    mx.emit(RoomEvent.Receipt, receipt(ME, '$a'), room);
    mx.emit(RoomMemberEvent.Membership, {}, { roomId: '!r:x' });
    mx.emit(RoomEvent.Redaction, event({ id: '$redaction' }), room, '$a');
    expect(onChange).toHaveBeenCalledTimes(6);
    // A live reply frame and someone else's receipt change no thread's signals.
    mx.emit(ClientEvent.Event, frame);
    mx.emit(RoomEvent.Receipt, receipt('@other:x', '$a'), room);
    expect(onChange).toHaveBeenCalledTimes(6);

    unsubscribe();
    mx.emit(ClientEvent.Event, event({ threadRootId: '$a' }));
    expect(onChange).toHaveBeenCalledTimes(6);
    expect(elsewhere).not.toHaveBeenCalled();
  });

  it("reads every thread when the user's oldest thread receipt of the room changes", () => {
    const { receipts, readAgain } = setup();
    receipts.oldest = 1000;
    expect(readAgain()).toEqual(['$a', '$b']);
    expect(readAgain()).toEqual([]);
  });
});
