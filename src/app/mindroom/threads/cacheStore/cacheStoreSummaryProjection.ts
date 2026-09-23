import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import {
  areThreadSummaryInfosEqual,
  getThreadSummaryEventInfo,
  hasMindroomThreadSummary,
  isMindroomThreadSummaryEvent,
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../../messages/threadSummary';
import {
  applyCachedReplaceRelations,
  applySerializedCachedReplaceRelations,
} from '../eventCacheEditUtils';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import { isCacheStoreWriteLeaseCurrent, type CacheStoreWriteLease } from './cacheStoreDb';
import {
  notifyCachedThreadSummaryChange,
  type CachedThreadSummaryChange,
} from './cacheStoreSummaryChanges';
import {
  EVENTS_STORE,
  EVENTS_BY_SCOPE_TS_INDEX,
  META_STORE,
  THREAD_SUMMARIES_STORE,
  MAX_EVENT_ID,
  MAX_EVENT_TS,
  buildSummaryCacheKey,
  type CachedEventRecord,
  type CachedThreadSummaryRecord,
  type CachedMetaRecord,
} from './cacheStoreSchema';

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const hasSummary = (raw: Partial<IEvent>): boolean =>
  hasMindroomThreadSummary(raw.content ?? {}) ||
  hasMindroomThreadSummary(raw.unsigned?.['m.relations']?.['m.replace']?.content ?? {});

const acceptedSummary = (record: CachedEventRecord | undefined) => {
  if (!record || !hasSummary(record.rawEvent)) return undefined;
  const event = new MatrixEvent(record.rawEvent);
  applySerializedCachedReplaceRelations([event]);
  return !event.isRedacted() && isMindroomThreadSummaryEvent(event)
    ? getThreadSummaryEventInfo(event)
    : undefined;
};

const summaryRecordInfo = (
  record: CachedThreadSummaryRecord | undefined
): MindroomThreadSummaryInfo | undefined =>
  record && {
    summaryText: record.summaryText,
    generatedTs: record.generatedTs,
    eventTs: record.eventTs,
    messageCount: record.messageCount,
    ...(record.isManual ? { isManual: true } : {}),
  };

/** Ingestion already folds accepted edits into their originals; storage owns only the projection. */
const projectThread = async (
  transaction: IDBTransaction,
  roomId: string,
  threadRootId: string
): Promise<CachedThreadSummaryChange | undefined> => {
  const summaries = transaction.objectStore(THREAD_SUMMARIES_STORE);
  const key = buildSummaryCacheKey(roomId, threadRootId);
  const [previous, rows] = await Promise.all([
    requestResult(summaries.get(key)) as Promise<CachedThreadSummaryRecord | undefined>,
    requestResult(
      transaction
        .objectStore(EVENTS_STORE)
        .index(EVENTS_BY_SCOPE_TS_INDEX)
        .getAll(
          IDBKeyRange.bound(
            [roomId, threadRootId, 0, ''],
            [roomId, threadRootId, MAX_EVENT_TS, MAX_EVENT_ID]
          )
        )
    ) as Promise<CachedEventRecord[]>,
  ]);
  const events = rows.map(({ rawEvent }) => new MatrixEvent(rawEvent));
  applySerializedCachedReplaceRelations(events);
  applyCachedReplaceRelations(events);
  const candidates = events
    .filter(
      (event) =>
        !event.isRedacted() &&
        event.getRelation()?.rel_type !== 'm.replace' &&
        isMindroomThreadSummaryEvent(event)
    )
    .map((event) => ({ eventId: event.getId(), info: getThreadSummaryEventInfo(event) }));
  const previousInfo = summaryRecordInfo(previous);
  // Summary-only legacy values remain until their source is present in history.
  // Selection needs all candidates together (manual and legacy chronology differ).
  const summary = pickLatestThreadSummaryInfo(
    previous?.sourceEventId ? undefined : previousInfo,
    ...candidates.map(({ info }) => info)
  );
  const sourceEventId = candidates
    .reverse()
    .find(({ info }) => areThreadSummaryInfosEqual(info, summary))?.eventId;
  if (summary?.summaryText) {
    summaries.put({
      cacheKey: key,
      roomId,
      threadRootId,
      ...summary,
      summaryText: summary.summaryText,
      sourceEventId: sourceEventId ?? previous?.sourceEventId,
      updatedAt: Date.now(),
    } satisfies CachedThreadSummaryRecord);
  } else if (previous?.sourceEventId) summaries.delete(key);
  if (areThreadSummaryInfosEqual(previousInfo, summary)) return undefined;
  return { type: 'summary', threadRootId, previous: previousInfo, summary };
};

/** Ordinary messages do no summary reads; rare summary changes rebuild only their thread. */
export const createSummaryProjection = (
  transaction: IDBTransaction,
  lease: CacheStoreWriteLease,
  roomId: string
) => {
  const roots = new Set<string>();
  const changes: CachedThreadSummaryChange[] = [];
  transaction.addEventListener('complete', () => {
    if (isCacheStoreWriteLeaseCurrent(lease))
      changes.forEach((change) => notifyCachedThreadSummaryChange(lease.sessionId, roomId, change));
  });
  return {
    note(previous: CachedEventRecord | undefined, next?: CachedEventRecord) {
      // Legacy standalone edits can create or remove a summary in m.new_content.
      // Their deletion must reconsider the original even without summary metadata.
      const standalone = [previous, next].some(
        (record) => record?.rawEvent.content?.['m.relates_to']?.rel_type === 'm.replace'
      );
      if (
        !standalone &&
        areThreadSummaryInfosEqual(acceptedSummary(previous), acceptedSummary(next))
      )
        return;
      for (const record of [previous, next]) {
        if (record?.scope && (standalone || hasSummary(record.rawEvent))) roots.add(record.scope);
      }
    },
    flush() {
      void Promise.all(
        [...roots].map(async (root) => {
          const change = await projectThread(transaction, roomId, root);
          if (change) changes.push(change);
        })
      ).catch(() => {
        try {
          transaction.abort();
        } catch {
          /* Already aborted. */
        }
      });
    },
  };
};

type RepairProgress = CachedMetaRecord & { after?: string; done?: boolean };

/** One thread per transaction; never rewrite event rows or build another relation index. */
const repairNextThread = (
  db: IDBDatabase,
  lease: CacheStoreWriteLease,
  roomId: string
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction([EVENTS_STORE, META_STORE, THREAD_SUMMARIES_STORE], 'readwrite');
    let done = false;
    let change: CachedThreadSummaryChange | undefined;
    const run = async () => {
      const meta = tx.objectStore(META_STORE);
      const metaKey = `${roomId}|__summaryRepair`;
      const progress = (await requestResult(meta.get(metaKey))) as RepairProgress | undefined;
      if (progress?.done) {
        done = true;
        return;
      }
      const [thread] = (await requestResult(
        meta.getAll(
          IDBKeyRange.bound(
            progress?.after ?? `${roomId}|$`,
            `${roomId}|%`,
            !!progress?.after,
            true
          ),
          1
        )
      )) as CachedMetaRecord[];
      if (thread) change = await projectThread(tx, roomId, thread.scope);
      done = !thread;
      meta.put({
        metaKey,
        roomId,
        scope: '__summaryRepair',
        updatedAt: Date.now(),
        after: thread?.metaKey,
        done,
      } satisfies RepairProgress);
    };
    void run().catch((error) => {
      try {
        tx.abort();
      } catch {
        /* Already aborted. */
      }
      reject(error);
    });
    tx.oncomplete = () => {
      if (change && isCacheStoreWriteLeaseCurrent(lease))
        notifyCachedThreadSummaryChange(lease.sessionId, roomId, change);
      resolve(done);
    };
    tx.onabort = () => reject(tx.error);
  });

