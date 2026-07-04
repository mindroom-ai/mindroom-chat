/**
 * CINNY-207 P0.1: cache write/read observability probe.
 *
 * Pure counters — no behavior change. Incremented from the IndexedDB cache
 * write paths and readable for debugging/measurement through
 * `window.__MINDROOM_CACHE_PROBE__`. Counters record *attempted* puts
 * (counted before the transaction commits, so an aborted transaction still
 * counts and additionally ticks `writeErrors`). `eventDeletes` is reserved
 * for the P1.2 delete paths. Baselines and acceptance criteria live in
 * docs/mindroom-cache-overhaul-plan.md (AC5 requires IDB writes per live
 * event to be O(1); the probe is how that claim is measured).
 */

export type CacheProbeCounters = {
  roomSaveCalls: number;
  roomEventPuts: number;
  roomMetaPuts: number;
  threadSaveCalls: number;
  threadEventPuts: number;
  threadMetaPuts: number;
  eventDeletes: number;
  writeErrors: number;
  serializedEvents: number;
  // CINNY-207 P1.4 (AC4 evidence): counts trailing-debounced target upserts
  // fired by the edit-compaction scheduler. Each streaming burst of N edits
  // is expected to produce one increment here rather than N standalone
  // record puts.
  editCompactions: number;
  // Counts compaction fires where the replace target was not in SDK memory
  // and the write fell back to persisting the replace event standalone
  // (durability fallback — a silent drop would otherwise be invisible).
  editCompactionTargetMisses: number;
  // CINNY-207 P3.1 (AC6 evidence): counts live events processed by the
  // client-level MindroomSyncEngine. Bumped once per event delivered to
  // the engine's write-through handler after `liveMode` has flipped true
  // — so IDB-replay and initial-sync-burst events are excluded. A room
  // that is not currently mounted still contributes when its live events
  // arrive, which is the whole point of Tier-1 write-through.
  engineLiveWrites: number;
  // CINNY-207 P3.2 (AC13 evidence): counts gap-fill jobs enqueued by
  // the engine's gap tracker. Bumped once per job — startup jobs on
  // Sync→Prepared per joined room, plus limited-sync jobs on
  // RoomEvent.TimelineReset for the room's unfiltered timelineSet.
  // The Phase 4 executor will drain the queue and clear the marker.
  gapFillsEnqueued: number;
  // CINNY-207 P4.1 (AC8 evidence): BackfillScheduler observability.
  // `schedulerEnqueued` bumps on every accepted enqueue, `schedulerDeduped`
  // on the rejected duplicate (same-key AC8 dedup path), `schedulerAborted`
  // on cooperative abort teardown, `schedulerCompleted` on natural job
  // completion, and `schedulerFailed` on job executor rejection that
  // wasn't caused by an abort (P4 gate fix: silent job failures were
  // invisible from a trace and turned AC13 debugging into guesswork).
  // Together they measure the "no duplicate in-flight jobs per (room,
  // thread, kind)" invariant.
  schedulerEnqueued: number;
  schedulerDeduped: number;
  schedulerAborted: number;
  schedulerCompleted: number;
  schedulerFailed: number;
  // CINNY-207 P5-GATE-FIX (AC2 evidence): reconciler observability.
  // `reconcilesScheduled` bumps once per `scheduleReconcile` call
  // (thread-scope or room-scope), giving a trace the ability to
  // distinguish "the open path never asked for a reconcile" from
  // "the reconciler ran and found nothing to repair" — the same
  // observability lesson as schedulerFailed (P4 gate fix).
  // `reconcilesRepaired` bumps once per pass that actually applied
  // a repair (i.e. detectDivergence returned true and hydration
  // ran); the D7 cheap-no-op path leaves it untouched.
  reconcilesScheduled: number;
  reconcilesRepaired: number;
  // CINNY-207 P5-GATE-FIX v4 (AC2 diagnosis): bumps when the reconciler
  // reached the SDK-injection step with a non-empty mapped batch but
  // `room.getThread(threadId)` returned null. This is the exact
  // complete-coverage cache-first reopen shape team-lead flagged: SDK
  // bootstrap is skipped by design so the thread model does not exist
  // yet, and `liveThread.addEvents(...)` silently no-ops. A repair still
  // runs (hydration + supplemental sink via `onRepaired`) — this counter
  // distinguishes "SDK-only injection worked" from "SDK path no-op'd,
  // convergence relied entirely on the render-fallback leg" in a docker
  // trace without another blind cycle.
  reconcilesThreadNull: number;
  // CINNY-207 P5-GATE-FIX v4 (final iteration — team-lead directive
  // 2026-07-04): definitive evidence that the widened `onRepaired`
  // component-side callback was invoked and returned normally, i.e. the
  // supplemental sink into `setSupplementalThreadEvents` had a chance to
  // run. `reconcilesRepaired` bumps BEFORE the callback fires (so a
  // guard-skipped or throwing callback would still leave reconcilesRepaired
  // at N and reconcilesOnRepairedFired at 0 — that gap is diagnostic).
  reconcilesOnRepairedFired: number;
  // CINNY-207 P5-GATE-FIX v4 (final iteration — team-lead directive
  // 2026-07-04): counts reconciler repair passes that persisted the
  // fetched thread events through the engine snapshot writer after
  // divergence (see `reconciler.ts` for the exact call site). Team-lead's
  // seam analysis: the pre-v4 chain converged in memory (SDK inject +
  // render supplemental sink) but never taught the CACHE about the
  // fetched events — so the next reopen from IDB would re-hit the
  // same stale window and, if the render preference reads
  // `fallbackThreadEventsState.events` before the reconciler's next
  // tick lands, paint v1 again. This counter proves the persist leg
  // fired on the pass that triggered a repair; it complements
  // `threadSaveCalls` (which counts ALL persist paths including live
  // writes) by isolating the reconciler-owned persist.
  reconcilerPersists: number;
  // CINNY-207 AC2 STEP 1 (2026-07-04): distinguishable exit-path
  // counters for `runThreadReconcilePass`. Together with the existing
  // `reconcilesRepaired`, EVERY code path out of the executor increments
  // exactly one counter, so the invariant
  //   reconcilesScheduled ==
  //     reconcilesSignalAborted +
  //     reconcilesFetchFailed + reconcilesNoDivergence +
  //     reconcilesNoRoom + reconcilesRoomScopeNoop +
  //     reconcilesRepaired
  // holds and can be asserted from a docker probe snapshot.
  //
  //   reconcilesSignalAborted: `signal.aborted` was observed (in the
  //     loop or post-loop). The scheduler drove this via
  //     controller.abort — engine teardown / abort() call.
  //   reconcilesFetchFailed: fetchThreadRelationPage returned
  //     undefined (SDK threw) OR the fetch succeeded but the merged
  //     batch was empty (all pages returned empty chunks). Either way
  //     no divergence could be assessed.
  //   reconcilesNoDivergence: fetch produced a non-empty batch, but
  //     detectDivergence returned false — the "cached was right"
  //     zero-cost path (D7 no-op).
  //   reconcilesNoRoom: schedule reached the executor but
  //     `mx.getRoom(roomId)` returned null (rare — room unloaded
  //     between schedule and drain).
  //   reconcilesRoomScopeNoop: room-scope reconcile (no threadId)
  //     completed its scheduler tripwire without fetching (tail
  //     catchup is owned by the gap-fill executor).
  reconcilesSignalAborted: number;
  reconcilesFetchFailed: number;
  reconcilesNoDivergence: number;
  reconcilesNoRoom: number;
  reconcilesRoomScopeNoop: number;
  // CINNY-207 AC2 revision (2026-07-04): pruned to the minimal set that
  // still enforces the post-choke-point invariant. The iter-2 shape had
  // one schedule counter per branch (`threadOpenScheduledCacheFirst`,
  // `threadOpenScheduledLifecycle`) and 12 skip counters, one per early
  // return in the thread-open flow. With the schedule relocated to a
  // single unskippable choke point at the top of `runThreadOpenCacheFirst`
  // (right after the post-hydrate guard), all the branch-schedule
  // counters and post-choke-point skip counters became scaffolding for a
  // shape that no longer exists — pruning them per the product-owner
  // directive ("prune counters that guard now-impossible paths").
  //
  // Post-revision invariant asserted from a docker probe snapshot:
  //
  //   threadOpens ==
  //     threadOpenScheduledCacheFirst +
  //     threadOpenSkipCacheFirstHydrateGuard +
  //     threadOpenSkipCacheFirstPostHydrateGuard
  //
  //   threadOpens: bumps once at the start of the useEffect body for
  //     every open (guarded to skip the no-thread cleanup effect).
  //   threadOpenScheduledCacheFirst: bumps at the single choke-point
  //     schedule call site in `runThreadOpenCacheFirst` (right after
  //     the post-hydrate guard). Kept the historical name for
  //     git-blame continuity, but "cacheFirst" here means "the
  //     choke-point inside runThreadOpenCacheFirst" — there is no
  //     other schedule counter to disambiguate against.
  //   threadOpenSkipCacheFirstHydrateGuard: hydrate threw AND
  //     isCurrentThreadOpen() returned false; the open aborted before
  //     the choke-point could fire. Legitimate — the thread is closed.
  //   threadOpenSkipCacheFirstPostHydrateGuard: post-hydrate
  //     isCurrentThreadOpen() returned false; same shape, same
  //     legitimacy.
  //
  // Every OTHER path through the thread-open flow (SDK-bootstrap
  // early returns, backfill-completed paint-and-return, etc.) now
  // occurs AFTER the choke-point schedule fired, so those paths do
  // not need skip counters to prove convergence intent.
  threadOpens: number;
  threadOpenScheduledCacheFirst: number;
  threadOpenSkipCacheFirstHydrateGuard: number;
  threadOpenSkipCacheFirstPostHydrateGuard: number;
  // CINNY-207 AC2 render-gap RG1 (2026-07-04): sink counters that
  // distinguish the three candidate mechanisms for the render-gap
  // ("engine converges, edit-target v2 never renders"). Each names a
  // specific seam between the reconciler's onRepaired batch and the
  // MatrixEvent instance the render layer actually holds.
  //
  //   onRepairedGuardBailed: reconciler fired onRepaired but the
  //     component-side guard (`isCurrentThreadOpen()`) returned false,
  //     so `setSupplementalThreadEvents` did NOT run for this batch.
  //     Diagnostic for candidate (b) / (c): the repair batch reached
  //     the render seam but was gated out before the sink ran.
  //     Together with `reconcilesOnRepairedFired` (bumped inside the
  //     reconciler before calling the callback), the relation
  //     reconcilesOnRepairedFired == onRepairedGuardBailed +
  //       supplementalEventsExecuted + supplementalEventsSkippedEmpty
  //     holds and can be asserted from a probe snapshot.
  //   supplementalEventsExecuted: reconciler's onRepaired ran end to
  //     end and called `setSupplementalThreadEvents(threadId, [...])`.
  //     Diagnostic: sink executed; if v2 still not visible, the gap
  //     is downstream of the fallback state (candidate (a) or (b)).
  //   supplementalEventsSkippedEmpty: onRepaired ran but the repaired
  //     batch was empty, so the sink was intentionally skipped (see
  //     P5-GATE-FIX v3 cost-guarantee test). Kept separate so a docker
  //     trace can distinguish "sink skipped because nothing to sink"
  //     from "sink guarded out".
  onRepairedGuardBailed: number;
  supplementalEventsExecuted: number;
  supplementalEventsSkippedEmpty: number;
  // CINNY-207 AC2 render-gap RG1 (2026-07-04): mergeThreadRenderEvents
  // "edit-relation seen but target's replacingEvent() unchanged"
  // observability. Diagnostic for candidate (b): the merge received an
  // m.replace event but the target instance it kept has no
  // `replacingEvent()` set — i.e. the applier mutated some other
  // instance and this merge is picking the un-repaired copy. See
  // threadRenderUtils.ts `mergeThreadRenderEvents`.
  mergeSawEditRelationNoTargetChange: number;
  // CINNY-207 AC2 render-gap RG2 (2026-07-04): distinguishes
  // hypothesis 1 (merge never receives the edit event) from
  // hypothesis 2 (merge receives it and produces correct output, but
  // downstream render swallows). Bumps once per merge call whose
  // `incomingEvents` contains ANY m.replace event, regardless of
  // whether the target's replacingEvent() is set. If this counter is
  // 0 while supplementalEventsExecuted is >0, the sink fired but the
  // re-render / state propagation is not delivering the incoming
  // batch to the merge — the seam is between the sink and the memo.
  mergeSawIncomingEditRelation: number;
  // CINNY-207 AC2 render-gap RG3 (2026-07-04): observability at the
  // ACTUAL render-pipeline entry point (getEditedEvent in
  // utils/room.ts). Bumps once per getEditedEvent call:
  //
  //   renderTargetHadReplacement: `mEvent.replacingEvent()` returned
  //     a non-null candidate that PASSED the same-sender check and
  //     was included in the candidate edit list.
  //   renderTargetLackedReplacement: `mEvent.replacingEvent()`
  //     returned null.
  //
  // Diagnostic: if `renderTargetHadReplacement` is 0 while merge
  // counter `mergeSawEditRelationNoTargetChange` is also 0 AND the
  // merge saw incoming edits (`mergeSawIncomingEditRelation > 0`),
  // then the merge produced correct output but the RENDER is
  // receiving a DIFFERENT instance for the target — proving the seam
  // between "merge output stored in state" and "render reads state".
  renderTargetHadReplacement: number;
  renderTargetLackedReplacement: number;
  // CINNY-207 AC2 render-gap RG4a (2026-07-04): per-eventId regression
  // observability. Distinguishes candidate (i) "replacement was cleared
  // on the retained instance" from candidate (iii) "instance was
  // swapped — render picked a non-repaired sibling for the same id".
  //
  // Bookkeeping (all inside utils/room.ts getEditedEvent, per-eventId):
  //   - remember whether ANY prior getEditedEvent for this event id
  //     had `replacingEvent() != null` ("ever seen repaired for id X").
  //   - remember the LAST MatrixEvent instance passed for this id
  //     ("last instance for id X") via a WeakRef so we don't hold live
  //     event objects hostage in a counters module.
  //
  // Increment rules (mutually exclusive within a single call, so
  // renderTargetLackedReplacement == renderTargetRegressedNever +
  //   renderTargetRegressedSameInstance +
  //   renderTargetRegressedDifferentInstance holds):
  //   renderTargetRegressedNever: current call lacks replacement AND
  //     no prior call for this id had replacement. Not a regression —
  //     just a target that never had a repair applied yet.
  //   renderTargetRegressedSameInstance: current call lacks replacement,
  //     a prior call for this id had one, AND `mEvent` is the SAME
  //     MatrixEvent instance we saw before. This is candidate (i):
  //     the retained instance had its `_replacingEvent` cleared under
  //     us (e.g. a makeReplaced(null) somewhere, or SDK aggregation
  //     resetting it).
  //   renderTargetRegressedDifferentInstance: current call lacks
  //     replacement, a prior call for this id had one, AND `mEvent` is
  //     a DIFFERENT MatrixEvent instance than the one we last saw for
  //     this id. This is candidate (iii): the render seam swapped
  //     instances — a sibling MatrixEvent with the same id but no
  //     repair is being handed to the renderer.
  renderTargetRegressedNever: number;
  renderTargetRegressedSameInstance: number;
  renderTargetRegressedDifferentInstance: number;
  // CINNY-207 AC2 render-gap RG1 (2026-07-04): applyCachedReplaceRelations
  // ("hydrate applier") instance-identity observability. Diagnostic
  // for candidate (a) — the mechanism where the applier's
  // last-write-wins `eventById` map causes `makeReplaced` to mutate a
  // fresh non-render-held clone instead of the render-held one.
  //
  //   hydrateApplierMutatedRenderHeldInstance: applier mutated an
  //     instance that was originally supplied by the caller as a
  //     "render-held" event (marker set by the caller via
  //     `hydrateCachedEventsWithRenderHeldMarker` — see
  //     eventCacheEditUtils.ts). This is the desired shape — the
  //     mutation lands on the object the render layer holds.
  //   hydrateApplierMutatedFreshInstance: applier mutated an instance
  //     whose id has a marked render-held sibling in the same
  //     `eventById` scan, but the applier picked a different (fresh)
  //     instance for `makeReplaced`. This is the exact mechanism
  //     candidate (a) predicts — proves it in vivo if it bumps while
  //     `reconcilesRepaired` also bumped for the same batch.
  hydrateApplierMutatedRenderHeldInstance: number;
  hydrateApplierMutatedFreshInstance: number;
};

