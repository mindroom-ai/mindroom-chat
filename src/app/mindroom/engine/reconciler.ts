/**
 * CINNY-207 P5.1: engine reconciler.
 *
 * Every thread open schedules one reconcile pass through the
 * P4.1 `BackfillScheduler`. Coverage decides what to PAINT (D7); the
 * reconciler decides what to REPAIR. When cache and server agree the
 * pass is a cheap no-op (fetch, diff, empty). When they diverge (a
 * missed edit, redaction, or relation) the pass applies the repair in place using
 * the P1.2 machinery (`hydrateCachedEvents` → `applyCachedRedactions`,
 * `applyCachedReplaceRelations`, `reconcileRelationEventsWithAggregation`)
 * and fires a single `onRepaired` tick so the render layer picks up
 * the change without per-repair flicker.
 *
 * Scheduler wiring:
 *   - Kind: `'reconcile'` (own dedup domain). Because AC8's dedup key
 *     includes `kind`, a reconcile job and a `'thread-backfill'` job
 *     on the same thread coexist by design — they do different things
 *     (backfill fetches older history; reconcile checks the tail for
 *     server-truth divergence).
 *   - Priority: band 0 (the user is looking at this room / thread
 *     right now; a reconcile that trails a `noteRoomFocused` is the
 *     freshest signal we have).
 *   - Coalescing: falls out of the scheduler for free — a second
 *     `scheduleReconcile` while the first is in-flight returns the
 *     same promise identity, `schedulerDeduped` bumps.
 *
 * Tuwunel stale-copy handling (P3 gate work):
 *   Empirically the docker Tuwunel homeserver serves un-pruned redacted
 *   events on `/relations` and `/messages` for ~10 seconds after a
 *   redaction. `createPreferLiveEventMapper` (see `eventRepository.ts`)
 *   is the single source of truth for re-applying that redaction onto
 *   the SDK live instance (cascades through the SDK's
 *   `Relations.BeforeRedaction` listener and removes stale reaction
 *   chips). The reconciler MUST funnel every fetched raw event through
 *   that mapper — bypassing it would let a stale server copy un-repair
 *   a fresh redaction the client already knew about.
 *
 * F7 removal: the pre-P5 tail refresh (`refreshLatestThreadRelationsTail`)
 * capped at a single limit-200 batch, so a divergence more than 200
 * events deep never converged after open. The reconciler pages further:
 * it keeps requesting until the returned chunk overlaps the cached
 * window by event id, or the SDK signals "no more", or the abort signal
 * fires. Bounded above by `MAX_RECONCILE_ITERATIONS` for the same
 * reason `fetchAllThreadRelations` has a cap — a pathological
 * homeserver can otherwise stream tokens indefinitely.
 */

import { Direction } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import {
  createPreferLiveEventMapper,
  persistThreadEventCacheSnapshotCommitted,
} from '../threads/eventRepository';
import {
  collectRedactedRelationTargetsFromLookup,
  hydrateCachedEvents,
  reconcileRelationEventsWithAggregation,
} from '../threads/eventCacheEditUtils';
import { logTimelineDebug } from '../threads/timelineDebug';
import { countCacheProbe } from '../threads/cacheProbe';
import { mergeThreadRenderEvents } from '../threads/threadRenderUtils';
import type { BackfillScheduler } from './backfillScheduler';
import type { HydratedThreadCachePage } from '../threads/types';
import {
  beginThreadReconcileContinuation,
  checkpointThreadReconcileContinuation,
  clearThreadReconcileContinuation,
  loadThreadReconcileContinuation,
  restartThreadReconcileContinuationFromHead,
  type ThreadReconcileContinuation,
} from '../threads/cacheStore';
import {
  collectEmbeddedRelationEventIds,
  collectExplicitRedactedEventIds,
  describeRawEventRevision,
  hasEventRevisionUpgrade,
  mergeEventRevisionDescriptors,
  type EventRevisionDescriptor,
} from '../threads/eventRevision';

/** Batch size for each `/relations` page — matches THREAD_BATCH_SIZE. */
const RECONCILE_BATCH_SIZE = 200;

/**
 * Cap on `/relations` pages the reconciler will fetch per pass. The
 * pre-P5 tail refresh capped at 1 (single 200-event page — this is
 * finding F7). Setting the cap at 25 keeps the total per-pass fetch
 * budget the same as `fetchAllThreadRelations` and matches its
 * MAX_THREAD_FETCH_ITERATIONS constant so unusually deep divergence
 * still converges without unbounded network use.
 */
const MAX_RECONCILE_ITERATIONS = 25;

type ReconcileScanExit = 'overlap' | 'end' | 'fetch-failed' | 'page-cap' | 'token-loop';

type ThreadReconcileContinuationStore = {
  load: typeof loadThreadReconcileContinuation;
  begin: typeof beginThreadReconcileContinuation;
  checkpoint: typeof checkpointThreadReconcileContinuation;
  clear: typeof clearThreadReconcileContinuation;
  restartFromHead: typeof restartThreadReconcileContinuationFromHead;
};

const DEFAULT_CONTINUATION_STORE: ThreadReconcileContinuationStore = {
  load: loadThreadReconcileContinuation,
  begin: beginThreadReconcileContinuation,
  checkpoint: checkpointThreadReconcileContinuation,
  clear: clearThreadReconcileContinuation,
  restartFromHead: restartThreadReconcileContinuationFromHead,
};

/**
 * Why the reconcile pass was scheduled. Included in probe logs so a
 * capture can distinguish "user opened a thread we already had cached
 * (D7 revalidation)" from "user opened a fresh room we just hydrated".
 */
