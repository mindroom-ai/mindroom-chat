import { EventEmitter } from 'events';
import { ClientEvent, RoomEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { rememberSeenThreadRoot } from '../../matrix/seenThreadRoots';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';
import type { ThreadSignals } from './threadSignals';
import { createThreadSignalsReader, getThreadSignalsReader } from './threadSignalsReader';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./threadSignals', () => ({ readThreadSignals: mocks.read }));

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

  it('reads again once its room heard anything: a reaction, a held-back edit, a receipt', () => {
    mocks.read.mockReturnValue(quiet);
    const { room } = makeRoom();
    let heard = 0;
    const reader = createThreadSignalsReader(() => heard);
    reader.read(room, entry(), '@me:x', NOW);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    heard += 1;
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
  it('keeps one reader per client', () => {
    const mx = new EventEmitter() as unknown as MatrixClient;
    expect(getThreadSignalsReader(mx)).toBe(getThreadSignalsReader(mx));
    expect(getThreadSignalsReader(new EventEmitter() as unknown as MatrixClient)).not.toBe(
      getThreadSignalsReader(mx)
    );
  });

  it('reads a thread again after its room heard an event or a receipt', () => {
    mocks.read.mockReturnValue(quiet);
    const mx = new EventEmitter();
    const reader = getThreadSignalsReader(mx as unknown as MatrixClient);
    const { room } = makeRoom();
    reader.read(room, entry(), '@me:x', NOW);
    mx.emit(ClientEvent.Event, { getRoomId: () => '!other:x' });
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mx.emit(ClientEvent.Event, { getRoomId: () => '!r:x' });
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    mx.emit(RoomEvent.Receipt, {}, room);
    reader.read(room, entry(), '@me:x', NOW);
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });
});