const createEmptyCounters = (): CacheProbeCounters => ({
  roomSaveCalls: 0,
  roomEventPuts: 0,
  roomMetaPuts: 0,
  threadSaveCalls: 0,
  threadEventPuts: 0,
  threadMetaPuts: 0,
  eventDeletes: 0,
  writeErrors: 0,
  serializedEvents: 0,
  editCompactions: 0,
  editCompactionTargetMisses: 0,
  engineLiveWrites: 0,
  gapFillsEnqueued: 0,
  schedulerEnqueued: 0,
  schedulerDeduped: 0,
  schedulerAborted: 0,
  schedulerCompleted: 0,
  schedulerFailed: 0,
  reconcilesScheduled: 0,
  reconcilesRepaired: 0,
  reconcilesThreadNull: 0,
  reconcilesOnRepairedFired: 0,
  reconcilerPersists: 0,
  reconcilesSignalAborted: 0,
  reconcilesFetchFailed: 0,
  reconcilesNoDivergence: 0,
  reconcilesNoRoom: 0,
  reconcilesRoomScopeNoop: 0,
  threadOpens: 0,
  threadOpenScheduledCacheFirst: 0,
  threadOpenSkipCacheFirstHydrateGuard: 0,
  threadOpenSkipCacheFirstPostHydrateGuard: 0,
  onRepairedGuardBailed: 0,
  supplementalEventsExecuted: 0,
  supplementalEventsSkippedEmpty: 0,
  mergeSawEditRelationNoTargetChange: 0,
  mergeSawIncomingEditRelation: 0,
  renderTargetHadReplacement: 0,
  renderTargetLackedReplacement: 0,
  renderTargetRegressedNever: 0,
  renderTargetRegressedSameInstance: 0,
  renderTargetRegressedDifferentInstance: 0,
  hydrateApplierMutatedRenderHeldInstance: 0,
  hydrateApplierMutatedFreshInstance: 0,
});