export type ReconcileReason =
  // CINNY-207 AC2 revision (2026-07-04): single choke-point schedule
  // at the top of the thread-open flow (see runThreadOpenCacheFirst).
  // Replaces the three earlier open-* variants ('open-complete-coverage',
  // 'open-partial-coverage', 'open-backfill-completed') that each pinned
  // a branch-local schedule call site — those sites are gone; there is
  // now exactly one thread-open reconcile per open, structurally.
  'open-thread-choke-point';

export type ScheduleReconcileArgs = {
  readonly mx: MatrixClient;
  readonly sessionId: string;
  readonly scheduler: BackfillScheduler;
  readonly roomId: string;
  /**
   * Optional pre-resolved room. When present the reconciler uses it
   * directly instead of `mx.getRoom(roomId)` — required for test
   * harnesses whose mock client's `getRoom` returns null (and cheaper
   * than an extra Map lookup in production).
   */
  readonly room?: Room;
  /**
   * Thread whose relation tail should be reconciled.
   */
  readonly threadId: string;
  /**
   * Hydrated cache page from the open path. Used to diff the fetched
   * server page against what we already have.
   */
  readonly cachedPage?: HydratedThreadCachePage;
  readonly reason: ReconcileReason;
  /**
   * Fired at most once per pass, and only when the reconciler actually
   * applied a repair. Receives the fully-mapped, prefer-live event
   * batch the reconciler fetched — the SAME set that was injected
   * into the SDK thread model via `liveThread.addEvents(batch, false)`
   * on the SDK-side leg of the P5-GATE-FIX v3 dual-injection.
   *
   * Why the batch is handed to the callback (P5-GATE-FIX v3): the
   * complete-coverage cache-first path skips SDK bootstrap by design;
   * `useThreadRenderState.buildThreadEvents` reads the SDK-populated
   * `thread.events` AND the component-owned
   * `fallbackThreadEventsState.events`. SDK-only injection leaves the
   * fallback state stale on that path. The component-side callback
   * routes this batch through `setSupplementalThreadEvents(threadId,
   * batch)`, whose internal `mergeThreadRenderEvents` dedups by event
   * id — so re-passing a live-known event is a no-op. Keeping this
   * boundary out of the engine preserves the P3.3 render-only
   * invariant (engine does NOT import `setSupplementalThreadEvents`).
   *
   * The intent remains a single batched render tick — the caller does
   * not need to distinguish which repair changed what.
   */
  readonly onRepaired?: (repairedEvents: readonly MatrixEvent[]) => void;
  /**
   * Optional debug trace id. When present, reconciler observability
   * events (`reconcile-scheduled`, `reconcile-complete`) attach it so
   * a capture can be correlated with the surrounding thread-open flow.
   */
  readonly debugTraceId?: string;
  /** Test seam for observing or failing the durable repair write. */
  readonly persistRepair?: typeof persistThreadEventCacheSnapshotCommitted;
  /** Test seam for the durable bounded-scan cursor. */
  readonly continuationStore?: ThreadReconcileContinuationStore;
};

export type ReconcileResult = {
  readonly reason: ReconcileReason;
  readonly repaired: boolean;
  /** Total mapped events fetched across all iterations. */
  readonly fetchedCount: number;
  /** Number of `/relations` pages actually issued (bounded above). */
  readonly iterations: number;
  /** True when the executor short-circuited on abort. */
  readonly aborted: boolean;
  /** Canonical repaired view delivered independently to every observer. */
  readonly repairedEvents?: readonly MatrixEvent[];
  /** Defined for repaired passes: whether the repaired cache transaction committed. */
  readonly durable?: boolean;
};

/**
 * CINNY-207 P5-GATE-FIX v2 (AC2 instance-race): resolve the MatrixEvent
 * instances the repair pipeline should mutate.
 *
 * Contract:
 *   - When `cachedPage.hydratedEvents` is populated (the standard
 *     complete-coverage cache-first path), we operate on THOSE
 *     instances — the render layer is holding exactly the same
 *     object references via `fallbackThreadEventsState.events` (see
 *     `useThreadRenderState.buildThreadEvents`), so a `makeReplaced`
 *     or `makeRedacted` call here becomes visible on the next tick.
 *   - Additionally, for each hydrated instance we consult `preferLive`
 *     — if the SDK has a newer live instance for the same event id
 *     (e.g. a live sync just landed the m.replace target update while
 *     the cache still held an older copy), we prefer the live one so
 *     the repair sees the freshest state. This mirrors P1.2's
 *     both-ways-heal contract and keeps the cache path aligned with
 *     the SDK-live path.
 *   - Absent `hydratedEvents` (defensive fallback), we re-hydrate the
 *     raw JSON via `preferLive` — the prior P5.1 behavior. On
 *     complete-coverage this branch is unreachable in production
 *     because `hydrateThreadFromCache` always sets `hydratedEvents`.
 *
 * Root event handling: `hydratedRootEvent` follows the same rule; when
 * absent we fall back to remapping `cachedPage.rootEvent`. Kept
 * ordered "root first, then events" to match the array shape
 * `mapCachedThreadPageEvents` produced pre-fix.
 */
