import { createClient, MatrixEvent, ReceiptType, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { SyncAccumulator } from 'matrix-js-sdk/lib/sync-accumulator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getThreadUnread } from '../../event-store/threads/roomThreadList';
import { keepEveryReceiptInSavedSync } from './savedSyncReceipts';

const ROOM_ID = '!saved-receipts:example.org';
const READER = '@reader:example.org';
const WRITER = '@writer:example.org';

type RawReceipt = { ts: number; thread_id?: string };

/** One `m.receipt` event as the server sends it: one receipt of the reader. */
const receiptEvent = (eventId: string, type: ReceiptType, receipt: RawReceipt) => ({
  type: 'm.receipt',
  content: { [eventId]: { [type]: { [READER]: receipt } } },
});

/** The sync store after these syncs, saved and loaded again as a reload does. */
const savedAndLoaded = (syncs: ReturnType<typeof receiptEvent>[][]) => {
  const live = new SyncAccumulator();
  syncs.forEach((events, index) =>
    live.accumulate({
      next_batch: `s${index + 1}`,
      rooms: {
        join: {
          [ROOM_ID]: {
            ephemeral: { events },
            timeline: { events: [], prev_batch: 'p0' },
            state: { events: [] },
            account_data: { events: [] },
          },
        },
        invite: {},
        leave: {},
        knock: {},
      },
    } as unknown as Parameters<SyncAccumulator['accumulate']>[0])
  );
  const saved = live.getJSON();
  const loaded = new SyncAccumulator();
  loaded.accumulate(
    { next_batch: saved.nextBatch, rooms: saved.roomsData } as unknown as Parameters<
      SyncAccumulator['accumulate']
    >[0],
    true
  );
  const ephemeral = loaded.getJSON().roomsData.join[ROOM_ID]?.ephemeral.events ?? [];
  return ephemeral.map((event) => new MatrixEvent({ ...event, room_id: ROOM_ID }));
};

const message = (id: string, ts: number, threadId?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: WRITER,
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

/** The reader's room after a reload: two threads by the writer and the saved receipts. */
const reloadedRoom = async (receipts: MatrixEvent[]) => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: READER });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM_ID, mx, READER);
  mx.store.storeRoom(room);
  const addThread = (rootId: string, rootTs: number) => {
    const root = message(rootId, rootTs);
    room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
    const reply = message(`${rootId}-reply`, rootTs + 100, rootId);
    return room.createThread(rootId, root, [reply], false);
  };
  const first = addThread('$first', 1000);
  const second = addThread('$second', 2000);
  await vi.waitFor(() => {
    expect(first.events.at(-1)?.getId()).toBe('$first-reply');
    expect(second.events.at(-1)?.getId()).toBe('$second-reply');
  });
  room.addEphemeralEvents(receipts);
  return { room, first, second };
};

describe('keepEveryReceiptInSavedSync', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    keepEveryReceiptInSavedSync();
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  it('keeps an unthreaded receipt on the event that a thread receipt also names', async () => {
    // The reader read the second thread, then marked the room read on its reply, the newest event.
    const receipts = savedAndLoaded([
      [receiptEvent('$second-reply', ReceiptType.Read, { ts: 3000, thread_id: '$second' })],
      [receiptEvent('$second-reply', ReceiptType.Read, { ts: 4000 })],
    ]);
    const { room, first, second } = await reloadedRoom(receipts);

    expect(room.getLastUnthreadedReceiptFor(READER)?.ts).toBe(4000);
    expect(getThreadUnread(first, READER)).toBe(false);
    expect(getThreadUnread(second, READER)).toBe(false);
  });

  it('keeps the newer public unthreaded receipt when the server repeats an older private one', async () => {
    // Marked read in public, then a private receipt elsewhere made the server send all private
    // receipts again, among them an older unthreaded one.
    const receipts = savedAndLoaded([
      [receiptEvent('$second-reply', ReceiptType.Read, { ts: 4000 })],
      [
        receiptEvent('$first', ReceiptType.ReadPrivate, { ts: 1050 }),
        receiptEvent('$first-reply', ReceiptType.ReadPrivate, { ts: 4500, thread_id: '$first' }),
      ],
    ]);
    const { room, second } = await reloadedRoom(receipts);

    expect(room.getLastUnthreadedReceiptFor(READER)?.ts).toBe(4000);
    expect(getThreadUnread(second, READER)).toBe(false);
  });

  it("keeps a thread's newer public receipt when the server repeats an older private one", async () => {
    const receipts = savedAndLoaded([
      [receiptEvent('$second-reply', ReceiptType.Read, { ts: 3000, thread_id: '$second' })],
      [receiptEvent('$second', ReceiptType.ReadPrivate, { ts: 2050, thread_id: '$second' })],
    ]);
    const { first, second } = await reloadedRoom(receipts);

    expect(getThreadUnread(second, READER)).toBe(false);
    expect(getThreadUnread(first, READER)).toBe(true);
  });

  it('saves no receipt event for a room without receipts', () => {
    expect(savedAndLoaded([[]])).toEqual([]);
  });
});
