import { MatrixEvent, ReceiptType } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSeenThreadRoots, rememberSeenThreadRoot } from '../../matrix/seenThreadRoots';
import {
  buildThreadRecordMap,
  createThreadRecordChanges,
  markThreadRecordChange,
  type ThreadRecordChanges,
} from './threadRecord';
import type { ThreadRecord } from './types';

const mocked = vi.hoisted(() => ({ listed: false, receiptEventsVersion: vi.fn(() => 0) }));
vi.mock('../../matrix/receiptReadTs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/receiptReadTs')>()),
  receiptEventsVersion: mocked.receiptEventsVersion,
}));
vi.mock('./roomThreadList', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./roomThreadList')>()),
  roomThreadListIsListed: () => mocked.listed,
}));

// A build keeps the records of the threads nothing changed for, so a room event costs the record
// of the thread it touches, not one per thread of the room.
const ME = '@me:example.org';
const ROOM_ID = '!room:example.org';
const IDS = ['$a', '$b'];

const root = (eventId: string) =>
  new MatrixEvent({
    content: { body: eventId, msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 2000,
    room_id: ROOM_ID,
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

let roots: Map<string, MatrixEvent>;
let receiptTs: number | undefined;
let changes: ThreadRecordChanges;
let room: Room;

beforeEach(() => {
  mocked.listed = false;
  mocked.receiptEventsVersion.mockReturnValue(0);
  clearSeenThreadRoots(ME);
  roots = new Map(IDS.map((id) => [id, root(id)]));
  receiptTs = undefined;
  changes = createThreadRecordChanges();
  room = {
    roomId: ROOM_ID,
    getThread: () => null,
    findEventById: (eventId: string) => roots.get(eventId),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    getMember: () => null,
    getMembers: () => [],
    getLastUnthreadedReceiptFor: () => undefined,
    // The reader's main receipt, which the room changes in place.
    getReadReceiptForUserId: (_userId: string, _ignore: boolean, type: ReceiptType) =>
      receiptTs !== undefined && type === ReceiptType.Read
        ? { eventId: '$older', data: { ts: receiptTs, thread_id: 'main' } }
        : null,
  } as unknown as Room;
});

const build = (
  previous?: ReadonlyMap<string, ThreadRecord>,
  options: Partial<Parameters<typeof buildThreadRecordMap>[0]> = {}
) =>
  buildThreadRecordMap({
    room,
    threadRootIds: IDS,
    threadRootEventMap: roots,
    currentUserId: ME,
    reuse: { previous, changes },
    ...options,
  });

const unread = (records: Map<string, ThreadRecord>) =>
  IDS.map((id) => records.get(id)?.status.isUnread);

describe('buildThreadRecordMap reuse', () => {
  it('keeps every record when nothing changed', () => {
    const first = build();
    const second = build(first);

    expect(second).not.toBe(first);
    expect(second.get('$a')).toBe(first.get('$a'));
    expect(second.get('$b')).toBe(first.get('$b'));
  });

  it('builds only the record of the thread a change was marked for', () => {
    const first = build();
    expect(unread(first)).toEqual([true, true]);

    receiptTs = 3000;
    markThreadRecordChange(changes, '$a');
    const second = build(first);

    expect(second.get('$a')).not.toBe(first.get('$a'));
    expect(second.get('$b')).toBe(first.get('$b'));
    expect(unread(second)).toEqual([false, true]);
    // The change is not marked again, so the next build keeps both.
    expect(build(second).get('$a')).toBe(second.get('$a'));
  });

  it('builds every record after a change marked for the room', () => {
    const first = build();

    receiptTs = 3000;
    markThreadRecordChange(changes, '$a');
    markThreadRecordChange(changes);
    const second = build(first);

    expect(unread(second)).toEqual([false, false]);
    expect(build(second).get('$b')).toBe(second.get('$b'));
  });

  it('builds the record of a thread marked before the room was', () => {
    markThreadRecordChange(changes, '$a');
    const first = build();

    receiptTs = 3000;
    markThreadRecordChange(changes);
    const second = build(first);

    expect(second.get('$a')).not.toBe(first.get('$a'));
    expect(unread(second)).toEqual([false, false]);
  });

  it('keeps no record built before a change that an older build did not see', () => {
    const first = build();
    markThreadRecordChange(changes, '$a');
    const second = build(first);
    receiptTs = 3000;
    markThreadRecordChange(changes, '$b');

    const third = build(second);

    expect(third.get('$a')).toBe(second.get('$a'));
    expect(third.get('$b')).not.toBe(second.get('$b'));
    // A build from the older records sees both changes.
    const fromFirst = build(first);
    expect(fromFirst.get('$a')).not.toBe(first.get('$a'));
    expect(fromFirst.get('$b')).not.toBe(first.get('$b'));
  });

  it('gives a thread that only moved in the list its new place, without building its record', () => {
    const first = build(undefined, { absoluteIndexMap: new Map([['$a', 1]]) });

    // Unmarked, so a record that was built again would show it.
    receiptTs = 3000;
    const second = build(first, { absoluteIndexMap: new Map([['$a', 2]]) });

    expect(second.get('$a')).toEqual({ ...first.get('$a'), absoluteIndex: 2 });
    expect(second.get('$b')).toBe(first.get('$b'));
    // The moved record is kept like any other, and built again once its thread is marked.
    expect(build(second, { absoluteIndexMap: new Map([['$a', 2]]) }).get('$a')).toBe(
      second.get('$a')
    );
    markThreadRecordChange(changes, '$a');
    const fourth = build(second, { absoluteIndexMap: new Map([['$a', 2]]) });
    expect(fourth.get('$a')?.status.isUnread).toBe(false);
  });

  it('builds the record of a thread given another value', () => {
    const counts = new Map([['$a', 1]]);
    const first = build(undefined, { fallbackReplyCountMap: counts });

    const second = build(first, { fallbackReplyCountMap: new Map([['$a', 2]]) });

    expect(second.get('$a')).not.toBe(first.get('$a'));
    expect(second.get('$a')?.status.replyCount).toBe(2);
    expect(second.get('$b')).toBe(first.get('$b'));
  });

  it('keeps a record given an equal list or object anew, not one whose holder changed inside', () => {
    const given = () => ({
      fallbackParticipantMap: new Map([['$a', ['@bob:example.org']]]),
      threadResolutionMap: new Map([['$b', { isResolved: true, tags: null }]]),
    });
    const first = build(undefined, given());

    const second = build(first, given());

    expect(second.get('$a')).toBe(first.get('$a'));
    expect(second.get('$b')).toBe(first.get('$b'));

    const third = build(second, {
      fallbackParticipantMap: new Map([['$a', ['@carol:example.org']]]),
      threadResolutionMap: new Map([['$b', { isResolved: false, tags: null }]]),
    });

    expect(third.get('$a')).not.toBe(second.get('$a'));
    expect(third.get('$b')?.status.isResolved).toBe(false);
  });

  it('builds the record given a longer list, an object with another key, or another event', () => {
    const first = build(undefined, {
      fallbackParticipantMap: new Map([['$a', ['@bob:example.org']]]),
      threadResolutionMap: new Map([['$b', { isResolved: false }]]),
    });

    const second = build(first, {
      fallbackParticipantMap: new Map([['$a', ['@bob:example.org', '@carol:example.org']]]),
      threadResolutionMap: new Map([['$b', { isResolved: false, tags: { bug: {} } }]]),
    });

    expect(second.get('$a')).not.toBe(first.get('$a'));
    expect(second.get('$b')?.status.tags).toEqual(['bug']);

    // Another copy of the root, as a page of history brings, is another event.
    roots = new Map(IDS.map((id) => [id, root(id)]));
    const third = build(second, {
      fallbackParticipantMap: new Map([['$a', ['@bob:example.org', '@carol:example.org']]]),
      threadResolutionMap: new Map([['$b', { isResolved: false, tags: { bug: {} } }]]),
    });

    expect(third.get('$a')).not.toBe(second.get('$a'));
  });

  it('builds every record after the reader opened a root on this device', () => {
    const first = build();

    rememberSeenThreadRoot(ME, ROOM_ID, roots.get('$b')!, 0);
    const second = build(first);

    expect(unread(second)).toEqual([true, false]);
    expect(second.get('$a')).not.toBe(first.get('$a'));
  });

  it("builds every record once the room's thread list is in", () => {
    const first = build();

    mocked.listed = true;
    const second = build(first);

    expect(second.get('$a')).not.toBe(first.get('$a'));
    expect(second.get('$b')).not.toBe(first.get('$b'));
    expect(build(second).get('$a')).toBe(second.get('$a'));
  });

  it("builds every record once the events its room's receipts name change", () => {
    const first = build();

    mocked.receiptEventsVersion.mockReturnValue(1);
    const second = build(first);

    expect(second.get('$a')).not.toBe(first.get('$a'));
    expect(second.get('$b')).not.toBe(first.get('$b'));
    expect(mocked.receiptEventsVersion).toHaveBeenLastCalledWith(room);
  });
});