let counters = createEmptyCounters();

const HYDRATE_MARK_PREFIX = 'mindroom:cache-hydrate';

export const countCacheProbe = (key: keyof CacheProbeCounters, amount = 1): void => {
  counters[key] += amount;
};

export const getCacheProbeSnapshot = (): CacheProbeCounters => ({ ...counters });

// CINNY-207 AC2 render-gap RG4a (2026-07-04): per-eventId bookkeeping for
// the "previously had replacement, now lacks" probe. Held here (not in
// utils/room.ts) so `resetCacheProbe()` also resets the render-gap state
// — otherwise a docker session's second thread-open would inherit history
// from the first and inflate the regression counters.
//
// Design note: this map holds STRONG refs to MatrixEvent instances by
// design. This is a diagnostic-only probe (removed once RG4b lands); the
// pinning bounds the identity signal to precisely what we need — "same
// object we saw before?" — without the ambiguity WeakRef introduces (a
// GC'd prior instance is indistinguishable from a fresh instance). Since
// tsconfig.json targets ES2016 (no WeakRef in the type lib) and the
// render layer keeps these events alive for their render lifetime
// anyway, strong refs cost nothing in the diagnostic window.
type RenderTargetSeen = {
  everHadReplacement: boolean;
  lastInstance: object;
};
const renderTargetSeenById = new Map<string, RenderTargetSeen>();

