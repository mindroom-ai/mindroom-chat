/**
 * CINNY-207 P5.1: engine reconciler.
 *
 * Every room and thread open schedules one reconcile pass through the
 * P4.1 `BackfillScheduler`. Coverage decides what to PAINT (D7); the
 * reconciler decides what to REPAIR. When cache and server agree the
 * pass is a cheap no-op (fetch, diff, empty). When they diverge (a
 * missed edit, a missed redaction, a reaction that was removed while
 * the client was closed) the pass applies the repair in place using
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
  persistThreadEventCacheSnapshot,
} from '../threads/eventRepository';
import {
  collectRedactedRelationTargetsFromLookup,
  hydrateCachedEvents,
  reconcileRelationEventsWithAggregation,
} from '../threads/eventCacheEditUtils';
import { logTimelineDebug } from '../threads/timelineDebug';
import { countCacheProbe } from '../threads/cacheProbe';
import type { BackfillScheduler } from './backfillScheduler';
import type { HydratedThreadCachePage } from '../threads/threadOpenCacheController';

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

/**
 * Why the reconcile pass was scheduled. Included in probe logs so a
 * capture can distinguish "user opened a thread we already had cached
 * (D7 revalidation)" from "user opened a fresh room we just hydrated".
 */
export type ReconcileReason =
  | 'open-complete-coverage'
  | 'open-partial-coverage'
  | 'room-open'
  | 'resume';

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
   * When set, this is a thread-scoped reconcile. Undefined means the
   * room-scope pass (P5.1 Commit 3 wires that variant).
   */
  readonly threadId?: string;
  /**
   * Hydrated cache page from the open path. Used to diff the fetched
   * server page against what we already have. Absent for the room-open
   * variant.
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
   * Optional predicate to abort mid-pass. Wired so a component unmount
   * (thread closed, room switched) can stop a straggling reconcile
   * without waiting for the scheduler's own abort signal to propagate.
   */
  readonly shouldContinue?: () => boolean;
  /**
   * Optional debug trace id. When present, reconciler observability
   * events (`reconcile-scheduled`, `reconcile-complete`) attach it so
   * a capture can be correlated with the surrounding thread-open flow.
   */
  readonly debugTraceId?: string;
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

const buildCachedEventIdSet = (cachedPage: HydratedThreadCachePage): Set<string> => {
  const ids = new Set<string>();
  if (cachedPage.rootEvent?.event_id) {
    ids.add(cachedPage.rootEvent.event_id as string);
  }
  cachedPage.events.forEach((rawEvent) => {
    const id = rawEvent.event_id;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  });
  return ids;
};

/**
 * True when the diff between the fetched page and the cache introduces
 * an in-place change: a new event id, a redaction whose target was in
 * cache, or an edit whose target was in cache. The reconciler only
 * fires `onRepaired` when this returns true; a diff of pure "same ids,
 * same content" costs zero ticks (the D7 cheap no-op).
 */