const resolveCachedSnapshotEventsForRepair = ({
  cachedPage,
  preferLive,
  room,
}: {
  cachedPage: HydratedThreadCachePage;
  preferLive: (rawEvent: Partial<IEvent>) => MatrixEvent;
  room: Room;
}): MatrixEvent[] => {
  // Prefer the SDK live instance only when the SDK actually knows the
  // id — otherwise `preferLive` would return a fresh clone (via the
  // wrapped `mapEvent`), which would defeat the whole point of this
  // helper by reintroducing the fresh-clone race the fix is closing.
  // A live-instance win here is the P1.2 both-ways-heal case (SDK's
  // live copy is newer than what the cache clone has); we accept that
  // trade because the SDK subsequently notifies the render layer
  // through the standard thread events + re-render tick.
  const preferredForInstance = (mEvent: MatrixEvent): MatrixEvent => {
    const eventId = mEvent.getId();
    if (!eventId) return mEvent;
    const liveInstance = room.findEventById(eventId);
    return liveInstance ?? mEvent;
  };

  if (cachedPage.hydratedEvents && cachedPage.hydratedEvents.length > 0) {
    const collected: MatrixEvent[] = [];
    if (cachedPage.hydratedRootEvent) {
      collected.push(preferredForInstance(cachedPage.hydratedRootEvent));
    } else if (cachedPage.rootEvent) {
      collected.push(preferLive(cachedPage.rootEvent));
    }
    for (const mEvent of cachedPage.hydratedEvents) {
      // Skip a hydrated instance whose id matches the root we already
      // pushed (defensive — the hydrated events list from
      // `hydrateThreadFromCache` typically does not contain the root
      // as a separate entry, but check for identity to avoid a double
      // entry into the applier's id-to-target map).
      const eventId = mEvent.getId();
      if (
        eventId &&
        cachedPage.hydratedRootEvent &&
        cachedPage.hydratedRootEvent.getId() === eventId
      ) {
        continue;
      }
      collected.push(preferredForInstance(mEvent));
    }
    return collected;
  }

  // Defensive fallback: no hydratedEvents on the page. Rebuild via
  // preferLive from raw JSON — the prior P5.1 behavior. On any path
  // that reaches this branch, the render is not currently holding
  // cache-clone instances (e.g. room-scope reconcile with no thread
  // context), so the object-identity contract does not apply.
  const collected: MatrixEvent[] = [];
  if (cachedPage.rootEvent) {
    collected.push(preferLive(cachedPage.rootEvent));
  }
  for (const rawEvent of cachedPage.events) {
    collected.push(preferLive(rawEvent));
  }
  return collected;
};

const buildCachedRevisionMap = (
  cachedPage: HydratedThreadCachePage
): Map<string, EventRevisionDescriptor> => {
  const revisions = new Map<string, EventRevisionDescriptor>();
  const add = (rawEvent: Partial<IEvent> | undefined): void => {
    const eventId = rawEvent?.event_id;
    if (typeof eventId !== 'string' || eventId.length === 0 || !rawEvent) return;
    const candidate = describeRawEventRevision(rawEvent);
    const current = revisions.get(eventId);
    revisions.set(eventId, current ? mergeEventRevisionDescriptors(current, candidate) : candidate);
  };
  add(cachedPage.rootEvent);
  cachedPage.events.forEach(add);
  return revisions;
};

/**
 * True when the diff between the fetched page and the cache introduces
 * an in-place change: a new event id, a redaction whose target was in
 * cache, or an edit whose target was in cache. The reconciler only
 * fires `onRepaired` when this returns true; a diff of pure "same ids,
 * same content" costs zero ticks (the D7 cheap no-op).
 */
const detectDivergence = (
  fetched: Partial<IEvent>[],
  cachedRevisions: Map<string, EventRevisionDescriptor>,
  cachedEmbeddedRelationEventIds: ReadonlySet<string>
): boolean => {
  const fetchedRedactedEventIds = collectExplicitRedactedEventIds(fetched);
  for (const eventId of fetchedRedactedEventIds) {
    if (cachedEmbeddedRelationEventIds.has(eventId)) return true;
  }

  for (const rawEvent of fetched) {
    const id = rawEvent.event_id;
    if (typeof id !== 'string' || id.length === 0) continue;

    // New event we did not have. Covers "message the server has that
    // we missed" and "reaction added while offline".
    const cachedRevision = cachedRevisions.get(id);
    if (!cachedRevision) return true;

    if (hasEventRevisionUpgrade(describeRawEventRevision(rawEvent), cachedRevision)) {
      return true;
    }

    // A previously-cached redaction record can still be actionable if
    // its target record predates the redaction. This is rare but keeps
    // repair robust against interrupted multi-record writes.
    if (rawEvent.type === 'm.room.redaction') {
      const targetId =
        typeof rawEvent.redacts === 'string'
          ? rawEvent.redacts
          : ((rawEvent.content as Record<string, unknown> | undefined)?.redacts as
              | string
              | undefined);
      const targetRevision = targetId ? cachedRevisions.get(targetId) : undefined;
      if (targetRevision && !targetRevision.redacted) return true;
    }
  }
  return false;
};

/**
 * Fetch a single page of thread relations. Kept separate so the abort
 * check between iterations lands in one place.
 */
const fetchThreadRelationPage = async (
  mx: MatrixClient,
  roomId: string,
  threadId: string,
  fromToken: string | undefined
): Promise<{ events: Partial<IEvent>[]; nextToken?: string } | 'invalid-token' | undefined> => {
  const [err, relData] = await to(
    mx.fetchRelations(roomId, threadId, null, null, {
      dir: Direction.Backward,
      limit: RECONCILE_BATCH_SIZE,
      recurse: true,
      ...(fromToken ? { from: fromToken } : {}),
    })
  );
  if (err) {
    // Only a server verdict on the token itself may discard a saved cursor;
    // a network-level failure must leave durable scan progress untouched.
    const { errcode, httpStatus } = err as { errcode?: string; httpStatus?: number };
    return errcode === 'M_UNKNOWN_TOKEN' || httpStatus === 400 ? 'invalid-token' : undefined;
  }
  if (!relData) return undefined;
  return {
    events: (relData.chunk ?? []) as Partial<IEvent>[],
    nextToken: relData.next_batch ?? undefined,
  };
};