// Exported for use by the render-pipeline seam (utils/room.ts).
// Not on the countCacheProbe surface because it needs the mEvent instance
// identity, not just a key name.
export const recordRenderTargetSeen = (
  eventId: string,
  mEvent: object,
  hasReplacement: boolean
): void => {
  const prev = renderTargetSeenById.get(eventId);
  if (hasReplacement) {
    // Positive observation: (re-)arm the tracker with this instance.
    renderTargetSeenById.set(eventId, { everHadReplacement: true, lastInstance: mEvent });
    return;
  }
  // Negative observation: classify the regression (or lack thereof).
  if (!prev || !prev.everHadReplacement) {
    countCacheProbe('renderTargetRegressedNever');
    renderTargetSeenById.set(eventId, {
      everHadReplacement: false,
      lastInstance: mEvent,
    });
    return;
  }
  if (prev.lastInstance === mEvent) {
    countCacheProbe('renderTargetRegressedSameInstance');
    // No map update — same instance, same state (regressed).
  } else {
    countCacheProbe('renderTargetRegressedDifferentInstance');
    // Update lastInstance so subsequent calls with THIS new instance are
    // classified as "same" — otherwise every re-render with the swapped
    // instance would keep bumping "different" and drown the signal.
    renderTargetSeenById.set(eventId, {
      everHadReplacement: true,
      lastInstance: mEvent,
    });
  }
};

