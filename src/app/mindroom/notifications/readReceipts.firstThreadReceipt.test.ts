import { createClient, MatrixEvent, ReceiptType, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getThreadUnread } from '../threads/roomThreadList';
import { markThreadAsRead } from './readReceipts';

const ROOM_ID = '!first-receipt:example.org';
const USER_ID = '@alice:example.org';

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

/**
 * A room with two threads by Bob, their replies loaded, for an account that never sent a thread
 * receipt there.
 */
const setupRoom = async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  const requests = vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({});
  const roots = [message('$older', 1000), message('$newer', 1100)];
  roots.forEach((root) =>
    room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false })
  );
  // The reader read the main timeline, the roots included, so only the threads are left to read.
  room.addReceipt(
    new MatrixEvent({
      type: 'm.receipt',
      room_id: ROOM_ID,
      content: { $newer: { [ReceiptType.Read]: { [USER_ID]: { thread_id: 'main', ts: 1500 } } } },
    })
  );
  const [older, newer] = roots.map((root, index) => {
    const reply = message(`${root.getId()}-reply`, 2000 + index * 1000, root.getId());
    return room.createThread(root.getId()!, root, [reply], false);
  }) as [Thread, Thread];
  await vi.waitFor(() =>
    [older, newer].forEach((thread) => expect(thread.events.at(-1)?.getId()).toMatch(/-reply$/))
  );
  return { mx, room, older, newer, requests };
};

/** The receipts sent, as the event each names and its thread. */
const receipts = (requests: { mock: { calls: unknown[][] } }) =>
  requests.mock.calls
    .filter(([, path]) => String(path).includes('/receipt/'))
    .map(([, path, , body]) => [
      decodeURIComponent(String(path).split('/').at(-1) ?? ''),
      (body as { thread_id?: string } | undefined)?.thread_id,
    ]);

describe('the first thread receipt in a room', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  it('leaves the other thread unread, and that thread gets its own receipt once read', async () => {
    const { mx, room, older, newer, requests } = await setupRoom();
    // The SDK counts every loaded reply as read while the account has no thread receipt here.
    expect(room.getOldestThreadedReceiptTs()).toBe(Number.POSITIVE_INFINITY);
    expect(older.getEventReadUpTo(USER_ID)).toBe('$older-reply');
    expect(getThreadUnread(older, USER_ID)).toBe(true);
    expect(getThreadUnread(newer, USER_ID)).toBe(true);

    await markThreadAsRead(mx, ROOM_ID, '$newer', false);

    expect(receipts(requests)).toEqual([['$newer-reply', '$newer']]);
    expect(getThreadUnread(newer, USER_ID)).toBe(false);
    // The SDK now counts the older thread as read, since its reply predates that receipt.
    expect(older.getEventReadUpTo(USER_ID)).toBe('$older-reply');
    expect(getThreadUnread(older, USER_ID)).toBe(true);

    await markThreadAsRead(mx, ROOM_ID, '$older', false);

    expect(receipts(requests)).toEqual([
      ['$newer-reply', '$newer'],
      ['$older-reply', '$older'],
    ]);
    expect(getThreadUnread(older, USER_ID)).toBe(false);
  });

  it('lets a later reply show as unread', async () => {
    const { mx, newer } = await setupRoom();
    await markThreadAsRead(mx, ROOM_ID, '$newer', false);

    newer.addEvent(message('$later', 4000, '$newer'), false);

    expect(getThreadUnread(newer, USER_ID)).toBe(true);
  });

  it('is sent only once: a read thread gets no receipt after it', async () => {
    const { mx, requests } = await setupRoom();
    await markThreadAsRead(mx, ROOM_ID, '$newer', false);
    requests.mockClear();

    await markThreadAsRead(mx, ROOM_ID, '$newer', false);

    expect(receipts(requests)).toEqual([]);
  });
});