/**
 * Executor for a thread reconcile pass. Fetches `/relations` pages
 * (bounded by MAX_RECONCILE_ITERATIONS) until either the fetched chunk
 * overlaps the cached window by event id (server-truth caught up with
 * cache), the SDK signals `next_batch=undefined`, or an abort fires.
 * Then hydrates the merged event set through the P1.2 machinery to
 * apply any missed edits / redactions / aggregation changes in place.
 *
 * Return value flows back to the reconciler's outer promise so tests
 * (and future callers) can observe whether the pass repaired anything.
 */
const runThreadReconcilePass = async ({
  mx,
  sessionId,
  room,
  roomId,
  threadId,
  cachedPage,
  signal,
  reason,
  debugTraceId,
  persistRepair,
  continuationStore,
}: {
  mx: MatrixClient;
  sessionId: string;
  room: Room;
  roomId: string;
  threadId: string;
  cachedPage: HydratedThreadCachePage | undefined;
  signal: AbortSignal;
  reason: ReconcileReason;
  debugTraceId: string | undefined;
  persistRepair: typeof persistThreadEventCacheSnapshotCommitted;
  continuationStore: ThreadReconcileContinuationStore;
}): Promise<ReconcileResult> => {
  const cachedRevisions = cachedPage
    ? buildCachedRevisionMap(cachedPage)
    : new Map<string, EventRevisionDescriptor>();
  const cachedEmbeddedRelationEventIds = collectEmbeddedRelationEventIds(
    cachedPage
      ? [...(cachedPage.rootEvent ? [cachedPage.rootEvent] : []), ...cachedPage.events]
      : []
  );
  const mapper = mx.getEventMapper();
  const preferLive = createPreferLiveEventMapper(room, mapper);

  let continuation = await continuationStore
    .load(sessionId, roomId, threadId)
    .catch(() => undefined);
  const ensureContinuation = async (): Promise<ThreadReconcileContinuation | undefined> => {
    if (continuation) return continuation;
    const startedAt = Date.now();
    const candidate: ThreadReconcileContinuation = {
      generation: `${startedAt}:${Math.random().toString(36).slice(2)}`,
      startedAt,
      overlapEventIds: Array.from(cachedRevisions.keys()),
    };
    continuation = await continuationStore
      .begin(sessionId, roomId, threadId, candidate)
      .catch(() => undefined);
    return continuation;
  };
  const originalOverlapEventIds = new Set(
    continuation ? continuation.overlapEventIds : Array.from(cachedRevisions.keys())
  );

  let fetchedCount = 0;
  let iterations = 0;
  let fromToken = continuation?.nextToken;
  const allMapped: MatrixEvent[] = [];
  const allRaw: Partial<IEvent>[] = [];
  let scanExit: ReconcileScanExit | undefined;

  // Set by the fetch loop when it observed a fetch failure that
  // produced no usable page (SDK threw / returned undefined). Used
  // AFTER the loop to distinguish "empty response" from "everything
  // failed" — both surface as allMapped.length === 0.
  let fetchFailedOccurred = false;
  let recoveredInvalidToken = false;
  const restartContinuationFromHead = async (): Promise<boolean> => {
    if (!continuation) return false;
    const restartedAt = Date.now();
    const restarted = await continuationStore
      .restartFromHead(
        sessionId,
        roomId,
        threadId,
        continuation.generation,
        `${restartedAt}:${Math.random().toString(36).slice(2)}`
      )
      .catch(() => undefined);
    if (!restarted) return false;
    continuation = restarted;
    fromToken = undefined;
    return true;
  };

  // A resumed older scan is followed immediately by one fresh-head phase
  // before its marker can clear. Each phase retains the 25-page budget.
  let scanAnotherPhase = true;
  while (scanAnotherPhase) {
    scanAnotherPhase = false;
    let phaseIterations = 0;
    let phaseFetchedPage = false;
    let retriedSavedCursorFetch = false;
    let savedTokenRejected = false;
    const phaseStartToken = fromToken;
    scanExit = undefined;

    while (phaseIterations < MAX_RECONCILE_ITERATIONS) {
      if (signal.aborted) {
        // Signal-abort — scheduler-driven teardown (engine.stop / abort()
        // call). Reconciles are an engine responsibility (invariant I2,
        // convergence to server truth); this is the only legitimate
        // silent exit before the first fetch.
        countCacheProbe('reconcilesSignalAborted');
        return { reason, repaired: false, fetchedCount, iterations, aborted: true };
      }

      phaseIterations += 1;
      iterations += 1;
      // eslint-disable-next-line no-await-in-loop
      const page = await fetchThreadRelationPage(mx, roomId, threadId, fromToken);
      if (page === 'invalid-token') {
        savedTokenRejected = phaseStartToken !== undefined && !phaseFetchedPage;
        fetchFailedOccurred = true;
        scanExit = 'fetch-failed';
        break;
      }
      if (!page) {
        fetchFailedOccurred = true;
        if (phaseStartToken !== undefined && !phaseFetchedPage && !retriedSavedCursorFetch) {
          retriedSavedCursorFetch = true;
          continue;
        }
        scanExit = 'fetch-failed';
        break;
      }
      phaseFetchedPage = true;
      // P5-GATE-FIX v4 (final iteration — team-lead directive 2026-07-04):
      // per-page chunk-triple log. Signature (A) from the last docker run
      // (reconcilesScheduled=1, reconcilesRepaired=0, detectDivergence
      // returned FALSE) leaves two indistinguishable possibilities:
      //   (i)  the fetched chunk does not carry $edit-v2 (fetch/pagination/
      //        bundling issue — Tuwunel's `/relations recurse=true` may not
      //        stream m.replace edits back on every schedule window), or
      //   (ii) the chunk contains it but comparison returned false anyway.
      // Emitting (event_id, type, rel_type) triples per page makes those
      // two shapes readable at a glance in the next capture — no need for
      // another gate-fix iteration to answer the question.
      //
      // Read directly off the raw event JSON (pre-mapper): the mapper
      // returns MatrixEvent instances, and interrogating them for rel_type
      // requires an accessor per event; the raw shape is what the server
      // returned and is what would need to be persisted regardless. Cheap:
      // `logTimelineDebug` is gated on both a present traceId AND the
      // `mindroom.debug.timeline` localStorage flag — no work in prod.
      if (debugTraceId) {
        const triples = page.events.map((raw) => {
          const relatesTo = (raw.content as Record<string, unknown> | undefined)?.[
            'm.relates_to'
          ] as { rel_type?: string } | undefined;
          const bundled = (raw.unsigned as Record<string, unknown> | undefined)?.['m.relations'] as
            | Record<string, unknown>
            | undefined;
          return {
            event_id: raw.event_id,
            type: raw.type,
            rel_type: relatesTo?.rel_type,
            bundled_relations: bundled ? Object.keys(bundled) : undefined,
          };
        });
        logTimelineDebug(debugTraceId, 'reconcile-chunk', {
          iteration: iterations,
          chunkSize: page.events.length,
          nextToken: page.nextToken ? 'present' : 'absent',
          triples,
        });
      }

      // Map each fetched raw event through the prefer-live mapper. This
      // is the Tuwunel stale-copy heal path: if the raw event carries
      // `unsigned.redacted_because` and the live SDK instance does not
      // yet know it's redacted, `createPreferLiveEventMapper` applies
      // `makeRedacted` immediately, which cascades into the SDK's
      // relation aggregation cleanup. See P1.2 F6-B decision.
      const pageRaw = page.events.slice().reverse();
      const pageMapped = pageRaw.map(preferLive);
      fetchedCount += pageMapped.length;
      allRaw.push(...pageRaw);
      allMapped.push(...pageMapped);

      // Convergence check: any event id in the fetched page that we
      // already have in cache means the server tail has caught up with
      // (or overlaps) what the cache knows. Removes F7's 200-event
      // ceiling — the reconciler pages further only when the divergence
      // is deeper than the current batch.
      const overlap = pageMapped.some((mEvent) => {
        const id = mEvent.getId();
        return typeof id === 'string' && originalOverlapEventIds.has(id);
      });
      if (!page.nextToken) {
        scanExit = 'end';
        break;
      }
      if (overlap) {
        scanExit = 'overlap';
        break;
      }
      if (page.nextToken === fromToken) {
        scanExit = 'token-loop';
        break;
      }
      fromToken = page.nextToken;
    }
    if (!scanExit) scanExit = 'page-cap';

    const scanComplete = scanExit === 'overlap' || scanExit === 'end';
    if (scanComplete && continuation && continuation.validatingHead !== true) {
      // The older cursor reached its original boundary. Re-scan from the
      // current head before clearing so events that arrived between passes
      // are included in this same reconcile result.
      if (phaseStartToken !== undefined && originalOverlapEventIds.size === 0) {
        // An empty boundary means the original cache was empty. Only after
        // the resumed suffix completes can the pages durably persisted by an
        // earlier phase become a safe bridge for fresh-head validation.
        cachedRevisions.forEach((_revision, eventId) => originalOverlapEventIds.add(eventId));
      }
      // eslint-disable-next-line no-await-in-loop
      if (await restartContinuationFromHead()) {
        scanAnotherPhase = true;
        continue;
      }
      // The fetched suffix is useful for repair, but it is not authoritative
      // for absence and must not clear the continuation until a fresh-head
      // phase has been durably established.
      fetchFailedOccurred = true;
      scanExit = 'fetch-failed';
    }

    const invalidSavedToken = scanExit === 'token-loop' || savedTokenRejected;
    if (invalidSavedToken && continuation) {
      // A saved token can expire or a server can repeat it. Reset the cursor
      // generation-safely rather than retrying the same unusable token on
      // every future open. Retry from head once in this invocation.
      // eslint-disable-next-line no-await-in-loop
      const restarted = await restartContinuationFromHead();
      if (restarted && !recoveredInvalidToken) {
        recoveredInvalidToken = true;
        scanAnotherPhase = true;
        continue;
      }
    }
    break;
  }

  if (signal.aborted) {
    // Post-loop signal-abort — same class as in-loop signal-abort.
    countCacheProbe('reconcilesSignalAborted');
    return { reason, repaired: false, fetchedCount, iterations, aborted: true };
  }

  // CINNY-207 P5 review (greptile P1: paged batch order reverses):
  // when divergence spans multiple `/relations` pages, each backward
  // page is reversed internally (older→newer within the page), but
  // page 1's events are chronologically NEWER than page 2's. Naive
  // concatenation produces [page1_older..page1_newer, page2_older..
  // page2_newer] where all of page 2 < all of page 1 — a non-
  // monotonic array. Downstream consumers benefit from a
  // chronologically ordered batch: `thread.addEvents(events, false)`
  // observes the tail in the correct order for SDK aggregation, the
  // persistence writer builds a monotonic snapshot, and `onRepaired`
  // hands the render layer a batch that matches the SDK's ordering
  // invariants. Mirrors the gap-fill executor's post-flatten sort.
  //
  // Stable sort by origin_server_ts ascending; ties preserve fetch
  // order (within a page the reverse already yields chronological
  // order, so ties across identical timestamps stay in the SDK's
  // wire order).
  if (allMapped.length > 1) {
    allMapped.sort((a, b) => a.getTs() - b.getTs());
  }

  const scanComplete = scanExit === 'overlap' || scanExit === 'end';

  // Zero-fetch fast path — the D7 cheap no-op. When the server returned
  // no events (or all fetches failed) there is nothing to reconcile and
  // no tick to fire.
  if (allMapped.length === 0) {
    if ((scanExit === 'overlap' || scanExit === 'end') && continuation?.validatingHead === true) {
      await continuationStore
        .clear(sessionId, roomId, threadId, continuation.generation)
        .catch(() => false);
    } else if (!scanComplete && fromToken && scanExit !== 'token-loop') {
      const currentContinuation = await ensureContinuation();
      if (currentContinuation) {
        await continuationStore
          .checkpoint(sessionId, roomId, threadId, currentContinuation.generation, fromToken)
          .catch(() => false);
      }
    }
    // CINNY-207 AC2 STEP 1 (2026-07-04): treat "fetch failed with no
    // usable pages" AND "server returned empty chunks" as the same
    // outcome bucket for probe purposes — both are silent exits with
    // no divergence assessment possible. `fetchFailedOccurred` flags
    // the first (SDK threw at least once), but both branches must
    // increment a counter so the invariant
    //   reconcilesScheduled == sum(outcome counters)
    // holds. Using a single bucket keeps that arithmetic honest;
    // splitting SDK-threw vs empty-chunk would require another
    // counter and the diagnosis value is low.
    countCacheProbe('reconcilesFetchFailed');
    logTimelineDebug(debugTraceId, 'reconcile-complete', {
      fetchedCount: 0,
      iterations,
      reason,
      repaired: false,
      roomId,
      threadId,
      fetchFailedOccurred,
    });
    return { reason, repaired: false, fetchedCount, iterations, aborted: false };
  }

  // Deterministic divergence check: does the fetched page introduce
  // anything the cache does not already agree with? Uses the same
  // event-ID and bundled-relation shape the applier will act on, so a
  // negative here proves the applier would be a no-op — skip both the
  // hydrate call and the onRepaired tick to keep the "cached was right"
  // path zero-cost.
  const diverged = detectDivergence(allRaw, cachedRevisions, cachedEmbeddedRelationEventIds);

  if (!diverged) {
    if ((scanExit === 'overlap' || scanExit === 'end') && continuation?.validatingHead === true) {
      await continuationStore
        .clear(sessionId, roomId, threadId, continuation.generation)
        .catch(() => false);
    } else if (!scanComplete && fromToken && scanExit !== 'token-loop') {
      const currentContinuation = await ensureContinuation();
      if (currentContinuation) {
        await continuationStore
          .checkpoint(sessionId, roomId, threadId, currentContinuation.generation, fromToken)
          .catch(() => false);
      }
    }
    // CINNY-207 AC2 STEP 1 (2026-07-04): the D7 no-op path — the
    // reconciler ran end to end and confirmed the cache agreed with
    // server truth. Cheap by design; the counter separates this from
    // silent failures upstream.
    countCacheProbe('reconcilesNoDivergence');
    logTimelineDebug(debugTraceId, 'reconcile-complete', {
      fetchedCount,
      iterations,
      reason,
      repaired: false,
      roomId,
      threadId,
    });
    return { reason, repaired: false, fetchedCount, iterations, aborted: false };
  }

  // P5-GATE-FIX (AC2): inject the fetched, mapped events into the SDK
  // thread model BEFORE hydration. Without this step, `applyCached*`
  // mutations either land on fresh clones (when the SDK doesn't yet
  // know the fetched event id — e.g. a m.replace that happened while
  // the client was closed) or land on the SDK's live instance but
  // never surface to render because `useThreadRenderState` reads
  // `thread.events`, which is populated by `thread.addEvents`, not by
  // arbitrary MatrixEvent instances in scope.
  //
  // This mirrors the pre-P5 `runThreadOpenPostBootstrapRefresh` pattern
  // (removed in commit 05594b54) which called
  // `currentThread.addEvents(latestEvents, false)` after `preferLive`
  // mapping. `thread.addEvents(events, toStartOfTimeline=false)` is
  // idempotent per event id — the SDK dedupes on `event_id` so
  // re-injecting a live event we already had is a no-op. The
  // `toStartOfTimeline=false` argument is correct here: reconcile
  // fetches the TAIL (dir: Backward starting from HEAD), and each
  // batch of fetched events is chronologically the "newest end" of
  // the thread relative to what the SDK currently holds.
  const liveThread = room.getThread(threadId);
  if (liveThread && allMapped.length > 0) {
    liveThread.addEvents(allMapped, false);
  } else if (!liveThread && allMapped.length > 0) {
    // P5-GATE-FIX v4 (AC2 diagnosis): the complete-coverage cache-first
    // reopen path deliberately skips SDK bootstrap, so `room.getThread`
    // returns null here even though a repair is needed. The SDK
    // injection above no-ops silently in that case — convergence must
    // come entirely from the render-fallback leg (widened `onRepaired`
    // → `setSupplementalThreadEvents`). Bump a probe counter and emit
    // a debug log so a failing docker trace can distinguish this shape
    // from "SDK thread present, injection ran but render still stale".
    countCacheProbe('reconcilesThreadNull');
    logTimelineDebug(debugTraceId, 'reconcile-thread-null', {
      reason,
      roomId,
      threadId,
      mappedCount: allMapped.length,
      note: 'room.getThread returned null at injection time — SDK bootstrap skipped by complete-coverage cache-first path; convergence relies on the render-fallback leg via onRepaired',
    });
  }

  // Repair path: run the same hydration pipeline the persist layer uses
  // (P1.2). `applyCachedRedactions` handles missed redactions (Tuwunel
  // stale copies included via the prefer-live mapper above);
  // `applyCachedReplaceRelations` + `applySerializedCachedReplaceRelations`
  // apply missed edits under D12 ordering (idempotent — no change when
  // cache already had the newest); `aggregateCachedRelationEvents`
  // registers new relation events (and removes redacted ones) with the
  // SDK's live indices so reaction chips update in place.
  //
  // After the SDK injection above, `liveThread?.getUnfilteredTimelineSet()`
  // is re-read so any timeline set the SDK created on first addEvents
  // is captured — otherwise hydration's aggregation step would run
  // against a stale (empty) timelineSet reference.
  const liveThreadTimelineSet = liveThread?.getUnfilteredTimelineSet();
  // P5-GATE-FIX v2 (AC2 instance-race): the render layer on the
  // complete-coverage cache-first path holds the MatrixEvent instances
  // that `hydrateThreadFromCache` handed to `setSupplementalThreadEvents`
  // (SDK bootstrap is skipped by design when the cache is complete —
  // see `threadOpenCacheFirst.ts`). Those instances are exposed on
  // `cachedPage.hydratedEvents`; the P1.2 hydration pipeline builds
  // `applyCachedReplaceRelations`'s event-id → target map from
  // whatever we pass in, and calls `makeReplaced` on the matching
  // entry. To make the repair visible in render, we MUST pass THOSE
  // instances (or, where the SDK has a newer live copy, that live
  // instance via `preferLive` — the P1.2 both-ways-heal spirit).
  //
  // Fallback (`hydratedEvents` absent): re-hydrate the raw JSON via
  // `preferLive`. Kept for defense-in-depth against future callers
  // that skip hydratedEvents, but on
  // complete-coverage today, `hydratedEvents` is always populated by
  // `hydrateThreadFromCache`.
  const cachedSnapshotEvents = cachedPage
    ? resolveCachedSnapshotEventsForRepair({
        cachedPage,
        preferLive,
        room,
      })
    : [];
  const mergedForHydrate = mergeThreadRenderEvents(cachedSnapshotEvents, allMapped);
  const redactedRelationTargets = collectRedactedRelationTargetsFromLookup(
    allMapped,
    cachedSnapshotEvents
  );
  hydrateCachedEvents({
    room,
    events: mergedForHydrate,
    timelineSets: liveThreadTimelineSet ? [liveThreadTimelineSet] : undefined,
  });
  // Additional pass to reconcile redactions that the prefer-live mapper
  // healed on the live instance — those still need aggregation cleanup
  // against the live timeline's `Relations` container.
  if (liveThreadTimelineSet && redactedRelationTargets.length > 0) {
    reconcileRelationEventsWithAggregation(
      allMapped,
      [{ relations: liveThreadTimelineSet.relations, timelineSet: liveThreadTimelineSet }],
      undefined,
      redactedRelationTargets
    );
  }
  countCacheProbe('reconcilesRepaired');

  // P5-GATE-FIX v4 (final iteration — team-lead directive 2026-07-04):
  // persist the fetched thread events through the ENGINE PERSIST path.
  //
  // The pre-v4 chain (SDK inject + widened onRepaired supplemental sink)
  // converged in MEMORY but never taught the CACHE about the fetched
  // events. That created a design seam: convergence was timing-
  // dependent (which of live-sync / reconciler / render tick won a
  // given race decided whether v1 or v2 painted), and — crucially —
  // the NEXT reopen from IDB rehit the same stale window because the
  // gap-fill executor only writes room scope and the live-mode gates
  // skip catch-up-sync bursts by design.
  //
  // Making the reconciler the deterministic owner: on divergence we
  // write the fully-mapped, prefer-live batch to the thread cache
  // scope via `persistThreadEventCacheSnapshot` (same entry point the
  // engine's write-through uses). This gives us two invariants that
  // hold regardless of sync timing:
  //   (a) A cache-first reopen after this pass paints the fetched
  //       state directly, without waiting for the reconciler to run
  //       again.
  //   (b) The `fallbackThreadEventsState.events` sink populated by
  //       `setSupplementalThreadEvents` (fired via onRepaired below)
  //       and the cache-hydrate-on-reopen path agree — no more
  //       "renderPreference decides which stale side to paint".
  //
  // Contract details:
  //   - Uses the SAME snapshot writer as the write-through so seed
  //     snapshots / tokens / reply counts follow the shape the rest
  //     of the system expects. `tailLoaded` is left undefined so the
  //     no-downgrade merge in `saveThreadEventsToCache` preserves the
  //     open path's asserted tail state.
  //   - Root event is resolved through `room.getThread(threadId)?.rootEvent`
  //     falling back to `room.findEventById(threadId)` — identical to
  //     the persist logic in `engineWriteThrough.persistThreadEvents`.
  //   - The pass does not claim durable convergence until the committed
  //     writer resolves. A failed/disabled cache still returns the repaired
  //     in-memory view so observers can update the current UI; `durable`
  //     exposes that the next open must reconcile again.
  const rootEvent =
    room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId) ?? undefined;
  if (!scanComplete && fromToken && scanExit !== 'token-loop') {
    await ensureContinuation();
  }
  const canCheckpoint = Boolean(continuation && fromToken && scanExit !== 'token-loop');
  let durable = false;
  if (scanComplete || canCheckpoint) {
    const repairSnapshot = persistRepair({
      sessionId,
      room,
      threadId,
      events: allMapped,
      rootEvent,
      relationSnapshotMode: 'authoritative',
      authoritativeRawEvents: allRaw,
    });
    const writeCommitted = await repairSnapshot.write.catch(() => false);
    countCacheProbe('reconcilerPersists');
    if (writeCommitted === true) {
      if (scanComplete && continuation?.validatingHead === true) {
        durable = await continuationStore
          .clear(sessionId, roomId, threadId, continuation.generation)
          .catch(() => false);
      } else if (scanComplete && !continuation) {
        durable = true;
      } else if (continuation && fromToken) {
        durable = await continuationStore
          .checkpoint(sessionId, roomId, threadId, continuation.generation, fromToken)
          .catch(() => false);
      }
    }
  }

  // P5-GATE-FIX v3 (AC2 dual-injection, render leg): hand the
  // fully-mapped, prefer-live batch to the caller. Component-side
  // callback routes it through `setSupplementalThreadEvents(threadId,
  // batch)` — the render's fallback-events sink. This keeps the
  // engine free of any knowledge of `setSupplementalThreadEvents`
  // (P3.3 render-only boundary invariant) while making both render
  // paths converge on the same tick: SDK-populated `thread.events`
  // (from `liveThread.addEvents(allMapped, false)` above) AND the
  // component-owned `fallbackThreadEventsState.events`.
  //
  // CINNY-207 AC2 render-gap RG5-fix (2026-07-04): pass
  // `mergedForHydrate` (cachedSnapshotEvents + allMapped) instead of
  // just `allMapped`. RG4d diagnosis: when the fetched /relations page
  // includes a target's m.replace child but not the target itself
  // (e.g. the target sits in the pre-hydrated cache snapshot outside
  // the fetched window), the applier's id→instance map picks the
  // cached-snapshot copy for the makeReplaced target and mutates it in
  // place. Passing only `allMapped` to onRepaired meant that mutated
  // instance never reached the sink; the fallback registry then got a
  // SYNC-delivered sibling (via ThreadEvent.NewReply → single-event
  // sink call) that never had `.replacingEvent()` set, and the render
  // preference picked the un-repaired sibling. Passing the full
  // hydrated view makes the "persistent render source for a given
  // thread-open" = the reconciler-repaired view, per team-lead's
  // fourth-shape directive. Sink merge is a Map-by-key, so replaying
  // cachedSnapshotEvents (already render-held) is idempotent modulo
  // instance-identity — and identity is precisely what we want to
  // propagate here.
  logTimelineDebug(debugTraceId, 'reconcile-complete', {
    durable,
    fetchedCount,
    iterations,
    scanExit,
    reason,
    repaired: true,
    roomId,
    threadId,
  });
  return {
    reason,
    repaired: true,
    fetchedCount,
    iterations,
    aborted: false,
    repairedEvents: mergedForHydrate,
    durable,
  };
};

