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
  // CINNY-207 AC2 render-gap RG4c (2026-07-04): source-tag + instance-
  // identity classifier at the render-pipeline seam. Team-lead's fourth-
  // shape hypothesis: the render's event-source selection consults the
  // repaired fallback only on the sink-driven merge that arrives with the
  // replacement, and every subsequent re-render (SDK ticks, virtualizer
  // rebuilds, etc.) builds `threadEvents` from the RAW SDK instance
  // (never carrying the replacement — the divergence predates sync). RG4a
  // showed 5 hadReplacement vs 384 lackedReplacement with 0/0 regression:
  // the classifier logic was "did this eventId ever have replacement AND
  // then lose it" — but if only 5 calls EVER hit the repaired fallback
  // instance and the other 384 hit the SDK instance from the start, the
  // regression classifier reads 0 because the "previously had" pass
  // increments arm the tracker on the FALLBACK instance and subsequent
  // SDK-instance calls are then a "different instance regressed" — but
  // even simpler if the tracker was never armed for the id at all (SDK
  // instance is passed on the first call), it lands in "never".
  //
  // Bookkeeping (in getEditedEvent, per-eventId, consulted only on
  // lack-replacement paths — cheap):
  //   - `replaceFallbackInstanceRegistry([[id, mEvent], ...])` is called
  //     by `useThreadRenderState.setSupplementalThreadEvents` for the
  //     merged fallback state (post-hydrate). The registry is the source
  //     of truth for "which MatrixEvent instance the fallback layer
  //     holds for this id, right now".
  //   - On a lack-replacement call in getEditedEvent, we look up the
  //     registry for this id and instance-identity-compare against
  //     `mEvent`.
  //
  // Increment rules (mutually exclusive within a single lack-replacement
  // call, so the invariant
  //   renderTargetLackedReplacement ==
  //     renderTargetSourceNoFallback +
  //     renderTargetSourceFallbackAlsoLacked +
  //     renderTargetSourceSdkFallbackAlsoLacked +
  //     renderTargetSourceSdkFallbackRepaired
  // holds):
  //
  //   renderTargetSourceNoFallback: the fallback registry has no entry
  //     for this event id (`useThreadRenderState.setSupplementalThreadEvents`
  //     never fired for it, e.g. filler events that only exist in the
  //     SDK timeline). Not diagnostic of a render-gap — expected shape
  //     for anything the sink never touched.
  //   renderTargetSourceFallbackAlsoLacked: the fallback registry has
  //     this id, `mEvent === fallbackRegistry.get(id)` (render IS
  //     holding the fallback instance), AND the fallback instance
  //     itself lacks `.replacingEvent()`. Diagnostic: the merge did
  //     prefer the fallback, but the fallback was never repaired — the
  //     bug is upstream (applier ran on some other instance, or the
  //     repair batch never included this id, or hydrateCachedEvents
  //     failed to set the replacement on the fallback instance).
  //   renderTargetSourceSdkFallbackAlsoLacked: the fallback registry has
  //     this id, `mEvent !== fallbackRegistry.get(id)` (render is holding
  //     the SDK instance, merge preferred SDK over fallback), AND the
  //     fallback instance ALSO lacks replacement. The merge preference
  //     is questionable (why choose SDK if identical?), but this is not
  //     the fourth-shape either — the repair never reached the fallback.
  //   renderTargetSourceSdkFallbackRepaired: the fallback registry has
  //     this id, `mEvent !== fallbackRegistry.get(id)`, AND the fallback
  //     instance HAS `.replacingEvent()` set. THIS IS THE FOURTH-SHAPE:
  //     the merge preferred the SDK instance over a repaired fallback
  //     instance — the render layer never sees the repair even though
  //     the sink delivered it correctly. Named-mechanism-decisive: if
  //     this bumps, the real fix is in the merge selection (fallback
  //     with replacement must beat SDK without) or in the applier (the
  //     repair must also reach the SDK instance via
  //     makeReplaced-on-render-held).
  renderTargetSourceNoFallback: number;
  renderTargetSourceFallbackAlsoLacked: number;
  renderTargetSourceSdkFallbackAlsoLacked: number;
  renderTargetSourceSdkFallbackRepaired: number;
  // CINNY-207 AC2 render-gap RG4d (2026-07-04): temporal replacement-cleared
  // detector on the fallback-REGISTERED instance. Team-lead's RG4c review:
  // the fourth-shape (renderTargetSourceSdkFallbackRepaired) came back 0
  // AND renderTargetSourceFallbackAlsoLacked came back 178 (out of 382
  // lack-replacement calls). Read together: on 178 render calls the render
  // WAS holding the fallback's registered instance AND that instance's
  // `.replacingEvent()` was null AT RENDER TIME. But `mergeSawIncomingEditRelation`
  // was >0 (the merge saw the edit event) and `renderTargetHadReplacement`
  // reached 5 (some calls DID see a non-null replacement early), so the
  // replacement was set at some point on the registered instance and then
  // observed null on later calls for the same id and instance identity.
  //
  // The named clearing-mechanism candidate is `MatrixEvent.makeRedacted`
  // (matrix-js-sdk lib/models/event.js line 1040: `this._replacingEvent = null;`).
  // This counter is the decisive tripwire — it distinguishes "the applier
  // never set the replacement on the fallback instance in the first place"
  // (bump renderTargetFallbackNeverHadReplacement per pass) from "the
  // applier set it, and then something on the same instance cleared it"
  // (bump renderTargetLostReplacement). If the LOST counter dominates, the
  // fix must prevent the clear (or reset the replacement afterwards); if
  // NEVER dominates, the fix must reach the fallback instance from the
  // applier in the first place.
  //
  // Bookkeeping (per registered fallback eventId, updated on every
  // getEditedEvent call — cheap, one Map lookup):
  //   - `everHadReplacementOnRegistered`: bit that latches on the first
  //     time we observe `.replacingEvent()` non-null on the CURRENT
  //     registered instance for this id.
  //   - Reset when `replaceFallbackInstanceRegistry` installs a fresh
  //     instance for this id (different identity → the tracker is about a
  //     new instance, prior latch is no longer meaningful).
  //
  // Increment rules (mutually exclusive, both count the same set of
  // lack-replacement calls where render holds the registered fallback
  // instance, so
  //   renderTargetSourceFallbackAlsoLacked ==
  //     renderTargetFallbackNeverHadReplacement +
  //     renderTargetLostReplacement
  // holds and is asserted in tests):
  //   renderTargetFallbackNeverHadReplacement: this call lacks
  //     replacement, render holds the registered fallback instance, AND
  //     we have NEVER observed `.replacingEvent()` non-null on this
  //     registered instance. The applier never reached this instance —
  //     the seam is between hydrateCachedEvents/applier and the fallback
  //     merge, not between fallback and render.
  //   renderTargetLostReplacement: this call lacks replacement, render
  //     holds the registered fallback instance, AND we PREVIOUSLY
  //     observed `.replacingEvent()` non-null on this same registered
  //     instance. The applier reached it, and then something cleared
  //     `_replacingEvent`. Named-mechanism-decisive: on the very next
  //     iteration we hunt WHO calls makeRedacted or otherwise mutates
  //     `_replacingEvent = null` on this instance between sink and
  //     render.
  renderTargetFallbackNeverHadReplacement: number;
  renderTargetLostReplacement: number;
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
  // CINNY-207 AC2 render-gap RG5b (2026-07-04): unconditional applier
  // observability. RG5-fix expanded the fallback registry coverage but
  // renderTargetFallbackNeverHadReplacement stayed high (196), meaning
  // the applier still isn't setting `.replacingEvent()` on the target
  // instance the fallback layer holds. Static trace narrows to three
  // shapes we cannot distinguish without a probe:
  //   X1. applier's noop-guard (`if (!latestEdit || latestEdit ===
  //     replacingEvent) return;`) fires — target already has the same
  //     edit or getLatestEdit chose nothing.
  //   X2. applier's target lookup fires but editEventsByTarget is empty
  //     for that target — the m.replace event was not in the applier's
  //     scan set.
  //   X3. applier's makeReplaced fires, then something OUTSIDE clears
  //     `_replacingEvent`.
  //
  // These two counters together disambiguate:
  //   applierMakeReplacedFired: bumped once per makeReplaced call in
  //     applyCachedReplaceRelations. Regardless of renderHeldEvents.
  //   applierMakeReplacedNoOpGuardFired: bumped when the guard bails
  //     out (target had latestEdit but it was already the current
  //     replacement, or no candidate edit was chosen).
  //
  // Interpretation: if `applierMakeReplacedFired == 0` across a docker
  // run for a target we know is in the fallback registry, X2 is
  // proven (fix goes back into merge/hydrate scope). If > 0 with
  // renderTargetFallbackNeverHadReplacement still high, X3 is
  // proven (hunt what clears `_replacingEvent` post-apply — needs a
  // setter-watch on a specific instance, likely SDK aggregation).
  applierMakeReplacedFired: number;
  applierMakeReplacedNoOpGuardFired: number;
  // CINNY-207 AC2 render-gap RG5b (2026-07-04): split of the noop-guard
  // into its two mutually-exclusive sub-cases. Invariant:
  //   applierMakeReplacedNoOpGuardFired ==
  //     applierMakeReplacedNoLatestEdit +
  //     applierMakeReplacedLatestEqualsCurrent
  //   applierMakeReplacedNoLatestEdit: getLatestEdit returned
  //     undefined. Only happens when every editEvent in the candidate
  //     list has `sender !== target.sender` (see getLatestEdit sender
  //     filter). Diagnostic: the edit-target and its m.replace child
  //     disagree on `sender` after the mapper — likely a hydration
  //     issue or a cross-sender edit path.
  //   applierMakeReplacedLatestEqualsCurrent: the picked latestEdit
  //     equals the target's current `replacingEvent()`. The applier
  //     is a no-op because the target ALREADY has the replacement.
  //     If this dominates while renderTargetFallbackNeverHadReplacement
  //     is also high, X3 (something clears post-apply) is the shape.
  applierMakeReplacedNoLatestEdit: number;
  applierMakeReplacedLatestEqualsCurrent: number;
  // CINNY-207 AC2 render-gap RG4e (2026-07-04): name-the-caller probe on
  // fallback-registered edit-target instances only ("the sunk set"). RG4d
  // proved on 2026-07-04 (see docs/mindroom-cache-overhaul-plan.md AC2
  // scorecard) that `.replacingEvent()` was set on the sunk instance and
  // then observed null on a later render pass for the SAME instance —
  // renderTargetLostReplacement was non-zero. What we don't yet know: who
  // cleared it. Team-lead's prime suspect is matrix-js-sdk's Relations
  // aggregation for m.replace, which calls
  // `targetEvent.makeReplaced(lastReplacement)` on every relation-set
  // recalculation (redaction, timeline insert, decryption tick) and
  // `lastReplacement` can be undefined — our applier sets the replacement
  // manually, so the SDK's live Relations container for that target does
  // NOT contain our repaired edit, and any recalculation resolves to "no
  // replacement" and clears it via makeReplaced(undefined).
  //
  // Mechanism: for each fallback-registered instance whose
  // `.replacingEvent()` is non-null at registration time (i.e. the applier
  // has already sunk a repair into it), install per-instance own-property
  // overrides of `makeRedacted` and `makeReplaced` that bump the counters
  // below BEFORE delegating to the prototype method. Idempotent per
  // instance (a WeakSet prevents double-arming).
  //
  //   sunkTargetMakeRedactedCalls: prototype `makeRedacted` was invoked
  //     on a sunk instance. makeRedacted also nulls `_replacingEvent`
  //     (matrix-js-sdk lib/models/event.js line 1040) — so a non-zero
  //     reading names redaction as ONE clearing path. If zero, redaction
  //     is not the mechanism.
  //   sunkTargetMakeReplacedNonNull: `makeReplaced(x)` was called with a
  //     non-null argument. Diagnostic for benign flow — e.g. the SDK is
  //     aggregating a fresh replacement it knows about, or our applier
  //     itself re-fires. Does NOT explain a clear.
  //   sunkTargetMakeReplacedCleared: `makeReplaced(nullish)` was called.
  //     This is team-lead's prime suspect: the SDK's Relations
  //     aggregation running on a target whose live Relations index has
  //     no replacement, resolving to `lastReplacement === undefined` and
  //     clearing our manually-set replacement. If this bumps while
  //     renderTargetLostReplacement is also non-zero, the mechanism is
  //     PROVEN — the fix direction is then non-bandage: the repaired
  //     edit must enter the SDK's relations aggregation (or the render
  //     must not depend on `_replacingEvent` for repaired-fallback
  //     instances), not "re-apply after clearing".
  //
  // The existing `renderTargetLostReplacement` counter (RG4d, above) is
  // the catch-all in case something writes `_replacingEvent` directly
  // without going through either method. If lost > 0 but all three
  // sunkTarget counters are 0, the mechanism is a direct field write.
  sunkTargetMakeRedactedCalls: number;
  sunkTargetMakeReplacedNonNull: number;
  sunkTargetMakeReplacedCleared: number;
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
  renderTargetSourceNoFallback: 0,
  renderTargetSourceFallbackAlsoLacked: 0,
  renderTargetSourceSdkFallbackAlsoLacked: 0,
  renderTargetSourceSdkFallbackRepaired: 0,
  renderTargetFallbackNeverHadReplacement: 0,
  renderTargetLostReplacement: 0,
  hydrateApplierMutatedRenderHeldInstance: 0,
  hydrateApplierMutatedFreshInstance: 0,
  applierMakeReplacedFired: 0,
  applierMakeReplacedNoOpGuardFired: 0,
  applierMakeReplacedNoLatestEdit: 0,
  applierMakeReplacedLatestEqualsCurrent: 0,
  sunkTargetMakeRedactedCalls: 0,
  sunkTargetMakeReplacedNonNull: 0,
  sunkTargetMakeReplacedCleared: 0,
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

