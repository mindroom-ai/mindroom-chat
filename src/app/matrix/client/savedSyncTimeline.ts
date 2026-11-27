import { isRecord } from '../../lib/isRecord';
import { STARTUP_SYNC_TIMELINE_LIMIT, SYNC_ARCHIVE_TIMELINE_LIMIT } from './clientSyncPolicy';
import { preserveReceiptEventTimestamps } from './savedSyncReceipts';

// Legacy `web-sync-store` databases saved up to 500 timeline events per room. Because `getJSON(true)`
// flattens intermediate pagination tokens to a single `prev_batch` at index 0, lowering
// `maxTimelineEntries` alone cannot prune a loaded legacy room: `SyncAccumulator` scans from
// `length - maxTimelineEntries` for a token and finds none. Trimming oversized rooms on startup
// shrinks legacy payloads down to one startup page while keeping back-pagination intact.

/** The SDK's sync accumulator: joined rooms hold `_timeline` entries and a `nextBatch` cursor. */
export type SavedTimelineSync = {
  joinRooms?: Record<string, object>;
  getNextBatchToken?: () => string | null | undefined;
  nextBatch?: string | null;
};

const hasToken = (entry: unknown): boolean =>
  isRecord(entry) && typeof entry.token === 'string' && entry.token.length > 0;

/**
 * Trims any joined room timeline longer than `maxLimit` in `sync` down to `targetLimit` events,
 * preferring an existing internal batch boundary token and otherwise anchoring the trimmed start at
 * `sync`'s `nextBatch` token so back-pagination overlaps and deduplicates with zero gaps.
 */
export const trimSavedSyncTimelines = (
  sync: SavedTimelineSync,
  maxLimit = SYNC_ARCHIVE_TIMELINE_LIMIT,
  targetLimit = STARTUP_SYNC_TIMELINE_LIMIT
): void => {
  if (maxLimit <= 0 || targetLimit <= 0) return;

  Object.values(sync.joinRooms ?? {}).forEach((room) => {
    if (!isRecord(room) || !Array.isArray(room._timeline)) return;
    const timeline = room._timeline as unknown[];
    if (timeline.length <= maxLimit || !hasToken(timeline[0])) return;

    const startIndex = Math.max(0, timeline.length - targetLimit);
    // Live multi-batch accumulators keep batch-start tokens on later entries; startup IDB loads
    // flatten intermediate tokens to index 0 and fall through to the `nextBatch` anchor below.
    for (let i = startIndex; i < timeline.length; i += 1) {
      if (hasToken(timeline[i])) {
        preserveReceiptEventTimestamps(room._receipts, timeline);
        room._timeline = timeline.slice(i);
        return;
      }
    }

    const nextBatch = sync.getNextBatchToken?.() ?? sync.nextBatch;
    if (typeof nextBatch !== 'string' || nextBatch.length === 0) return;
    const kept = timeline.slice(startIndex);
    const first = kept[0];
    if (!isRecord(first)) return;
    preserveReceiptEventTimestamps(room._receipts, timeline);
    kept[0] = { ...first, token: nextBatch };
    room._timeline = kept;
  });
};