/**
 * Schedule a reconcile pass. Producer of a `BackfillScheduler` job of
 * kind `'reconcile'` at band 0.
 *
 * D7 rule enforced here: SCHEDULING is unconditional (every open
 * schedules exactly one reconcile — that's AC9). COALESCING happens
 * inside the scheduler — a second call for the same
 * (roomId, threadId, 'reconcile') key while the first is in-flight
 * returns the same promise identity, and `schedulerDeduped` bumps.
 * That gives the "cached was right" path zero extra network use even
 * when multiple UI events (thread open + tab focus) both call in.
 */
export const scheduleReconcile = (args: ScheduleReconcileArgs): Promise<ReconcileResult> => {
  const {
    mx,
    sessionId,
    scheduler,
    roomId,
    room: providedRoom,
    threadId,
    cachedPage,
    reason,
    onRepaired,
    debugTraceId,
    persistRepair = persistThreadEventCacheSnapshotCommitted,
    continuationStore = DEFAULT_CONTINUATION_STORE,
  } = args;

  // P5-GATE-FIX (AC2 observability): every scheduleReconcile call
  // bumps the counter. That gives a
  // capture the ability to prove the open path fired vs. never fired,
  // regardless of what the scheduler ends up doing (dedup, abort, etc.
  // — those have their own counters). Same lesson as `schedulerFailed`
  // from the P4 gate fix: without a "was it even scheduled?" counter,
  // trace analysis is guesswork.
  countCacheProbe('reconcilesScheduled');

  logTimelineDebug(debugTraceId, 'reconcile-scheduled', {
    reason,
    roomId,
    threadId,
  });

  const reconcilePromise = scheduler.enqueue<ReconcileResult>({
    roomId,
    threadId,
    kind: 'reconcile',
    priority: 0,
    execute: (signal) => {
      const room = providedRoom ?? mx.getRoom?.(roomId);
      if (!room) {
        countCacheProbe('reconcilesNoRoom');
        return Promise.resolve({
          reason,
          repaired: false,
          fetchedCount: 0,
          iterations: 0,
          aborted: false,
        });
      }
      return runThreadReconcilePass({
        mx,
        sessionId,
        room,
        roomId,
        threadId,
        cachedPage,
        signal,
        reason,
        debugTraceId,
        persistRepair,
        continuationStore,
      });
    },
  });

  if (!onRepaired) return reconcilePromise;

  // Observers are attached to the shared network result, not captured
  // by the first deduped executor. A close/reopen while reconciliation
  // is running therefore lets the new mounted view receive the same
  // repaired batch even if the old callback's mount guard declines it.
  return reconcilePromise.then((result) => {
    if (result.repaired && result.repairedEvents) {
      onRepaired(result.repairedEvents);
      countCacheProbe('reconcilesOnRepairedFired');
    }
    return result;
  });
};