// CINNY-207 AC2 render-gap RG4c (2026-07-04): fallback-instance registry
// for the source-tag + instance-identity classifier. Populated by
// `useThreadRenderState.setSupplementalThreadEvents` for every event in
// the merged fallback state (post-hydrate). Consulted by
// `recordRenderTargetSource` on lack-replacement calls in getEditedEvent.
//
// Strong refs: identical rationale to `renderTargetSeenById` above —
// diagnostic-only, render/fallback layers retain these events for their
// render lifetime anyway, and strong refs avoid GC ambiguity in the
// identity comparison. Cleared on resetCacheProbe.
//
// Duck-typed: we only need `.replacingEvent()` presence; not importing
// MatrixEvent keeps cacheProbe decoupled from the SDK type surface.
type FallbackTargetProbe = {
  replacingEvent?: () => unknown | null | undefined;
};
type FallbackRegistryEntry = {
  instance: FallbackTargetProbe;
  // CINNY-207 AC2 render-gap RG4d (2026-07-04): latch bit for the temporal
  // lost-replacement detector. Set to `true` the first time we observe
  // `.replacingEvent()` non-null on THIS instance in `recordRenderTargetSource`.
  // Reset (via `replaceFallbackInstanceRegistry`) when a fresh instance is
  // registered for this id — the bit is per-instance, not per-id.
  everHadReplacement: boolean;
};
const fallbackInstanceById = new Map<string, FallbackRegistryEntry>();

