import { createClient, MatrixEvent, ReceiptType, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMainTimelineMessageUnread } from '../matrix/mainTimelineRead';
import { roomHaveUnread } from '../matrix/room';
import { clearSeenThreadRoots } from '../matrix/seenThreadRoots';
import { markThreadAsRead } from './readReceipts';

// Reading a thread reads its root, which belongs to the main timeline. A main receipt reads all of
// the main timeline on the server, so it goes out only once nothing else there is unread.
const ROOM_ID = '!thread-root:example.org';
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
 * A room the reader read up to `$older`; then Bob started two threads, each with a reply the
 * thread knows from its root's summary.
 */
const setupRoom = async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  const requests = vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({});
  const timelineSet = room.getUnfilteredTimelineSet();
  const older = message('$older', 1000);
  timelineSet.addLiveEvent(older, { addToState: false });
  room.addReceipt(
    new MatrixEvent({
      type: 'm.receipt',
      room_id: ROOM_ID,
      content: {
        $older: { [ReceiptType.Read]: { [USER_ID]: { thread_id: 'main', ts: 1500 } } },
        // A thread receipt from before, so the SDK counts later replies as unread.
        $earlier: { [ReceiptType.Read]: { [USER_ID]: { thread_id: '$first', ts: 1500 } } },
      },
    })
  );
  const threads = ['$first', '$second'].map((rootId, index) => {
    const root = message(rootId, 2000 + index * 1000);
    const reply = message(`${rootId}-reply`, 2500 + index * 1000, rootId);
    root.setUnsigned({
      'm.relations': {
        [RelationType.Thread]: {
          count: 1,
          current_user_participated: false,
          latest_event: reply.event,
        },
      },
    });
    timelineSet.addLiveEvent(root, { addToState: false });
    return { root, thread: room.createThread(rootId, root, [], false) };
  });
  await vi.waitFor(() => threads.forEach(({ thread }) => expect(thread.replyToEvent).toBeTruthy()));
  return { mx, room, requests, roots: threads.map(({ root }) => root) };
};

const receipts = (requests: { mock: { calls: unknown[][] } }) =>
  requests.mock.calls
    .filter(([, path]) => String(path).includes('/receipt/'))
    .map(([, path, , body]) => {
      const [, type, eventId] = /\/receipt\/([^/]+)\/(.+)$/.exec(String(path)) ?? [];
      return { type, eventId: decodeURIComponent(eventId ?? ''), body };
    });

describe('reading the root of an opened thread', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    clearSeenThreadRoots(USER_ID);
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'reads the newest root on this device first, and on the server once the rest is read (private: %s)',
    async (privateReceipt) => {
      const { mx, room, requests, roots } = await setupRoom();
      const [first, second] = roots as [MatrixEvent, MatrixEvent];
      const type = privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read;

      // The newest thread first: a main receipt would read the older root too.
      await markThreadAsRead(mx, ROOM_ID, '$second', privateReceipt);
      expect(receipts(requests)).toEqual([
        { type, eventId: '$second-reply', body: { thread_id: '$second' } },
      ]);
      expect(isMainTimelineMessageUnread(room, second, USER_ID)).toBe(false);
      expect(isMainTimelineMessageUnread(room, first, USER_ID)).toBe(true);
      expect(roomHaveUnread(mx, room)).toBe(true);

      // The last unread root: the main receipt goes on the newest main-timeline event.
      requests.mockClear();
      await markThreadAsRead(mx, ROOM_ID, '$first', privateReceipt);
      expect(receipts(requests)).toEqual([
        { type, eventId: '$second', body: { thread_id: 'main' } },
        { type, eventId: '$first-reply', body: { thread_id: '$first' } },
      ]);
      expect(isMainTimelineMessageUnread(room, first, USER_ID)).toBe(false);
      expect(roomHaveUnread(mx, room)).toBe(false);

      // Nothing is left to read, so reading again sends nothing.
      requests.mockClear();
      await markThreadAsRead(mx, ROOM_ID, '$second', privateReceipt);
      expect(receipts(requests)).toEqual([]);
    }
  );

  it('never sends an unthreaded receipt, which would read every thread', async () => {
    const { mx, requests } = await setupRoom();
    await markThreadAsRead(mx, ROOM_ID, '$first', false);
    await markThreadAsRead(mx, ROOM_ID, '$second', false);
    expect(receipts(requests).length).toBeGreaterThan(0);
    receipts(requests).forEach(({ body }) => expect(body).toHaveProperty('thread_id'));
  });
});
