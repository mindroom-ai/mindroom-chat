import { createClient, MatrixEvent, ReceiptType, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getThreadEventReadUpTo } from './threadEventReadUpTo';

const ROOM_ID = '!read-up-to:example.org';
const USER_ID = '@alice:example.org';
const OTHER_ID = '@carol:example.org';

const message = (id: string, ts: number, threadId?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@bob:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(threadId
        ? { 'm.relates_to': { rel_type: RelationType.Thread, event_id: threadId } }
        : {}),
    },
  });

const threadReceipt = (userId: string, eventId: string, ts: number) =>
  new MatrixEvent({
    type: 'm.receipt',
    room_id: ROOM_ID,
    content: { [eventId]: { [ReceiptType.Read]: { [userId]: { thread_id: '$root', ts } } } },
  });

/** A thread by Bob with its reply loaded; nobody has sent a receipt in the room. */
const setupThread = async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  const root = message('$root', 1000);
  room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const thread = room.createThread('$root', root, [message('$reply', 2000, '$root')], false);
  await vi.waitFor(() => expect(thread.events.at(-1)?.getId()).toBe('$reply'));
  return { room, thread };
};

describe('getThreadEventReadUpTo', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  it("answers no event where only the SDK's rule for older accounts reads the thread", async () => {
    const { room, thread } = await setupThread();
    // A thread receipt of the user's elsewhere in the room, newer than this thread's reply.
    room.addReceipt(
      new MatrixEvent({
        type: 'm.receipt',
        room_id: ROOM_ID,
        content: { $other: { [ReceiptType.Read]: { [USER_ID]: { thread_id: '$x', ts: 5000 } } } },
      })
    );

    expect(thread.getEventReadUpTo(USER_ID)).toBe('$reply');
    expect(getThreadEventReadUpTo(thread, USER_ID)).toBeNull();
  });

  it("keeps the SDK's answer from a receipt in the thread", async () => {
    const { room, thread } = await setupThread();
    room.addReceipt(threadReceipt(USER_ID, '$reply', 3000));
    // The rule applies only to the signed-in user; another member's receipt still counts.
    room.addReceipt(threadReceipt(OTHER_ID, '$reply', 3000));

    expect(getThreadEventReadUpTo(thread, OTHER_ID)).toBe('$reply');
    thread.addEvent(message('$later', 4000, '$root'), false);
    expect(getThreadEventReadUpTo(thread, USER_ID)).toBe('$reply');
  });
});
