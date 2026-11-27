import { ReceiptType } from 'matrix-js-sdk';
import { ReceiptAccumulator } from 'matrix-js-sdk/lib/receipt-accumulator';
import { SyncAccumulator, type IMinimalEvent } from 'matrix-js-sdk/lib/sync-accumulator';
import { isRecord } from '../../lib/isRecord';

// The SDK's sync store keeps each user's newest receipts per room and saves them as one
// `m.receipt` event, which a reload replays. It kept one unthreaded receipt per user and one per
// user and thread, whatever their type, so a private receipt the server sent again (it repeats all
// of them when one changes) replaced a newer public one. And the event holds one receipt per
// user, type and event, so a thread receipt on the event that an unthreaded receipt also names
// replaced the unthreaded one. After a reload the threads that receipt read came back unread,
// while the server counted them read.
//
// This keeps a user's receipts apart by type and by thread, as the server does, gives the
// unthreaded receipt the place when two name the same event (it reads all a thread receipt on that
// event reads, and more), and stamps each receipt with its target's `origin_server_ts` before
// timeline pruning or trimming drops that event from the saved sync.

/** Local-only target-event `origin_server_ts` persisted on saved receipts in `web-sync-store`. */
export const SAVED_RECEIPT_EVENT_TS_KEY = 'io.mindroom.saved_event_ts';

export const readSavedReceiptEventTs = (receipt: unknown): number | undefined => {
  const ts = isRecord(receipt) ? receipt[SAVED_RECEIPT_EVENT_TS_KEY] : undefined;
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : undefined;
};

type ReceiptEntry = { eventId: string; data: Record<string, unknown> };
type SavedReceipt = ReceiptEntry & { type: string; userId: string };

const RECEIPT_TYPES = new Set<string>([ReceiptType.Read, ReceiptType.ReadPrivate]);
const savedReceipts = new WeakMap<ReceiptAccumulator, Map<string, SavedReceipt>>();
let trustingSavedEventTs = false;

const receiptsOf = (accumulator: ReceiptAccumulator): Map<string, SavedReceipt> => {
  let receipts = savedReceipts.get(accumulator);
  if (!receipts) {
    receipts = new Map();
    savedReceipts.set(accumulator, receipts);
  }
  return receipts;
};

const threadOf = (receipt: SavedReceipt): string | undefined =>
  typeof receipt.data.thread_id === 'string' ? receipt.data.thread_id : undefined;

const sanitizeReceiptData = (
  data: Record<string, unknown>,
  receipts: Map<string, SavedReceipt>,
  eventId: string
): Record<string, unknown> => {
  const clean =
    !trustingSavedEventTs && SAVED_RECEIPT_EVENT_TS_KEY in data
      ? Object.fromEntries(Object.entries(data).filter(([k]) => k !== SAVED_RECEIPT_EVENT_TS_KEY))
      : data;
  if (readSavedReceiptEventTs(clean) !== undefined) return clean;
  for (const entry of receipts.values()) {
    if (entry.eventId !== eventId) continue;
    const ts = readSavedReceiptEventTs(entry.data);
    if (ts !== undefined) return { ...clean, [SAVED_RECEIPT_EVENT_TS_KEY]: ts };
  }
  return clean;
};

/** Stamps unstamped receipts in `accumulator` with their target's `origin_server_ts` from `eventLists`. */
export const preserveReceiptEventTimestamps = (
  accumulator: unknown,
  ...eventLists: ReadonlyArray<ReadonlyArray<unknown> | undefined>
): void => {
  if (!(accumulator instanceof ReceiptAccumulator)) return;
  const saved = savedReceipts.get(accumulator);
  const native = accumulator as unknown as {
    allUnthreaded?: () => Iterable<[string, ReceiptEntry]>;
    allThreaded?: () => Iterable<[string, ReceiptEntry]>;
  };
  const entries: ReceiptEntry[] = saved
    ? [...saved.values()]
    : [...(native.allUnthreaded?.() ?? []), ...(native.allThreaded?.() ?? [])].map(([, r]) => r);
  const pending = entries.filter((entry) => readSavedReceiptEventTs(entry.data) === undefined);
  if (pending.length === 0) return;

  const needed = new Set(pending.map((entry) => entry.eventId));
  const tsById = new Map<string, number>();
  for (const list of eventLists) {
    for (const item of list ?? []) {
      const raw = isRecord(item) && isRecord(item.event) ? item.event : item;
      if (!isRecord(raw) || typeof raw.event_id !== 'string' || !needed.has(raw.event_id)) continue;
      if (typeof raw.origin_server_ts === 'number' && Number.isFinite(raw.origin_server_ts)) {
        tsById.set(raw.event_id, raw.origin_server_ts);
        if (tsById.size === needed.size) break;
      }
    }
    if (tsById.size === needed.size) break;
  }
  pending.forEach((entry) => {
    const ts = tsById.get(entry.eventId);
    if (ts !== undefined) entry.data = { ...entry.data, [SAVED_RECEIPT_EVENT_TS_KEY]: ts };
  });
};