// Called from `useThreadRenderState.setSupplementalThreadEvents` after
// the merged batch is produced. Replaces the registry contents with the
// current fallback set — an id present in the previous set but not the
// new set is intentionally dropped so a subsequent lack-replacement call
// classifies as `renderTargetSourceNoFallback` (which is truthful:
// the fallback layer no longer holds that id).
//
// RG4d: for ids whose instance identity is unchanged across the replace,
// carry the `everHadReplacement` latch forward; only reset when the
// instance itself changes (identity swap).
export const replaceFallbackInstanceRegistry = (
  entries: ReadonlyArray<readonly [string, FallbackTargetProbe]>
): void => {
  const nextRegistry = new Map<string, FallbackRegistryEntry>();
  entries.forEach(([eventId, mEvent]) => {
    const prev = fallbackInstanceById.get(eventId);
    if (prev && prev.instance === mEvent) {
      nextRegistry.set(eventId, prev);
    } else {
      nextRegistry.set(eventId, { instance: mEvent, everHadReplacement: false });
    }
  });
  fallbackInstanceById.clear();
  nextRegistry.forEach((entry, eventId) => fallbackInstanceById.set(eventId, entry));
};

// Exported for use by the render-pipeline seam (utils/room.ts). Called
// once per getEditedEvent lack-replacement pass to classify the source
// of the render-held instance.
//
// RG4d: as a side effect, updates the fallback registry entry's
// `everHadReplacement` latch when we observe `.replacingEvent()` non-null
// on the registered instance (regardless of whether render is holding it
// or an SDK sibling — the latch is about the fallback INSTANCE's history,
// not about which instance the render just picked). On the same-instance
// lack-replacement path, the latch state decides never-had vs lost.
export const recordRenderTargetSource = (eventId: string, mEvent: object): void => {
  const fallback = fallbackInstanceById.get(eventId);
  if (!fallback) {
    countCacheProbe('renderTargetSourceNoFallback');
    return;
  }
  const fallbackHasReplacement = !!fallback.instance.replacingEvent?.();
  if (fallbackHasReplacement && !fallback.everHadReplacement) {
    // Latch the positive observation for future lack-replacement passes.
    fallback.everHadReplacement = true;
  }
  if ((fallback.instance as unknown as object) === mEvent) {
    // Render is holding the fallback instance itself.
    countCacheProbe('renderTargetSourceFallbackAlsoLacked');
    // RG4d split: on the same-instance-also-lacked path, the latch
    // decides never-had vs lost. Invariant across a docker run:
    //   renderTargetSourceFallbackAlsoLacked ==
    //     renderTargetFallbackNeverHadReplacement +
    //     renderTargetLostReplacement
    // The rare "contradiction" case (`fallbackHasReplacement && mEvent
    // === fallback.instance` — outer caller said `.replacingEvent()`
    // was null but the registry's identical instance now says non-null,
    // implying an intra-call flip) is treated as "lost" because the
    // latch was just armed above; that's honest for the invariant.
    if (fallback.everHadReplacement) {
      countCacheProbe('renderTargetLostReplacement');
    } else {
      countCacheProbe('renderTargetFallbackNeverHadReplacement');
    }
    return;
  }
  // Render is holding a DIFFERENT instance than the fallback registry's
  // (typically the SDK's own copy that survived the merge preference).
  if (fallbackHasReplacement) {
    countCacheProbe('renderTargetSourceSdkFallbackRepaired');
  } else {
    countCacheProbe('renderTargetSourceSdkFallbackAlsoLacked');
  }
};

