import {
  createClient,
  MatrixEvent,
  ReceiptType,
  RelationType,
  Room,
  RoomEvent,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepUnthreadedReceiptEvents } from '../../matrix/receiptReadTs';
import { getThreadReadState, getThreadUnread } from './roomThreadList';
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

/** A read receipt; `threadId` undefined makes it unthreaded. */
const receipt = (userId: string, eventId: string, ts: number, threadId: string | undefined) =>
  new MatrixEvent({
    type: 'm.receipt',
    room_id: ROOM_ID,
    content: {
      [eventId]: {
        [ReceiptType.Read]: { [userId]: { ts, ...(threadId && { thread_id: threadId }) } },
      },
    },
  });

/** A thread by Bob with its reply loaded; nobody has sent a receipt in the room. */
const setupThread = async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  keepUnthreadedReceiptEvents(mx);
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  mx.reEmitter.reEmit(room, [RoomEvent.Receipt]);
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
    room.addReceipt(receipt(USER_ID, '$other', 5000, '$x'));

    expect(thread.getEventReadUpTo(USER_ID)).toBe('$reply');
    expect(getThreadEventReadUpTo(thread, USER_ID)).toBeNull();
  });

  it("answers the thread's own receipt when it is the room's oldest thread receipt", async () => {
    const { room, thread } = await setupThread();
    // Sent after the reply it names: the case of the first thread opened, after a reload.
    room.addReceipt(receipt(USER_ID, '$reply', 3000, '$root'));

    expect(getThreadEventReadUpTo(thread, USER_ID)).toBe('$reply');
    expect(getThreadUnread(thread, USER_ID)).toBe(false);

    // A reply the receipt does not name stays unread, though it is older than the receipt.
    thread.addEvent(message('$later', 2500, '$root'), false);
    expect(thread.getEventReadUpTo(USER_ID)).toBe('$later');
    expect(getThreadEventReadUpTo(thread, USER_ID)).toBe('$reply');
    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it('answers the last event before a newer unthreaded receipt', async () => {
    const { room, thread } = await setupThread();
    room.addReceipt(receipt(USER_ID, '$other', 5000, '$x'));
    // Another device read the whole room.
    room.addReceipt(receipt(USER_ID, '$other', 6000, undefined));

    expect(getThreadEventReadUpTo(thread, USER_ID)).toBe('$reply');
  });

  it("keeps the SDK's answer for another member, and once the thread has newer activity", async () => {
    const { room, thread } = await setupThread();
    room.addReceipt(receipt(USER_ID, '$reply', 3000, '$root'));
    // The rule applies only to the signed-in user.
    room.addReceipt(receipt(OTHER_ID, '$reply', 3000, '$root'));

    expect(getThreadEventReadUpTo(thread, OTHER_ID)).toBe('$reply');
    thread.addEvent(message('$newer', 4000, '$root'), false);
    expect(getThreadEventReadUpTo(thread, USER_ID)).toBe('$reply');
  });

  it('reads a reply through a receipt on the edit that finished it, which the thread lacks', async () => {
    const { room, thread } = await setupThread();
    const reply = thread.events.at(-1)!;
    // After a reload, or on another device: the server bundles the reply's newest edit with it.
    reply.setUnsigned({
      'm.relations': {
        [RelationType.Replace]: {
          event_id: '$finish',
          sender: reply.getSender(),
          origin_server_ts: 2500,
        },
      },
    } as never);
    room.addReceipt(receipt(USER_ID, '$finish', 3000, '$root'));

    expect(getThreadEventReadUpTo(thread, USER_ID)).toBe('$reply');
    expect(getThreadUnread(thread, USER_ID)).toBe(false);
  });

  // Tuwunel v1.9.4-mindroom.31 on: a receipt reads up to the event it names, not to when the
  // server took it. Another device read up to the thread's first reply after later ones arrived.
  const readFirstReplyLater = async (threadReceiptElsewhere: boolean) => {
    const { room, thread } = await setupThread();
    thread.addEvent(message('$second', 3000, '$root'), false);
    thread.addEvent(message('$third', 4000, '$root'), false);
    // An older thread receipt elsewhere in the room keeps the SDK's rule for older accounts out.
    if (threadReceiptElsewhere) room.addReceipt(receipt(USER_ID, '$other', 1500, '$x'));
    room.addReceipt(receipt(USER_ID, '$reply', 5000, undefined));
    return thread;
  };

  it.each([true, false])(
    'answers the event an older unthreaded receipt names (thread receipt elsewhere: %s)',
    async (threadReceiptElsewhere) => {
      const thread = await readFirstReplyLater(threadReceiptElsewhere);

      expect(getThreadEventReadUpTo(thread, USER_ID)).toBe('$reply');
    }
  );

  it('leaves the replies after the event an older unthreaded receipt names unread', async () => {
    const thread = await readFirstReplyLater(true);

    expect(getThreadReadState(thread, USER_ID)?.readUpToTs).toBe(2000);
    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it('reads nothing through a receipt on an event that edits no loaded reply', async () => {
    const { room, thread } = await setupThread();
    room.addReceipt(receipt(USER_ID, '$unknown-edit', 3000, '$root'));

    expect(getThreadEventReadUpTo(thread, USER_ID)).toBeNull();
    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });
});