const repairs = new Map<string, { lease: CacheStoreWriteLease; promise: Promise<void> }>();

/** Share background repair; existing room/session leases cancel work after cache clearing. */
export const repairCachedThreadSummaries = (
  db: IDBDatabase,
  lease: CacheStoreWriteLease,
  roomId: string
): Promise<void> => {
  if (!isCacheWritable() || !isCacheStoreWriteLeaseCurrent(lease)) return Promise.resolve();
  const key = JSON.stringify([lease.sessionId, roomId]);
  const existing = repairs.get(key);
  if (existing && isCacheStoreWriteLeaseCurrent(existing.lease)) return existing.promise;
  const job = { lease, promise: Promise.resolve() };
  repairs.set(key, job);
  job.promise = (async () => {
    try {
      while (isCacheStoreWriteLeaseCurrent(lease) && isCacheWritable()) {
        // Yield before opening a write transaction so committed titles can paint first.
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        if (!isCacheStoreWriteLeaseCurrent(lease) || !isCacheWritable()) return;
        // eslint-disable-next-line no-await-in-loop
        if (await repairNextThread(db, lease, roomId)) return;
      }
    } catch (error) {
      if (isCacheStoreWriteLeaseCurrent(lease)) reportCacheWriteError('summaryRepair', error);
    } finally {
      if (repairs.get(key) === job) repairs.delete(key);
    }
  })();
  return job.promise;
};