// CINNY-207 AC2 render-gap RG4e (2026-07-04): name-the-caller instance-
// level overrides on fallback-registered edit-target instances (the sunk
// set). See CacheProbeCounters block above for full mechanism and
// interpretation notes.
//
// Contract:
//   - Caller decides which instances qualify as "sunk" (has a repaired
//     replacement now). Typical call site: `replaceFallbackInstanceRegistry`
//     iterates its entries and, for each whose `.replacingEvent()` is
//     non-null right now, calls `armSunkTargetInstrumentation(eventId,
//     mEvent)`.
//   - Idempotent per instance. A module-level WeakSet holds every
//     instance already armed so re-registration of the same instance is
//     a no-op — we don't stack overrides or re-install identical own
//     properties.
//   - Diagnostic-only: does not change semantics. The overrides delegate
//     to the prototype method with the same `this` and arguments; the
//     counter bump happens BEFORE delegation so a throwing prototype
//     method still leaves an accurate call record. Return value of the
//     prototype method (undefined for both `makeRedacted` and
//     `makeReplaced` on current matrix-js-sdk) is forwarded verbatim.
//   - No `try/catch` swallowing: per no-defensive-bandages rule, if the
//     prototype method throws, the exception propagates unchanged to the
//     original caller.
//
// Duck-typed on the SDK surface — we only need callable
// `makeRedacted`/`makeReplaced` and a prototype chain to look them up.
// This keeps cacheProbe decoupled from the SDK type surface and side-
// steps a circular import (cacheProbe is imported by callers all over
// the render pipeline; importing MatrixEvent here would drag the SDK
// into every one of them via chained resolution).
type SunkTargetProbe = {
  makeRedacted?: (...args: unknown[]) => unknown;
  makeReplaced?: (arg?: unknown, ...rest: unknown[]) => unknown;
};