export const resetCacheProbe = (): void => {
  counters = createEmptyCounters();
  renderTargetSeenById.clear();
  // Clear the hydrate timeline too, so a reset defines a clean measurement
  // window for both counters and timings.
  if (typeof performance !== 'undefined') {
    performance
      .getEntries()
      .filter((entry) => entry.name.startsWith(HYDRATE_MARK_PREFIX))
      .forEach((entry) => {
        if (entry.entryType === 'measure') performance.clearMeasures(entry.name);
        if (entry.entryType === 'mark') performance.clearMarks(entry.name);
      });
  }
};

export const markCacheHydrateStart = (scope: string): void => {
  if (typeof performance === 'undefined') return;
  performance.mark(`${HYDRATE_MARK_PREFIX}:${scope}:start`);
};

export const markCacheHydrateEnd = (scope: string): void => {
  if (typeof performance === 'undefined') return;
  const start = `${HYDRATE_MARK_PREFIX}:${scope}:start`;
  const end = `${HYDRATE_MARK_PREFIX}:${scope}:end`;
  performance.mark(end);
  try {
    performance.measure(`${HYDRATE_MARK_PREFIX}:${scope}`, start, end);
  } catch {
    // Start mark may be absent when hydration was skipped; measurement is
    // best-effort observability only.
  }
};

export const getCacheHydrateMeasures = (): { name: string; duration: number }[] => {
  if (typeof performance === 'undefined') return [];
  return performance
    .getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(HYDRATE_MARK_PREFIX))
    .map((entry) => ({ name: entry.name, duration: entry.duration }));
};

type CacheProbeWindow = Window & {
  __MINDROOM_CACHE_PROBE__?: {
    snapshot: () => CacheProbeCounters;
    reset: () => void;
    hydrateMeasures: () => { name: string; duration: number }[];
  };
};

if (typeof window !== 'undefined') {
  (window as CacheProbeWindow).__MINDROOM_CACHE_PROBE__ = {
    snapshot: getCacheProbeSnapshot,
    reset: resetCacheProbe,
    hydrateMeasures: getCacheHydrateMeasures,
  };
}
