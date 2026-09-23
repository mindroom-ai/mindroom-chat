import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import {
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
import { collectExplicitRedactedEventIds, mergeRawEventRevisions } from '../eventRevision';
import { isCacheStoreWriteLeaseCurrent, type CacheStoreWriteLease } from './cacheStoreDb';
import {
  notifyCachedThreadSummaryChange,
  type CachedThreadSummaryChange,
} from './cacheStoreSummaryChanges';
import {
  EVENTS_STORE,
  META_STORE,
  THREAD_SUMMARIES_STORE,
  EVENTS_BY_ROOM_EVENT_INDEX,
  EVENTS_BY_SUMMARY_CANDIDATE_INDEX,
  EVENTS_BY_RELATION_TARGET_INDEX,
  EVENTS_BY_SUMMARY_TARGET_INDEX,
  buildSummaryCacheKey,
  buildRedactedRelationMetaKey,
  type CachedEventRecord,
  type CachedThreadSummaryRecord,
  type CachedMetaRecord,
} from './cacheStoreSchema';

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const threadForRecord = (record: CachedEventRecord): string | undefined => {
  if (record.scope) return record.scope;
  const relation = record.rawEvent.content?.['m.relates_to'];
  return relation?.rel_type === 'm.thread' ? relation.event_id : undefined;
};
const isCandidate = (raw: Partial<IEvent>): boolean =>
  !raw.unsigned?.redacted_because &&
  (hasMindroomThreadSummary(raw.content ?? {}) ||
    hasMindroomThreadSummary(raw.unsigned?.['m.relations']?.['m.replace']?.content ?? {}));

/** Index only accepted merged rows, never the pre-merge input. */
export const indexSummaryEventRecord = (record: CachedEventRecord): CachedEventRecord => {
  const relation = record.rawEvent.content?.['m.relates_to'];
  const target =
    relation?.rel_type === 'm.replace'
      ? relation.event_id
      : record.rawEvent.type === 'm.room.redaction'
      ? record.rawEvent.redacts ?? record.rawEvent.content?.redacts
      : undefined;
  const candidate = isCandidate(record.rawEvent);
  return {
    ...record,
    summaryThreadRootId: candidate
      ? threadForRecord(record) ??
        (relation?.rel_type === 'm.replace' ? record.summaryThreadRootId : undefined)
      : undefined,
    summaryRelationTarget: typeof target === 'string' ? target : undefined,
    summaryCandidateTarget:
      candidate && relation?.rel_type === 'm.replace' ? relation.event_id : undefined,
  };
};
/** Resolve room-timeline edits through their original; either row may arrive first. */
const affectedSummaryRoots = async (
  events: IDBObjectStore,
  record: CachedEventRecord
): Promise<Set<string>> => {
  const roots = new Set<string>();
  if (record.summaryThreadRootId) roots.add(record.summaryThreadRootId);
  const link = (candidate: CachedEventRecord, root: string | undefined) => {
    if (!root) return;
    roots.add(root);
    if (candidate.summaryThreadRootId !== root)
      events.put({ ...candidate, summaryThreadRootId: root });
  };
  const ids = new Set(
    [record.eventId, record.summaryRelationTarget].filter((id): id is string => !!id)
  );
  await Promise.all(
    [...ids].map(async (id) => {
      const related = (await requestResult(
        events.index(EVENTS_BY_SUMMARY_TARGET_INDEX).getAll([record.roomId, id])
      )) as CachedEventRecord[];
      related.forEach((candidate) => {
        link(
          candidate,
          candidate.summaryThreadRootId ??
            (id === record.eventId ? threadForRecord(record) : undefined)
        );
      });
      // A non-summary revision can invalidate a candidate stored in another
      // scope, so dependency discovery includes copies of the changed event.
      const targets = (await requestResult(
        events.index(EVENTS_BY_ROOM_EVENT_INDEX).getAll([record.roomId, id])
      )) as CachedEventRecord[];
      targets.forEach((target) => {
        if (target.summaryThreadRootId) roots.add(target.summaryThreadRootId);
        related.forEach((candidate) =>
          link(candidate, candidate.summaryThreadRootId ?? threadForRecord(target))
        );
      });
    })
  );
  return roots;
};

export const summaryRecordInfo = (
  record: CachedThreadSummaryRecord | undefined
): MindroomThreadSummaryInfo | undefined =>
  record
    ? {
        summaryText: record.summaryText,
        generatedTs: record.generatedTs,
        ...(record.eventTs !== undefined ? { eventTs: record.eventTs } : {}),
        messageCount: record.messageCount,
        ...(record.isManual ? { isManual: true } : {}),
      }
    : undefined;
const migrationKey = (roomId: string) => `${roomId}|__summaryMigration`;
const pendingPrefix = (roomId: string) => `${roomId}|__summaryPending:`;
type Migration = CachedMetaRecord & {
  after?: string;
  phase: 'index' | 'project' | 'done';
};
type PendingProjection = CachedMetaRecord & { threadRootId: string };
const queueProjection = (meta: IDBObjectStore, roomId: string, threadRootId: string) => {
  meta.put({
    metaKey: pendingPrefix(roomId) + threadRootId,
    roomId,
    scope: `__summaryPending:${threadRootId}`,
    updatedAt: Date.now(),
    threadRootId,
  } satisfies PendingProjection);
};
const sameSummary = (
  left: MindroomThreadSummaryInfo | undefined,
  right: MindroomThreadSummaryInfo | undefined
) =>
  left?.summaryText === right?.summaryText &&
  left?.generatedTs === right?.generatedTs &&
  left?.eventTs === right?.eventTs &&
  left?.messageCount === right?.messageCount &&
  left?.isManual === right?.isManual;

const projectThread = async (
  transaction: IDBTransaction,
  roomId: string,
  threadRootId: string,
  complete: boolean
): Promise<CachedThreadSummaryChange | undefined> => {
  const events = transaction.objectStore(EVENTS_STORE);
  const summaries = transaction.objectStore(THREAD_SUMMARIES_STORE);
  const meta = transaction.objectStore(META_STORE);
  const key = buildSummaryCacheKey(roomId, threadRootId);
  const [previous, candidates] = await Promise.all([
    requestResult(summaries.get(key)) as Promise<CachedThreadSummaryRecord | undefined>,
    requestResult(
      events.index(EVENTS_BY_SUMMARY_CANDIDATE_INDEX).getAll([roomId, threadRootId])
    ) as Promise<CachedEventRecord[]>,
  ]);
  // A Matrix event can have room and thread cache copies. Resolve its accepted
  // revision once before selecting titles, just like cross-scope event reads.
  const targetIds = new Set(
    candidates.map((record) => record.summaryCandidateTarget ?? record.eventId)
  );
  const targets = new Map<string, Partial<IEvent>>();
  await Promise.all(
    [...targetIds].map(async (eventId) => {
      const originals = (await requestResult(
        events.index(EVENTS_BY_ROOM_EVENT_INDEX).getAll([roomId, eventId])
      )) as CachedEventRecord[];
      originals.forEach((original) =>
        targets.set(eventId, mergeRawEventRevisions(targets.get(eventId), original.rawEvent))
      );
    })
  );
  const infos = await Promise.all(
    [...targets.entries()].map(async ([eventId, target]) => {
      const relations = (await requestResult(
        events.index(EVENTS_BY_RELATION_TARGET_INDEX).getAll([roomId, eventId])
      )) as CachedEventRecord[];
      const mergedRelations = new Map<string, Partial<IEvent>>();
      relations.forEach((record) =>
        mergedRelations.set(
          record.eventId,
          mergeRawEventRevisions(mergedRelations.get(record.eventId), record.rawEvent)
        )
      );
      const raws = [target, ...mergedRelations.values()];
      const redactedIds = collectExplicitRedactedEventIds(raws);
      const ids = new Set(
        raws
          .flatMap((raw) => [raw.event_id, raw.unsigned?.['m.relations']?.['m.replace']?.event_id])
          .filter((id): id is string => typeof id === 'string')
      );
      await Promise.all(
        [...ids].map(async (id) => {
          if (await requestResult(meta.get(buildRedactedRelationMetaKey(roomId, id))))
            redactedIds.add(id);
          const evidence = (await requestResult(
            events.index(EVENTS_BY_RELATION_TARGET_INDEX).getAll([roomId, id])
          )) as CachedEventRecord[];
          collectExplicitRedactedEventIds(evidence.map((record) => record.rawEvent)).forEach(
            (redacted) => redactedIds.add(redacted)
          );
        })
      );
      const hydrated = raws.map((raw) => new MatrixEvent(raw));
      const isRedacted = (event: MatrixEvent) =>
        event.isRedacted() || redactedIds.has(event.getId() ?? '');
      applySerializedCachedReplaceRelations(hydrated, isRedacted);
      applyCachedReplaceRelations(hydrated, isRedacted);
      const event = hydrated[0];
      return !isRedacted(event) &&
        event.getRelation()?.rel_type !== 'm.replace' &&
        isMindroomThreadSummaryEvent(event)
        ? { info: getThreadSummaryEventInfo(event), eventId }
        : undefined;
    })
  );
  const previousInfo = summaryRecordInfo(previous);
  // Unproven legacy/manual values survive. A partial index cannot invalidate a winner.
  const retained = !complete || !previous?.sourceEventId ? previousInfo : undefined;
  const summary = pickLatestThreadSummaryInfo(
    retained,
    ...infos.map((candidate) => candidate?.info)
  );
  const source = infos
    .slice()
    .reverse()
    .find((candidate) => candidate && sameSummary(candidate.info, summary))?.eventId;
  const unchanged = sameSummary(previousInfo, summary);
  if (summary?.summaryText && (!unchanged || source !== previous?.sourceEventId)) {
    summaries.put({
      cacheKey: key,
      roomId,
      threadRootId,
      ...summary,
      summaryText: summary.summaryText,
      sourceEventId: source ?? previous?.sourceEventId,
      updatedAt: Date.now(),
    } satisfies CachedThreadSummaryRecord);
  } else if (!summary?.summaryText && complete && previous?.sourceEventId) summaries.delete(key);
  if (unchanged) return undefined;
  return { type: 'summary', threadRootId, previous: previousInfo, summary };
};

/** One coordinator per accepted mutation transaction; flush after all event writes are queued. */
export const createSummaryProjection = (
  transaction: IDBTransaction,
  lease: CacheStoreWriteLease,
  roomId: string
) => {
  // Detect a genuinely empty room before this transaction queues event puts.
  // Such a room needs no migration; pre-existing history retains the bounded repair path.
  const meta = transaction.objectStore(META_STORE);
  const ready = requestResult(meta.get(migrationKey(roomId)))
    .then(async (state: Migration | undefined) => {
      if (state) return state.phase === 'done';
      const count = await requestResult(
        transaction.objectStore(EVENTS_STORE).count(IDBKeyRange.bound(`${roomId}|`, `${roomId}|￿`))
      );
      if (count !== 0) return false;
      meta.put({
        metaKey: migrationKey(roomId),
        roomId,
        scope: '__summaryMigration',
        updatedAt: Date.now(),
        phase: 'done',
      } satisfies Migration);
      return true;
    })
    .catch(() => false);
  const changed: CachedEventRecord[] = [];
  const changes: CachedThreadSummaryChange[] = [];
  transaction.addEventListener('complete', () => {
    if (isCacheStoreWriteLeaseCurrent(lease))
      changes.forEach((change) => notifyCachedThreadSummaryChange(lease.sessionId, roomId, change));
  });
  return {
    note(previous: CachedEventRecord | undefined, next?: CachedEventRecord) {
      if (previous) changed.push(indexSummaryEventRecord(previous));
      if (next) changed.push(next);
    },
    flush() {
      const run = async () => {
        const events = transaction.objectStore(EVENTS_STORE);
        const roots = new Set<string>();
        await Promise.all(
          changed.map(async (record) => {
            (await affectedSummaryRoots(events, record)).forEach((root) => roots.add(root));
          })
        );
        if (!roots.size) return;
        const complete = await ready;
        await Promise.all(
          [...roots].map(async (root) => {
            if (!complete) queueProjection(meta, roomId, root);
            const change = await projectThread(transaction, roomId, root, complete);
            if (change) changes.push(change);
          })
        );
      };
      void run().catch(() => {
        try {
          transaction.abort();
        } catch {
          /* Already aborted. */
        }
      });
    },
  };
};

/** Backfill at most 128 event rows per commit; persist both cursor and pending projections. */
export const repairCachedThreadSummaries = async (
  db: IDBDatabase,
  lease: CacheStoreWriteLease,
  roomId: string
): Promise<void> => {
  let done = false;
  while (!done && isCacheStoreWriteLeaseCurrent(lease)) {
    // eslint-disable-next-line no-await-in-loop
    done = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction([EVENTS_STORE, META_STORE, THREAD_SUMMARIES_STORE], 'readwrite');
      let finished = false;
      const changes: CachedThreadSummaryChange[] = [];
      const run = async () => {
        const meta = tx.objectStore(META_STORE);
        const events = tx.objectStore(EVENTS_STORE);
        const key = migrationKey(roomId);
        const state = (await requestResult(meta.get(key))) as Migration | undefined;
        if (state?.phase === 'done') {
          finished = true;
          return;
        }
        if (!state || state.phase === 'index') {
          const rows = (await requestResult(
            events.getAll(
              IDBKeyRange.bound(state?.after ?? `${roomId}|`, `${roomId}|￿`, !!state?.after),
              128
            )
          )) as CachedEventRecord[];
          await Promise.all(
            rows.map(async (row) => {
              const indexed = indexSummaryEventRecord(row);
              events.put(indexed);
              (await affectedSummaryRoots(events, indexed)).forEach((affected) =>
                queueProjection(meta, roomId, affected)
              );
            })
          );
          meta.put({
            metaKey: key,
            roomId,
            scope: '__summaryMigration',
            updatedAt: Date.now(),
            after: rows.at(-1)?.cacheKey ?? state?.after,
            phase: rows.length === 128 ? 'index' : 'project',
          } satisfies Migration);
        } else {
          const prefix = pendingPrefix(roomId);
          const pending = (await requestResult(
            meta.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`), 32)
          )) as PendingProjection[];
          await Promise.all(
            pending.map(async (row) => {
              const change = await projectThread(tx, roomId, row.threadRootId, true);
              if (change) changes.push(change);
              meta.delete(row.metaKey);
            })
          );
          if (pending.length < 32) {
            meta.put({ ...state, phase: 'done' });
            finished = true;
          }
        }
      };
      void run().catch((error) => {
        try {
          tx.abort();
        } catch {
          // A failed IndexedDB request may already have aborted the transaction.
        }
        reject(tx.error ?? error);
      });
      tx.oncomplete = () => {
        if (isCacheStoreWriteLeaseCurrent(lease))
          changes.forEach((change) =>
            notifyCachedThreadSummaryChange(lease.sessionId, roomId, change)
          );
        resolve(finished);
      };
      tx.onabort = () => reject(tx.error);
    });
    if (!done) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
};