const detectDivergence = (
  fetched: MatrixEvent[],
  cachedIds: Set<string>
): boolean => {
  for (const mEvent of fetched) {
    const id = mEvent.getId();
    if (!id) continue;

    // New event we did not have. Covers "message the server has that
    // we missed" and "reaction added while offline".
    if (!cachedIds.has(id)) return true;

    // A redaction event whose target is in cache — the applier needs
    // to prune the target and its aggregations.
    if (mEvent.isRedaction()) {
      const targetId = mEvent.getAssociatedId();
      if (targetId && cachedIds.has(targetId)) return true;
    }

    // The same-id event may carry a bundled edit newer than what we
    // have; treating any bundled edit on a cached id as potential
    // divergence keeps the check cheap. `applyCachedReplaceRelations`
    // is a no-op if the target's `replacingEvent()` already points at
    // the newer edit (getLatestEdit / D12 idempotence).
    const raw = mEvent.event as Partial<IEvent> | undefined;
    const bundled = (raw?.unsigned as Record<string, unknown> | undefined)?.[
      'm.relations'
    ] as Record<string, unknown> | undefined;
    if (bundled && bundled['m.replace']) return true;
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
): Promise<{ events: Partial<IEvent>[]; nextToken?: string } | undefined> => {
  const [err, relData] = await to(
    mx.fetchRelations(roomId, threadId, null, null, {
      dir: Direction.Backward,
      limit: RECONCILE_BATCH_SIZE,
      recurse: true,
      ...(fromToken ? { from: fromToken } : {}),
    })
  );
  if (err || !relData) return undefined;
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
  onRepaired,
  shouldContinue,
  signal,
  reason,
  debugTraceId,
}: {
  mx: MatrixClient;
  sessionId: string;
  room: Room;
  roomId: string;
  threadId: string;
  cachedPage: HydratedThreadCachePage | undefined;
  onRepaired: ((repairedEvents: readonly MatrixEvent[]) => void) | undefined;
  shouldContinue: (() => boolean) | undefined;
  signal: AbortSignal;
  reason: ReconcileReason;
  debugTraceId: string | undefined;
}): Promise<ReconcileResult> => {
  const cachedIds = cachedPage ? buildCachedEventIdSet(cachedPage) : new Set<string>();
  const mapper = mx.getEventMapper();
  const preferLive = createPreferLiveEventMapper(room, mapper);

  let fetchedCount = 0;
  let iterations = 0;
  let fromToken: string | undefined;
  const allMapped: MatrixEvent[] = [];

  while (iterations < MAX_RECONCILE_ITERATIONS) {
    if (signal.aborted) {
      return { reason, repaired: false, fetchedCount, iterations, aborted: true };
    }
    if (shouldContinue && !shouldContinue()) {
      return { reason, repaired: false, fetchedCount, iterations, aborted: true };
    }

    iterations += 1;
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchThreadRelationPage(mx, roomId, threadId, fromToken);
    if (!page) break;

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
        const bundled = (raw.unsigned as Record<string, unknown> | undefined)?.[
          'm.relations'
        ] as Record<string, unknown> | undefined;
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
    const pageMapped = page.events.slice().reverse().map(preferLive);
    fetchedCount += pageMapped.length;
    allMapped.push(...pageMapped);

    // Convergence check: any event id in the fetched page that we
    // already have in cache means the server tail has caught up with
    // (or overlaps) what the cache knows. Removes F7's 200-event
    // ceiling — the reconciler pages further only when the divergence
    // is deeper than the current batch.
    const overlap = pageMapped.some((mEvent) => {
      const id = mEvent.getId();
      return typeof id === 'string' && cachedIds.has(id);
    });
    if (overlap) break;

    if (!page.nextToken) break;
    if (page.nextToken === fromToken) break;
    fromToken = page.nextToken;
  }

  if (signal.aborted) {
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

  // Zero-fetch fast path — the D7 cheap no-op. When the server returned
  // no events (or all fetches failed) there is nothing to reconcile and
  // no tick to fire.
  if (allMapped.length === 0) {
    logTimelineDebug(debugTraceId, 'reconcile-complete', {
      fetchedCount: 0,
      iterations,
      reason,
      repaired: false,
      roomId,
      threadId,
    });
    return { reason, repaired: false, fetchedCount, iterations, aborted: false };
  }

  // Deterministic divergence check: does the fetched page introduce
  // anything the cache does not already agree with? Uses the same
  // event-ID and bundled-relation shape the applier will act on, so a
  // negative here proves the applier would be a no-op — skip both the
  // hydrate call and the onRepaired tick to keep the "cached was right"
  // path zero-cost.
  const diverged = detectDivergence(allMapped, cachedIds);

  if (!diverged) {
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
      note:
        'room.getThread returned null at injection time — SDK bootstrap skipped by complete-coverage cache-first path; convergence relies on the render-fallback leg via onRepaired',
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
  // that skip hydratedEvents, and for the room-scope path — but on
  // complete-coverage today, `hydratedEvents` is always populated by
  // `hydrateThreadFromCache`.
  const cachedSnapshotEvents = cachedPage
    ? resolveCachedSnapshotEventsForRepair({
        cachedPage,
        preferLive,
        room,
      })
    : [];
  const mergedForHydrate = [...cachedSnapshotEvents, ...allMapped];
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
      [
        { relations: liveThreadTimelineSet.relations, timelineSet: liveThreadTimelineSet },
      ],
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
  //   - Fire-and-forget: the return value is the serialized shape,
  //     not a promise; the actual IDB write is dispatched inside the
  //     snapshot writer via `void save(...)`.
  const rootEvent =
    room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId) ?? undefined;
  persistThreadEventCacheSnapshot({
    sessionId,
    room,
    threadId,
    events: allMapped,
    rootEvent,
  });
  countCacheProbe('reconcilerPersists');

  // P5-GATE-FIX v3 (AC2 dual-injection, render leg): hand the
  // fully-mapped, prefer-live batch to the caller. Component-side
  // callback routes it through `setSupplementalThreadEvents(threadId,
  // batch)` — the render's fallback-events sink. This keeps the
  // engine free of any knowledge of `setSupplementalThreadEvents`
  // (P3.3 render-only boundary invariant) while making both render
  // paths converge on the same tick: SDK-populated `thread.events`
  // (from `liveThread.addEvents(allMapped, false)` above) AND the
  // component-owned `fallbackThreadEventsState.events`.
  if (onRepaired) {
    onRepaired(allMapped);
    // P5-GATE-FIX v4 (final iteration): definitive callback-fired
    // evidence. `reconcilesRepaired` bumped BEFORE this line, so a
    // guard-skipped or throwing callback would leave
    // reconcilesOnRepairedFired at 0 while reconcilesRepaired at N.
    // That gap is diagnostic for docker traces: it distinguishes
    // "hydration ran but callback was gated out (isCurrentThreadOpen,
    // mounted ref, threadIdRef mismatch)" from "callback ran end to
    // end but render still stale". If we ever wrap this in a try, the
    // increment must stay inside — a throw before the bump would be
    // silently invisible in probe traces.
    countCacheProbe('reconcilesOnRepairedFired');
  }

  logTimelineDebug(debugTraceId, 'reconcile-complete', {
    fetchedCount,
    iterations,
    reason,
    repaired: true,
    roomId,
    threadId,
  });
  return { reason, repaired: true, fetchedCount, iterations, aborted: false };
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
    shouldContinue,
    debugTraceId,
  } = args;

  // P5-GATE-FIX (AC2 observability): every scheduleReconcile call
  // bumps the counter — thread-scope AND room-scope. That gives a
  // capture the ability to prove the open path fired vs. never fired,
  // regardless of what the scheduler ends up doing (dedup, abort, etc.
  // — those have their own counters). Same lesson as `schedulerFailed`
  // from the P4 gate fix: without a "was it even scheduled?" counter,
  // trace analysis is guesswork.
  countCacheProbe('reconcilesScheduled');

  if (!threadId) {
    // CINNY-207 P5.1 Commit 3: room-scope reconcile pass.
    //
    // Room-open catchup is already covered by two engine-owned
    // producers wired in Phase 3.2 / Phase 4.2:
    //
    //   - `RoomEvent.TimelineReset` writes the durable
    //     `tailDiscontinuity` marker and enqueues a `'limited-sync'`
    //     gap-fill job.
    //   - `Sync -> PREPARED` enqueues a per-room `'startup'` gap-fill
    //     job for each joined room whose marker is set.
    //
    // The P4.2 gap-fill executor consumes both queues and drives a
    // `mx.createMessagesRequest` catchup, persisting through
    // `saveRoomEventsToCache` and clearing the marker on completion.
    // That IS the room-scope convergence path — a room-open reconcile
    // running its own `/messages` catchup would duplicate the work
    // (and, thanks to the scheduler's dedup key including `kind`,
    // would need coordination with the gap-fill kind to avoid it).
    //
    // What P5 adds at the room scope is the SCHEDULE tripwire: every
    // room open passes through the scheduler with `'reconcile'` +
    // undefined threadId, which gives us observability parity with
    // the thread path (probe counters bump; a capture confirms the
    // room-open path never accidentally short-circuits away from the
    // engine). The executor is intentionally a fast no-op — the real
    // repair work fires from the gap-fill queue when the marker is
    // set.
    return scheduler.enqueue<ReconcileResult>({
      roomId,
      kind: 'reconcile',
      priority: 0,
      execute: async (signal) => {
        if (signal.aborted) {
          return {
            reason,
            repaired: false,
            fetchedCount: 0,
            iterations: 0,
            aborted: true,
          };
        }
        logTimelineDebug(debugTraceId, 'reconcile-complete', {
          fetchedCount: 0,
          iterations: 0,
          reason,
          repaired: false,
          roomId,
          threadId: null,
          note: 'room-scope reconcile — tail catchup owned by gap-fill executor',
        });
        // onRepaired intentionally NOT called: the executor did no
        // repair work (tail catchup owned by gap-fill). Firing the
        // tick here would violate the invariant "onRepaired fires
        // only when a repair was actually applied".
        return {
          reason,
          repaired: false,
          fetchedCount: 0,
          iterations: 0,
          aborted: false,
        };
      },
    });
  }

  logTimelineDebug(debugTraceId, 'reconcile-scheduled', {
    reason,
    roomId,
    threadId,
  });

  return scheduler.enqueue<ReconcileResult>({
    roomId,
    threadId,
    kind: 'reconcile',
    priority: 0,
    execute: (signal) => {
      const room = providedRoom ?? mx.getRoom?.(roomId);
      if (!room) {
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
        onRepaired,
        shouldContinue,
        signal,
        reason,
        debugTraceId,
      });
    },
  });
};
