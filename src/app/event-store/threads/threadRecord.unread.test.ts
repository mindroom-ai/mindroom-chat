import { createClient, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getThreadUnread } from './roomThreadList';
import {
  buildThreadUnreadMap,
  createThreadRecordChanges,
  markThreadRecordChange,
  type ThreadRecordChanges,
} from './threadRecord';

const mocked = vi.hoisted(() => ({ receiptEventsVersion: vi.fn(() => 0) }));
vi.mock('../../matrix/receiptReadTs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/receiptReadTs')>()),
  receiptEventsVersion: mocked.receiptEventsVersion,
}));
vi.mock('./roomThreadList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./roomThreadList')>();
  return { ...actual, getThreadUnread: vi.fn(actual.getThreadUnread) };
});

// A build keeps the unread marks of the threads nothing changed for, as it keeps their records.
const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';

let room: Room;
let changes: ThreadRecordChanges;

const message = (id: string, ts: number, threadRootId?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@bob:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(threadRootId
        ? { 'm.relates_to': { rel_type: RelationType.Thread, event_id: threadRootId } }
        : {}),
    },
  });

const thread = (id: string, inRoom = room): Thread => {
  const created = inRoom.createThread(id, message(id, 1000), [], false);
  created.addEvents([message(`${id}-reply`, 2000, id)], false);
  return created;
};

let threads: Thread[];

beforeEach(() => {
  mocked.receiptEventsVersion.mockReturnValue(0);
  const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  room = new Room(ROOM_ID, mx, ME);
  threads = [thread('$a'), thread('$b')];
  changes = createThreadRecordChanges();
  changes.listened = true;
});

const build = (previous?: ReadonlyMap<string, boolean>, userId = ME) =>
  buildThreadUnreadMap(room, threads, userId, { previous, changes });

/** The threads whose mark `run` checked. */
const checkedBy = <T>(run: () => T): [T, string[]] => {
  vi.mocked(getThreadUnread).mockClear();
  const result = run();
  return [result, vi.mocked(getThreadUnread).mock.calls.map(([checked]) => checked.id)];
};

describe('buildThreadUnreadMap reuse', () => {
  it('keeps the map itself when no mark changed', () => {
    const first = build();
    expect(Object.fromEntries(first)).toEqual({ $a: true, $b: true });

    const [second, checked] = checkedBy(() => build(first));

    expect(second).toBe(first);
    expect(checked).toEqual([]);
    // A thread marked again whose mark stays is checked, and the map is still the same.
    markThreadRecordChange(changes, '$a');
    expect(checkedBy(() => build(second))).toEqual([first, ['$a']]);
  });

  it('checks every thread while no one hears the room, who would mark its changes', () => {
    changes.listened = false;
    const first = build();

    expect(checkedBy(() => build(first))[1]).toEqual(['$a', '$b']);
  });

  it('checks another thread of the same root', () => {
    const first = build();
    threads = [threads[0]!, thread('$b', new Room(ROOM_ID, room.client, ME))];

    expect(checkedBy(() => build(first))[1]).toEqual(['$b']);
  });

  it('checks every thread for another reader, or once the events receipts name change', () => {
    const first = build();

    expect(checkedBy(() => build(first, '@bob:example.org'))[1]).toEqual(['$a', '$b']);

    const second = build(first);
    mocked.receiptEventsVersion.mockReturnValue(1);
    expect(checkedBy(() => build(second))[1]).toEqual(['$a', '$b']);
  });

  it('gives a new map once a mark changes or a thread leaves the list', () => {
    const first = build();
    vi.mocked(getThreadUnread).mockReturnValueOnce(false);
    markThreadRecordChange(changes, '$a');

    const second = build(first);
    expect(second).not.toBe(first);
    expect(Object.fromEntries(second)).toEqual({ $a: false, $b: true });

    threads = [threads[1]!];
    const third = build(second);
    expect(third).not.toBe(second);
    expect([...third.keys()]).toEqual(['$b']);
  });
});
