import { createClient, MatrixEvent, ReceiptType, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getThreadUnread } from './roomThreadList';

// A streamed reply read half-way is unread again when it finishes: the server counts the
// finished reply as new from the edit that ends the stream, and so does the thread's unread state.

const ROOM_ID = '!stream-unread:example.org';
const USER_ID = '@reader:example.org';
const HELPER = '@helper:example.org';

const event = (id: string, ts: number, content: Record<string, unknown>) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: HELPER,
    type: 'm.room.message',
    origin_server_ts: ts,
    content,
  });

const edit = (id: string, ts: number, status: string) =>
  event(id, ts, {
    msgtype: 'm.text',
    body: '* Done',
    'm.new_content': { msgtype: 'm.text', body: 'Done', 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
  });

const receipt = (eventId: string, ts: number) =>
  new MatrixEvent({
    type: 'm.receipt',
    room_id: ROOM_ID,
    content: { [eventId]: { [ReceiptType.Read]: { [USER_ID]: { ts, thread_id: '$root' } } } },
  });

/** A thread whose reply the helper streams; the reader's receipt names the reply. */
const setup = async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  const root = event('$root', 1000, { msgtype: 'm.text', body: 'Ready to tag?' });
  room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const reply = event('$reply', 2000, {
    msgtype: 'm.text',
    body: 'Checking',
    'io.mindroom.stream_status': 'streaming',
    'm.relates_to': { rel_type: RelationType.Thread, event_id: '$root' },
  });
  const thread = room.createThread('$root', root, [reply], false);
  await vi.waitFor(() => expect(thread.events.at(-1)?.getId()).toBe('$reply'));
  // Read half-way: the reader saw the reply while it streamed.
  room.addReceipt(receipt('$reply', 2500));
  return { room, thread, reply };
};

describe('getThreadUnread, a streamed reply', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  it('read half-way stays read while it streams', async () => {
    const { thread, reply } = await setup();
    reply.makeReplaced(edit('$step', 2600, 'streaming'));

    expect(getThreadUnread(thread, USER_ID)).toBe(false);
  });

  it('read half-way is unread once it finishes while the reader is away', async () => {
    const { thread, reply } = await setup();
    reply.makeReplaced(edit('$finish', 3000, 'completed'));

    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it('read half-way is unread when the finishing edit has the reply\'s timestamp', async () => {
    const { thread, reply } = await setup();
    // Both in the same millisecond: the edit still comes after the reply the receipt names.
    reply.makeReplaced(edit('$finish', 2000, 'completed'));

    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it('read half-way is unread when the server bundles the finishing edit with the reply', async () => {
    const { thread, reply } = await setup();
    reply.setUnsigned({
      'm.relations': { [RelationType.Replace]: edit('$finish', 3000, 'completed').event },
    } as never);

    expect(getThreadUnread(thread, USER_ID)).toBe(true);
  });

  it('watched to the end is read, also where the thread does not hold the finishing edit', async () => {
    const { room, thread, reply } = await setup();
    // After a reload or on another device: only the bundled edit, and the receipt names it.
    reply.setUnsigned({
      'm.relations': { [RelationType.Replace]: edit('$finish', 3000, 'completed').event },
    } as never);
    room.addReceipt(receipt('$finish', 3100));

    expect(getThreadUnread(thread, USER_ID)).toBe(false);
  });

  it('read after it finished, by a receipt on a later event, is read', async () => {
    const { room, thread, reply } = await setup();
    reply.makeReplaced(edit('$finish', 3000, 'completed'));
    room.addReceipt(
      new MatrixEvent({
        type: 'm.receipt',
        room_id: ROOM_ID,
        content: { $later: { [ReceiptType.Read]: { [USER_ID]: { ts: 4000 } } } },
      })
    );

    expect(getThreadUnread(thread, USER_ID)).toBe(false);
  });
});