function consumeEphemeralEvents(this: ReceiptAccumulator, events: IMinimalEvent[] | undefined) {
  const receipts = receiptsOf(this);
  events?.forEach((event) => {
    if (event.type !== 'm.receipt' || !isRecord(event.content)) return;
    Object.entries(event.content).forEach(([eventId, byType]) => {
      if (!isRecord(byType)) return;
      Object.entries(byType).forEach(([type, byUser]) => {
        if (!RECEIPT_TYPES.has(type) || !isRecord(byUser)) return;
        Object.entries(byUser).forEach(([userId, data]) => {
          if (!isRecord(data)) return;
          const receipt = {
            eventId,
            type,
            userId,
            data: sanitizeReceiptData(data, receipts, eventId),
          };
          // The server sends a user's receipts of one type and thread in order: the last wins.
          receipts.set(JSON.stringify([threadOf(receipt) ?? '', type, userId]), receipt);
        });
      });
    });
  });
}

function buildAccumulatedReceiptEvent(
  this: ReceiptAccumulator,
  roomId: string
): IMinimalEvent | null {
  const receipts = [...receiptsOf(this).values()];
  if (receipts.length === 0) return null;
  const content: Record<string, Record<string, Record<string, unknown>>> = {};
  // Unthreaded receipts last, so they keep the place a thread receipt on their event wanted.
  const ordered = [
    ...receipts.filter((receipt) => threadOf(receipt) !== undefined),
    ...receipts.filter((receipt) => threadOf(receipt) === undefined),
  ];
  ordered.forEach(({ eventId, type, userId, data }) => {
    const byType = (content[eventId] ??= {});
    (byType[type] ??= {})[userId] = data;
  });
  return { type: 'm.receipt', room_id: roomId, content };
}

/**
 * Makes the SDK's sync store save every receipt a reload needs (see above). Call it before a sync
 * store starts, since starting replays the saved receipts; it changes the SDK's receipt store
 * once, for every client.
 */
export const keepEveryReceiptInSavedSync = (): void => {
  const accumulator = ReceiptAccumulator.prototype;
  if (accumulator.consumeEphemeralEvents === consumeEphemeralEvents) return;
  accumulator.consumeEphemeralEvents = consumeEphemeralEvents;
  accumulator.buildAccumulatedReceiptEvent = buildAccumulatedReceiptEvent;

  const syncProto = SyncAccumulator.prototype as unknown as {
    accumulateJoinState: (
      this: { joinRooms?: Record<string, { _timeline?: unknown[]; _receipts?: unknown }> },
      roomId: string,
      data: Record<string, unknown>,
      fromDatabase?: boolean
    ) => void;
  };
  const sdkAccumulateJoinState = syncProto.accumulateJoinState;
  syncProto.accumulateJoinState = function accumulateJoinState(roomId, data, fromDatabase = false) {
    const prevTimeline = this.joinRooms?.[roomId]?._timeline;
    const previousTrust = trustingSavedEventTs;
    trustingSavedEventTs = Boolean(fromDatabase);
    try {
      sdkAccumulateJoinState.call(this, roomId, data, fromDatabase);
    } finally {
      trustingSavedEventTs = previousTrust;
    }
    const room = this.joinRooms?.[roomId];
    const incoming =
      isRecord(data.timeline) && Array.isArray(data.timeline.events)
        ? data.timeline.events
        : undefined;
    if (room) preserveReceiptEventTimestamps(room._receipts, incoming, prevTimeline);
  };
};