// Symbol used to store the ORIGINAL prototype method reference on the
// instance's own property alongside the override, so we don't rebind or
// re-look-up on every call. Also used as the "armed" marker via a
// property presence check when the WeakSet is undefined-tolerant.
const ARMED_MARKER = Symbol('mindroom:sunk-target-armed');

// WeakSet so armed instances don't retain lifetime beyond what the
// render/fallback layer holds. If GC reclaims the instance, our record
// vanishes too — that's honest for a diagnostic probe.
const armedInstances = new WeakSet<object>();

export const armSunkTargetInstrumentation = (
  eventId: string,
  mEvent: SunkTargetProbe
): void => {
  if (typeof eventId !== 'string' || eventId.length === 0) return;
  if (!mEvent || typeof mEvent !== 'object') return;
  if (armedInstances.has(mEvent)) return;

  // Look up the prototype methods once. If the SDK shape ever drops
  // one of these, we skip that override cleanly (no throw, and the
  // counter for that method simply stays 0 — signaling absence).
  const proto = Object.getPrototypeOf(mEvent) as SunkTargetProbe | null;
  const protoMakeRedacted = proto?.makeRedacted;
  const protoMakeReplaced = proto?.makeReplaced;

  if (typeof protoMakeRedacted === 'function') {
    // Own-property override delegating to the prototype.
    Object.defineProperty(mEvent, 'makeRedacted', {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function makeRedactedOverride(this: object, ...args: unknown[]): unknown {
        countCacheProbe('sunkTargetMakeRedactedCalls');
        return protoMakeRedacted.apply(this, args);
      },
    });
  }

  if (typeof protoMakeReplaced === 'function') {
    Object.defineProperty(mEvent, 'makeReplaced', {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function makeReplacedOverride(
        this: object,
        arg?: unknown,
        ...rest: unknown[]
      ): unknown {
        // Team-lead's prime-suspect classification: any nullish argument
        // is a "cleared" call. matrix-js-sdk's Relations aggregation
        // resolves `lastReplacement` to undefined when the SDK's live
        // Relations container has no replacement — that's the exact
        // shape we're hunting.
        if (arg === null || arg === undefined) {
          countCacheProbe('sunkTargetMakeReplacedCleared');
        } else {
          countCacheProbe('sunkTargetMakeReplacedNonNull');
        }
        return protoMakeReplaced.apply(this, [arg, ...rest]);
      },
    });
  }

  // Mark the instance so subsequent registrations skip re-arming, even
  // if defineProperty above did nothing (e.g. missing prototype
  // method). Also stash the marker as an own property purely for
  // debuggability (a devtools inspect on the instance shows it's armed).
  armedInstances.add(mEvent);
  Object.defineProperty(mEvent as object, ARMED_MARKER, {
    configurable: true,
    writable: false,
    enumerable: false,
    value: eventId,
  });
};

export const resetCacheProbe = (): void => {
  counters = createEmptyCounters();
  renderTargetSeenById.clear();
  fallbackInstanceById.clear();
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
