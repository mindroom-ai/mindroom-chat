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

/** A room whose thread has its reply loaded, for an account that never sent a thread receipt. */
const setupRoom = async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  const requests = vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({});
  const root = message('$root', 1000);
  const reply = message('$reply', 2000, '$root');
  room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const thread = room.createThread('$root', root, [reply], false);
  await vi.waitFor(() =>
    expect(thread.events.some((event) => event.getId() === '$reply')).toBe(true)
  );
  return { mx, room, thread, requests };
};

const receiptRequests = (requests: { mock: { calls: unknown[][] } }) =>
  requests.mock.calls.filter(([, path]) => String(path).includes('/receipt/'));

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

  it('is sent for a reply the SDK already counts as read, so a later reply shows as unread', async () => {
    const { mx, room, thread, requests } = await setupRoom();
    // Without any thread receipt from this account, the SDK reads every loaded reply as read.
    expect(room.getOldestThreadedReceiptTs()).toBe(Number.POSITIVE_INFINITY);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);
    thread.addEvent(message('$unseen', 3000, '$root'), false);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);

    await markThreadAsRead(mx, ROOM_ID, '$root', false);

    expect(receiptRequests(requests)).toEqual([
      [
        'POST',
        `/rooms/${encodeURIComponent(ROOM_ID)}/receipt/${ReceiptType.Read}/%24unseen`,
        undefined,
        { thread_id: '$root' },
      ],
    ]);
    expect(room.getOldestThreadedReceiptTs()).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(getThreadUnread(thread, USER_ID)).toBe(false);

    thread.addEvent(message('$later', Date.now() + 60_000, '$root'), false);
    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it('is sent only once: a read thread gets no receipt after it', async () => {
    const { mx, requests } = await setupRoom();
    await markThreadAsRead(mx, ROOM_ID, '$root', false);
    requests.mockClear();

    await markThreadAsRead(mx, ROOM_ID, '$root', false);

    expect(receiptRequests(requests)).toEqual([]);
  });
});
