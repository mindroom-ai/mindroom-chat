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
});

let counters = createEmptyCounters();

const HYDRATE_MARK_PREFIX = 'mindroom:cache-hydrate';

export const countCacheProbe = (key: keyof CacheProbeCounters, amount = 1): void => {
  counters[key] += amount;
};

export const getCacheProbeSnapshot = (): CacheProbeCounters => ({ ...counters });

export const resetCacheProbe = (): void => {
  counters = createEmptyCounters();
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
