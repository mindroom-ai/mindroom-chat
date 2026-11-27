import { createClient, MatrixEvent, ReceiptType, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { SyncAccumulator } from 'matrix-js-sdk/lib/sync-accumulator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getThreadUnread } from '../../event-store/threads/roomThreadList';
import {
  keepEveryReceiptInSavedSync,
  readSavedReceiptEventTs,
  SAVED_RECEIPT_EVENT_TS_KEY,
} from './savedSyncReceipts';

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

  const rawMsg = (id: string, ts: number) => ({
    event_id: id,
    room_id: ROOM_ID,
    sender: WRITER,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: id },
  });

  const syncBatch = (
    nextBatch: string,
    timelineEvents: ReturnType<typeof rawMsg>[],
    ephemeralEvents: unknown[],
    { prevBatch = `p-${nextBatch}`, limited = false } = {}
  ) =>
    ({
      next_batch: nextBatch,
      rooms: {
        join: {
          [ROOM_ID]: {
            ephemeral: { events: ephemeralEvents },
            timeline: { events: timelineEvents, prev_batch: prevBatch, limited },
            state: { events: [] },
            account_data: { events: [] },
          },
        },
        invite: {},
        leave: {},
        knock: {},
      },
    }) as unknown as Parameters<SyncAccumulator['accumulate']>[0];

  const receiptFrom = (accumulator: SyncAccumulator, eventId: string, type = ReceiptType.Read) => {
    const ephemeral = accumulator.getJSON().roomsData.join[ROOM_ID]?.ephemeral.events ?? [];
    const content: Record<string, Record<string, Record<string, unknown>>> | undefined =
      ephemeral[0]?.content;
    return content?.[eventId]?.[type]?.[READER];
  };

  it('preserves receipt target origin_server_ts across maxTimelineEntries=40 pruning, server repeats, and multiple reloads', () => {
    const live = new SyncAccumulator({ maxTimelineEntries: 40 });
    live.accumulate(
      syncBatch(
        's1',
        Array.from({ length: 20 }, (_, i) => rawMsg(`$msg-${i + 1}`, 101 + i)),
        [receiptEvent('$msg-10', ReceiptType.Read, { ts: 200, thread_id: 'main' })]
      )
    );
    live.accumulate(
      syncBatch(
        's2',
        Array.from({ length: 20 }, (_, i) => rawMsg(`$msg-${i + 21}`, 121 + i)),
        []
      )
    );
    live.accumulate(
      syncBatch(
        's3',
        Array.from({ length: 5 }, (_, i) => rawMsg(`$msg-${i + 41}`, 141 + i)),
        []
      )
    );

    // `$msg-1..20` (including `$msg-10`) were pruned by SyncAccumulator.
    const saved1 = live.getJSON(true);
    expect(saved1.roomsData.join[ROOM_ID]?.timeline.events.map((e) => e.event_id)).not.toContain(
      '$msg-10'
    );
    expect(readSavedReceiptEventTs(receiptFrom(live, '$msg-10'))).toBe(110);

    // Reload #1 from IndexedDB, receive an unstamped server repeat for `$msg-10`, save, reload #2.
    const reload1 = new SyncAccumulator({ maxTimelineEntries: 40 });
    reload1.accumulate(
      { next_batch: saved1.nextBatch, rooms: saved1.roomsData } as unknown as Parameters<
        SyncAccumulator['accumulate']
      >[0],
      true
    );
    const repeatPayload = { ts: 210, thread_id: 'main' };
    reload1.accumulate(
      syncBatch(
        's4',
        [rawMsg('$msg-46', 146)],
        [receiptEvent('$msg-10', ReceiptType.Read, repeatPayload)]
      )
    );
    // Input payload must never be mutated.
    expect(SAVED_RECEIPT_EVENT_TS_KEY in repeatPayload).toBe(false);
    expect(readSavedReceiptEventTs(receiptFrom(reload1, '$msg-10'))).toBe(110);

    const saved2 = reload1.getJSON(true);
    const reload2 = new SyncAccumulator({ maxTimelineEntries: 40 });
    reload2.accumulate(
      { next_batch: saved2.nextBatch, rooms: saved2.roomsData } as unknown as Parameters<
        SyncAccumulator['accumulate']
      >[0],
      true
    );
    expect(readSavedReceiptEventTs(receiptFrom(reload2, '$msg-10'))).toBe(110);
  });

  it('preserves receipt target origin_server_ts when a limited sync wipes the prior timeline', () => {
    const live = new SyncAccumulator({ maxTimelineEntries: 40 });
    live.accumulate(syncBatch('s1', [rawMsg('$old', 130)], []));
    // Receipt for `$old` arrives in the same limited sync that clears `_timeline`.
    live.accumulate(
      syncBatch(
        's2',
        [rawMsg('$after-gap', 300)],
        [receiptEvent('$old', ReceiptType.Read, { ts: 350 })],
        { limited: true }
      )
    );

    const saved = live.getJSON(true);
    expect(saved.roomsData.join[ROOM_ID]?.timeline.events.map((e) => e.event_id)).toEqual([
      '$after-gap',
    ]);
    expect(readSavedReceiptEventTs(receiptFrom(live, '$old'))).toBe(130);
  });

  it('strips untrusted saved_event_ts from live network receipts without mutating caller data', () => {
    const live = new SyncAccumulator({ maxTimelineEntries: 40 });
    const forgedUnknown = {
      ts: 500,
      thread_id: 'main',
      [SAVED_RECEIPT_EVENT_TS_KEY]: 999999,
    } as RawReceipt;
    live.accumulate(
      syncBatch(
        's1',
        [rawMsg('$known', 120)],
        [receiptEvent('$unknown', ReceiptType.Read, forgedUnknown)]
      )
    );

    expect(forgedUnknown[SAVED_RECEIPT_EVENT_TS_KEY as keyof RawReceipt]).toBe(999999);
    expect(readSavedReceiptEventTs(receiptFrom(live, '$unknown'))).toBeUndefined();

    // Forged value on a known event is replaced by the real origin_server_ts.
    const forgedKnown = {
      ts: 500,
      thread_id: 'main',
      [SAVED_RECEIPT_EVENT_TS_KEY]: 999999,
    } as RawReceipt;
    live.accumulate(syncBatch('s2', [], [receiptEvent('$known', ReceiptType.Read, forgedKnown)]));
    expect(forgedKnown[SAVED_RECEIPT_EVENT_TS_KEY as keyof RawReceipt]).toBe(999999);
    expect(readSavedReceiptEventTs(receiptFrom(live, '$known'))).toBe(120);
  });

  it('resets saved-timestamp trust even if a database accumulate throws', () => {
    const broken = new SyncAccumulator({ maxTimelineEntries: 40 });
    expect(() =>
      broken.accumulate(
        {
          next_batch: 'bad',
          rooms: { join: { [ROOM_ID]: null }, invite: {}, leave: {}, knock: {} },
        } as unknown as Parameters<SyncAccumulator['accumulate']>[0],
        true
      )
    ).toThrow();

    const live = new SyncAccumulator({ maxTimelineEntries: 40 });
    live.accumulate(
      syncBatch(
        's1',
        [],
        [
          receiptEvent('$unknown', ReceiptType.Read, {
            ts: 500,
            thread_id: 'main',
            [SAVED_RECEIPT_EVENT_TS_KEY]: 999999,
          } as RawReceipt),
        ]
      )
    );
    expect(readSavedReceiptEventTs(receiptFrom(live, '$unknown'))).toBeUndefined();
  });
});
