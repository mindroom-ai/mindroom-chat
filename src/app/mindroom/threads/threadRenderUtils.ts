import { MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { getSerializedReplacementEvent, isSameSenderEditEvent } from '../../utils/editEvent';
import { getLatestEdit, reactionOrEditEvent } from '../../utils/room';
import { inSameDay } from '../../utils/time';
import { countCacheProbe } from './cacheProbe';

export type ThreadInitialRenderMode = 'loading' | 'cached' | 'live';
export type ThreadRenderEventEntry<TEvent extends MatrixEvent = MatrixEvent> = {
  event: TEvent;
  absoluteIndex: number;
};
type ThreadOpenBottomPinOpts = {
  suppressOpenBottomPin?: boolean;
  threadId?: string;
  threadLatestOpenPending: boolean;
  threadInitialRenderMode: ThreadInitialRenderMode;
  threadEventCount: number;
};

export const getThreadInitialRenderMode = ({
  threadId,
  initialCacheHydrated,
  fallbackEventCount,
}: {
  threadId?: string;
  initialCacheHydrated: boolean;
  fallbackEventCount: number;
}): ThreadInitialRenderMode => {
  if (!threadId) return 'live';
  if (initialCacheHydrated) return 'live';
  return fallbackEventCount > 0 ? 'cached' : 'loading';
};

export const shouldPinThreadToBottomOnOpen = ({
  suppressOpenBottomPin,
  threadId,
  threadLatestOpenPending,
  threadInitialRenderMode,
  threadEventCount,
}: ThreadOpenBottomPinOpts): boolean =>
  !!threadId &&
  !suppressOpenBottomPin &&
  threadLatestOpenPending &&
  threadInitialRenderMode !== 'loading' &&
  threadEventCount > 0;

type ThreadAutoPaginateBackOpts = {
  threadId?: string;
  // Index of the FIRST virtual row currently rendered (top of the
  // overscan window). undefined when nothing is rendered yet.
  firstRenderedIndex: number | undefined;
  // Single-flight: a back-pagination is already in progress.
  paginatingBack: boolean;
  // Same condition that shows the "Load Older Messages" chip — older
  // content exists in cache or on the server.
  showLoadOlder: boolean;
  // A real user scroll gesture (wheel/touch/keyboard) has happened in
  // this thread view. Auto-pagination is a RESPONSE to the user
  // scrolling toward the edge; without a gesture, a low rendered
  // index is an open-time artifact (the virtualizer transiently
  // renders from index 0 before the pin-to-bottom lands) and must not
  // fire. Deliberately NOT the open-lifecycle pending flag: that flag
  // stays true until the whole open-time backfill chain completes,
  // which on slow networks spans the entire loading phase — exactly
  // when a scrolling user needs the trigger live (task #125).
  hasUserScrollIntent: boolean;
  triggerRows: number;
};

// Scroll-driven thread back-pagination predicate (task #125). Pure so
// the trigger condition is unit-testable apart from the effect wiring.
// Fires when the rendered window's top edge is within `triggerRows` of
// the loaded content's start — early enough that the cache-first
// pagination pipeline (IDB read, then network fallback) completes
// before momentum scrolling reaches the edge. Re-firing after a
// completed pagination is naturally throttled: the prepend anchor
// restore pushes firstRenderedIndex back up by the prepended count, so
// the predicate only becomes true again when the user scrolls further
// up (or the remaining history is shorter than the headroom, in which
// case it drains the tail — bounded by showLoadOlder flipping false).
export const shouldAutoPaginateThreadBack = ({
  threadId,
  firstRenderedIndex,
  paginatingBack,
  showLoadOlder,
  hasUserScrollIntent,
  triggerRows,
}: ThreadAutoPaginateBackOpts): boolean =>
  !!threadId &&
  !paginatingBack &&
  hasUserScrollIntent &&
  showLoadOlder &&
  firstRenderedIndex !== undefined &&
  firstRenderedIndex <= triggerRows;

type MeasurementScrollAdjustmentSuppressOpts = {
  threadId?: string;
  // virtual-core passes a numeric `adjustments` to scrollToFn ONLY for
  // measurement-correction writes (resizeItem anchoring the viewport over
  // an estimate error); every intentional scroll — open-time pin/settle,
  // scroll-to-index, mount sync — passes undefined and must never be
  // suppressed.
  isMeasurementAdjustment: boolean;
  // A real user gesture has happened in this thread view. The open-time
  // pin/settle performs programmatic scrolls that fire scroll events;
  // suppression must not engage before the user takes over, or the settle
  // would land on uncorrected offsets.
  userScrolled: boolean;
  msSinceLastScrollActivity: number;
  hasActiveTouch: boolean;
  idleMs: number;
};

// Task #128 follow-up: gate for suppressing the virtualizer's
// measurement-correction scrollTop write while the scroll is LIVE. The
// write is what iOS answers by killing flick momentum; the measurement
// itself always proceeds (heights stay real — no white gaps), and the
// skipped anchoring self-heals on the next scroll event when virtual-core
// re-syncs scrollOffset from the element and zeroes scrollAdjustments.
export const shouldSuppressMeasurementScrollAdjustment = ({
  threadId,
  isMeasurementAdjustment,
  userScrolled,
  msSinceLastScrollActivity,
  hasActiveTouch,
  idleMs,
}: MeasurementScrollAdjustmentSuppressOpts): boolean =>
  isMeasurementAdjustment &&
  !!threadId &&
  userScrolled &&
  (hasActiveTouch || msSinceLastScrollActivity < idleMs);

export const isThreadOnlyRoomActivity = (room: Room, mEvt: MatrixEvent): boolean => {
  const mEventId = mEvt.getId();
  const relationTargetId = mEvt.getRelation()?.event_id;
  const relatedEvent = relationTargetId ? room.findEventById(relationTargetId) : undefined;
  const relatedEventId = relatedEvent?.getId();
  const isThreadReplyMessage = !!mEventId && !!mEvt.threadRootId && mEvt.threadRootId !== mEventId;
  const isThreadReplyRelatedEvent =
    !!relatedEventId &&
    !!relatedEvent?.threadRootId &&
    relatedEvent.threadRootId !== relatedEventId;
  return isThreadReplyMessage || isThreadReplyRelatedEvent;
};

export const buildResolveConfirmedEventId = (
  room: Room,
  events?: MatrixEvent[]
): ((txnId: string) => string | undefined) => {
  let fallbackMap: Map<string, string> | undefined;
  const getFallbackMap = (): Map<string, string> => {
    if (!fallbackMap) {
      fallbackMap = new Map();
      if (events) {
        for (const mEvent of events) {
          const txnId = mEvent.getTxnId?.() ?? mEvent.getUnsigned()?.transaction_id;
          const eventId = mEvent.getId();
          if (
            typeof txnId === 'string' &&
            txnId.length > 0 &&
            typeof eventId === 'string' &&
            !eventId.startsWith('~')
          ) {
            fallbackMap.set(txnId, eventId);
          }
        }
      }
    }
    return fallbackMap;
  };

  return (txnId: string): string | undefined => {
    const event = room.getEventForTxnId?.(txnId);
    if (event) {
      const confirmedId = event.getId();
      if (typeof confirmedId === 'string' && !confirmedId.startsWith('~')) {
        return confirmedId;
      }
    }
    return getFallbackMap().get(txnId);
  };
};

const getThreadRenderEventId = (mEvent: MatrixEvent): string | undefined => {
  const eventId = mEvent.getId();
  return typeof eventId === 'string' && eventId.length > 0 ? eventId : undefined;
};

const getThreadRenderTransactionId = (mEvent: MatrixEvent): string | undefined => {
  const txnId = mEvent.getTxnId?.() ?? mEvent.getUnsigned()?.transaction_id;
  return typeof txnId === 'string' && txnId.length > 0 ? txnId : undefined;
};

const getThreadRenderEventKeys = (
  mEvent: MatrixEvent,
  resolveConfirmedId?: (txnId: string) => string | undefined
): string[] => {
  const keys: string[] = [];

  const eventId = getThreadRenderEventId(mEvent);
  if (eventId) keys.push(`event:${eventId}`);

  const txnId = getThreadRenderTransactionId(mEvent);
  if (txnId) {
    keys.push(`txn:${txnId}`);

    if (resolveConfirmedId && isLocalEchoEvent(mEvent)) {
      const confirmedId = resolveConfirmedId(txnId);
      if (confirmedId && confirmedId !== eventId) {
        keys.push(`event:${confirmedId}`);
      }
    }
  }

  return keys;
};

export const getThreadRenderEventKey = (mEvent: MatrixEvent): string | undefined =>
  getThreadRenderEventKeys(mEvent)[0];

const isLocalEchoEvent = (mEvent: MatrixEvent): boolean => {
  const eventId = getThreadRenderEventId(mEvent);
  if (eventId?.startsWith('~')) return true;
  return mEvent.isSending();
};

const getEffectiveReplacementEvent = (mEvent: MatrixEvent): MatrixEvent | undefined => {
  const replacingEvent = mEvent.replacingEvent() ?? undefined;
  const serializedReplacement = getSerializedReplacementEvent(mEvent);

  return getLatestEdit(
    mEvent,
    [replacingEvent, serializedReplacement].filter((editEvent): editEvent is MatrixEvent =>
      isSameSenderEditEvent(mEvent, editEvent)
    )
  );
};

export const pickPreferredThreadRenderEvent = (
  existingEvent: MatrixEvent,
  incomingEvent: MatrixEvent,
  resolveConfirmedId?: (txnId: string) => string | undefined
): MatrixEvent => {
  if (existingEvent === incomingEvent) return existingEvent;

  const existingKeys = new Set(getThreadRenderEventKeys(existingEvent, resolveConfirmedId));
  const incomingKeys = getThreadRenderEventKeys(incomingEvent, resolveConfirmedId);
  if (incomingKeys.some((key) => existingKeys.has(key))) {
    const existingLocalEcho = isLocalEchoEvent(existingEvent);
    const incomingLocalEcho = isLocalEchoEvent(incomingEvent);
    if (existingLocalEcho !== incomingLocalEcho) {
      return existingLocalEcho ? incomingEvent : existingEvent;
    }
  }

  if (existingEvent.isRedacted() && !incomingEvent.isRedacted()) return existingEvent;
  if (!existingEvent.isRedacted() && incomingEvent.isRedacted()) return incomingEvent;

  const existingReplacement = getEffectiveReplacementEvent(existingEvent);
  const incomingReplacement = getEffectiveReplacementEvent(incomingEvent);
  if (existingReplacement || incomingReplacement) {
    const preferredReplacement = getLatestEdit(
      existingEvent,
      [existingReplacement, incomingReplacement].filter(
        (replacement): replacement is MatrixEvent => !!replacement
      )
    );
    if (
      preferredReplacement === existingReplacement &&
      preferredReplacement !== incomingReplacement
    ) {
      return existingEvent;
    }
    if (
      preferredReplacement === incomingReplacement &&
      preferredReplacement !== existingReplacement
    ) {
      return incomingEvent;
    }
  }

  // CINNY-207 AC2 render-gap RG5-fix2 (2026-07-04): structural monotonic
  // preference on the RAW `.replacingEvent()` field, consulted AFTER
  // the effective-replacement block above so it does not disturb the
  // D12-style ts→event_id ordering that block enforces when both sides
  // have an effective replacement. Encodes "repaired state is monotonic
  // within a thread-open" — a non-repaired same-id instance cannot
  // displace a repaired one, whether the repair is same-sender-visible
  // (handled by the effective block) or raw-only (handled here).
  //
  // Threat this closes: `handleThreadNewReply` fires AFTER a reconcile
  // repair with the SYNC-delivered instance for the same target id;
  // that instance lacks any replacement. If the repaired instance's
  // `.replacingEvent()` returns non-null but
  // `getEffectiveReplacementEvent` drops it (e.g. `isSameSenderEditEvent`
  // filter fails on a foreign-sender edit, or the raw replacement is
  // one the helper rejects on shape), the block above cannot fire and
  // the picker previously fell through to `return incomingEvent` —
  // silently wiping the repair through a different door than the one
  // RG5's onRepaired hydrated-view fix closed.
  //
  // Symmetric asymmetric check: if exactly one side has ANY raw
  // replacement while the other has none, prefer the one that does.
  // If both have raw replacements the effective helper rejected, we
  // fall through to the final incoming-wins tie-break — both sides
  // are equally "questionable" by the helper's rules; picking either
  // is defensible and matches pre-fix behavior for this shape.
  //
  // One rule, two seams: this picker is used by both `mergeThreadRenderEvents`
  // (sink merge post-`setSupplementalThreadEvents`) and — transitively —
  // by `buildThreadEvents`' final merge that combines SDK
  // `thread.events` and fallback state. The same monotonicity rule
  // therefore holds at both seams without duplicating logic.
  const existingHasRawReplacement = !!existingEvent.replacingEvent();
  const incomingHasRawReplacement = !!incomingEvent.replacingEvent();
  if (existingHasRawReplacement && !incomingHasRawReplacement) return existingEvent;
  if (!existingHasRawReplacement && incomingHasRawReplacement) return incomingEvent;

  return incomingEvent;
};

export const mergeThreadRenderEvents = (
  existingEvents: MatrixEvent[],
  incomingEvents: MatrixEvent[],
  resolveConfirmedId?: (txnId: string) => string | undefined
): MatrixEvent[] => {
  const eventMap = new Map<string, MatrixEvent>();
  // Reverse index: every key an instance currently holds in `eventMap`.
  // Maintained on every write so loser-key reclamation is O(keys) per
  // loser instead of a full-map scan (PR #73 review). The index tracks
  // HELD keys explicitly, so it stays correct even when an instance's
  // derivable keys change under it (local echoes mutate their event id
  // in place on confirmation). Both maps are function-local and die
  // with this call — no retention hazard.
  const keysByInstance = new Map<MatrixEvent, Set<string>>();

  const indexedSet = (key: string, mEvent: MatrixEvent) => {
    const previous = eventMap.get(key);
    if (previous === mEvent) return;
    if (previous) keysByInstance.get(previous)?.delete(key);
    eventMap.set(key, mEvent);
    let heldKeys = keysByInstance.get(mEvent);
    if (!heldKeys) {
      heldKeys = new Set<string>();
      keysByInstance.set(mEvent, heldKeys);
    }
    heldKeys.add(key);
  };

  // CINNY-207 AC2 render-gap RG5d (2026-07-04): canonicalize on write.
  //
  // The prior `setEventForKeys` was a plain multi-set: it wrote the new
  // event under each of its keys without touching entries for other keys
  // any conflicting instance already held. That left orphan entries when
  // two instances of the same event identity arrived with only partially
  // overlapping key sets (e.g. a bare-txnId sending echo alongside an
  // eventId-only confirmed instance whose key sets happen not to overlap
  // because the SDK dropped the txnId from the confirmed instance's
  // unsigned payload). `Array.from(new Set(eventMap.values()))` at the
  // tail would then contain both instances — one identity, two
  // MatrixEvent references — and every downstream consumer (the applier,
  // the fallback-instance registry, `mergedById` diagnostics, and any
  // other reader iterating values) inherited the same hazard.
  //
  // The fix is a map invariant, not a post-pass rescue: any write for a
  // key set collects EVERY existing instance reachable through ANY key
  // (both the incoming keys and every key each conflict currently
  // occupies in the map), picks a single winner via
  // `pickPreferredThreadRenderEvent` (chained across 3+ conflicts), and
  // installs the winner under the full union of keys after fully
  // deleting each loser's entries. Post-canonicalization the map
  // invariant is: for any two keys K1, K2 that share an event identity,
  // `eventMap.get(K1) === eventMap.get(K2)`. `values()` therefore
  // contains one entry per identity, always.
  //
  // Observability: `eventMapCanonicalizedDisplacements` bumps once per
  // losing instance the canonicalizer had to displace. It is a WORK
  // counter, not a must-stay-0 tripwire — multiple ingestion paths
  // legitimately deliver distinct instances of one identity
  // (onRepaired payloads, sync/echo deliveries), so a stable small
  // non-zero reading is healthy dedup work (3 per AC2 live run). A
  // step-change in the reading names a new duplication source. See
  // cacheProbe.ts for the interpretation block.
  // A key collision only implies the SAME event identity when the two
  // instances can actually be the same event: equal event ids, a
  // missing id on either side (txn key is the only identity), or a
  // local echo awaiting its confirmed id. Two CONFIRMED events with
  // different real ids that happen to share a `txn:` key (server
  // misbehavior or cross-device coincidence) are distinct events —
  // treating them as one identity would silently drop a real thread
  // message from the render (greptile P2 on PR #73).
  const isSameEventIdentity = (a: MatrixEvent, b: MatrixEvent): boolean => {
    const aId = getThreadRenderEventId(a);
    const bId = getThreadRenderEventId(b);
    if (!aId || !bId) return true;
    if (aId === bId) return true;
    const aEcho = isLocalEchoEvent(a);
    const bEcho = isLocalEchoEvent(b);
    if (!aEcho && !bEcho) return false;
    if (aEcho && bEcho) {
      // Two echoes with different provisional ids sharing a txn key:
      // duplicate sends of one transaction — same identity.
      return true;
    }
    // Echo-vs-confirmed across a shared txn key is the confirmation
    // bridge ONLY when the echo's resolved confirmed id matches the
    // confirmed side (or is not yet known — a same-txn confirmed
    // arrival is then the confirmation by definition). If the echo
    // already resolves to a DIFFERENT confirmed id, the pair are two
    // distinct events that merely share a txn key (greptile P1 on
    // PR #73) and must not collapse.
    const echo = aEcho ? a : b;
    const confirmedSideId = aEcho ? bId : aId;
    const txnId = getThreadRenderTransactionId(echo);
    const resolvedId = txnId ? resolveConfirmedId?.(txnId) : undefined;
    return resolvedId === undefined || resolvedId === confirmedSideId;
  };

  const setEventForKeys = (keys: string[], mEvent: MatrixEvent) => {
    if (keys.length === 0) return;

    // Collect every distinct existing instance the incoming write
    // conflicts with via any of its keys — but only same-identity
    // instances participate in displacement. A distinct-identity
    // instance sharing a key keeps its other entries; the contested
    // key goes to the incoming write (plain last-write semantics for
    // cross-identity key collisions).
    const conflicts = new Set<MatrixEvent>();
    keys.forEach((key) => {
      const existing = eventMap.get(key);
      if (existing && existing !== mEvent && isSameEventIdentity(existing, mEvent)) {
        conflicts.add(existing);
      }
    });

    if (conflicts.size === 0) {
      // Fast path — no conflict. Plain multi-set.
      keys.forEach((key) => indexedSet(key, mEvent));
      return;
    }

    // Reduce (conflicts + incoming) through the picker to a single
    // winner. The picker's contract is `(existing, incoming)` with
    // incoming winning ties. To preserve the pre-canonicalization
    // semantics ("last write with the same key wins ties"), fold with
    // the conflict as the `existing` argument and the winner-so-far as
    // the `incoming` argument — so the final incoming `mEvent` retains
    // tie-break priority over prior conflicts, matching the prior
    // `existingEvents → incomingEvents` iteration order. The fold is
    // order-SENSITIVE but fully deterministic: `conflicts` is a Set,
    // and Set iteration is insertion order, which is the caller's key
    // order — the same inputs always produce the same winner.
    // (>1 same-identity conflict additionally requires a key set that
    // bridges two previously-separate entries, which the identity
    // check above bounds to local-echo confirmation shapes.)
    let winner = mEvent;
    conflicts.forEach((conflict) => {
      winner = pickPreferredThreadRenderEvent(conflict, winner, resolveConfirmedId);
    });

    // Every non-winner instance among (conflicts ∪ {mEvent}) is a
    // loser and must be fully displaced.
    const losers = new Set<MatrixEvent>();
    conflicts.forEach((c) => {
      if (c !== winner) losers.add(c);
    });
    if (winner !== mEvent) losers.add(mEvent);

    // Reclaim every key any loser currently occupies BEFORE deleting,
    // so the winner inherits them. The reverse index gives the HELD
    // key set per loser directly — a loser's current map keys are not
    // derivable from the instance (local echoes mutate their event id
    // in place on confirmation, stranding entries under keys
    // `getThreadRenderEventKeys` no longer returns), which is why the
    // index tracks writes rather than recomputing keys.
    const unionKeys = new Set<string>(keys);
    getThreadRenderEventKeys(winner, resolveConfirmedId).forEach((k) => unionKeys.add(k));
    if (losers.size > 0) {
      losers.forEach((loser) => {
        keysByInstance.get(loser)?.forEach((key) => {
          unionKeys.add(key);
          eventMap.delete(key);
        });
        keysByInstance.delete(loser);
      });
      losers.forEach(() => countCacheProbe('eventMapCanonicalizedDisplacements'));
      // CINNY-207 AC2 render-gap RG5c (re-homed post-F1): permanent
      // must-stay-0 tripwire on the picker rule. Bumps if any loser
      // carried `.replacingEvent()` non-null while the chosen winner
      // has `.replacingEvent()` null — the "repaired state is
      // monotonic across a same-id tie" preference
      // (`pickPreferredThreadRenderEvent`'s RG5-fix2 raw-presence
      // rule) is violated at the map layer. The picker's contract
      // makes this shape unreachable in the current tree; any
      // non-zero reading names a real regression.
      if (winner.replacingEvent() == null) {
        let anyLoserRepaired = false;
        losers.forEach((loser) => {
          if (!anyLoserRepaired && loser.replacingEvent() != null) {
            anyLoserRepaired = true;
          }
        });
        if (anyLoserRepaired) {
          countCacheProbe('registrySwappedRepairedForUnrepaired');
        }
      }
    }

    unionKeys.forEach((key) => indexedSet(key, winner));
  };

  existingEvents.forEach((mEvent) => {
    const keys = getThreadRenderEventKeys(mEvent, resolveConfirmedId);
    if (keys.length === 0) return;
    setEventForKeys(keys, mEvent);
  });

  // CINNY-207 AC2 render-gap RG1 (2026-07-04) — F9 fold (2026-07-04):
  // observability for "incoming batch carried at least one m.replace"
  // (`mergeSawIncomingEditRelation`) is folded into the incoming loop
  // as a boolean flip — no extra iteration. Bumped once per merge call
  // if any incoming event had a Replace relation.
  let incomingHadEditRelation = false;
  incomingEvents.forEach((mEvent) => {
    const incomingKeys = getThreadRenderEventKeys(mEvent, resolveConfirmedId);
    if (incomingKeys.length === 0) return;

    if (mEvent.getRelation()?.rel_type === RelationType.Replace) {
      incomingHadEditRelation = true;
    }

    // setEventForKeys handles the pick + displacement internally; the
    // caller just provides the new event and its keys. This is the
    // canonicalization seam (RG5d); see setEventForKeys comment block.
    setEventForKeys(incomingKeys, mEvent);
  });
  if (incomingHadEditRelation) {
    countCacheProbe('mergeSawIncomingEditRelation');
  }

  const merged = Array.from(new Set(eventMap.values())).sort((a, b) => {
    const tsDiff = a.getTs() - b.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (a.getId() ?? '').localeCompare(b.getId() ?? '');
  });

  // CINNY-207 AC2 render-gap RG1 (2026-07-04): observability at the
  // merge seam — bumps once per incoming m.replace whose target IS
  // present in the merged output but has NO `replacingEvent()` set.
  // That shape names "the applier ran (or was expected to run) upstream,
  // but the instance the merge kept for the target does not carry the
  // repaired replacement" — a merge-preference regression.
  //
  // F9 fold (2026-07-04): query `eventMap` directly by the target's
  // event key instead of building a fresh `Map<id, MatrixEvent>` from
  // the sorted output. Post-RG5d canonicalization the map already
  // holds exactly one instance per identity reachable under the
  // `event:${id}` key, so the lookup is O(1) with no per-call
  // allocation. Guarded on incomingHadEditRelation so the whole block
  // is skipped when the incoming batch has no edit relations.
  if (incomingHadEditRelation) {
    incomingEvents.forEach((mEvent) => {
      const relation = mEvent.getRelation();
      if (relation?.rel_type !== RelationType.Replace) return;
      const targetEventId = relation.event_id;
      if (!targetEventId) return;
      const target = eventMap.get(`event:${targetEventId}`);
      if (!target) return;
      if (!target.replacingEvent()) {
        countCacheProbe('mergeSawEditRelationNoTargetChange');
      }
    });
  }

  return merged;
};

export const dedupeThreadRenderEventEntries = <
  TEvent extends MatrixEvent,
  TEntry extends ThreadRenderEventEntry<TEvent>
>(
  entries: TEntry[],
  resolveConfirmedId?: (txnId: string) => string | undefined
): TEntry[] => {
  const dedupedEntries: TEntry[] = [];
  const keyToEntryIndex = new Map<string, number>();

  entries.forEach((entry) => {
    const entryKeys = getThreadRenderEventKeys(entry.event, resolveConfirmedId);
    if (entryKeys.length === 0) {
      dedupedEntries.push(entry);
      return;
    }

    const existingEntryIndex = entryKeys
      .map((key) => keyToEntryIndex.get(key))
      .find((index): index is number => index !== undefined);

    if (existingEntryIndex === undefined) {
      const nextIndex = dedupedEntries.push(entry) - 1;
      entryKeys.forEach((key) => keyToEntryIndex.set(key, nextIndex));
      return;
    }

    const existingEntry = dedupedEntries[existingEntryIndex];
    const preferredEvent = pickPreferredThreadRenderEvent(
      existingEntry.event,
      entry.event,
      resolveConfirmedId
    ) as TEvent;
    const mergedKeys = Array.from(
      new Set([...getThreadRenderEventKeys(existingEntry.event, resolveConfirmedId), ...entryKeys])
    );

    dedupedEntries[existingEntryIndex] =
      preferredEvent === existingEntry.event
        ? ({
            ...existingEntry,
            absoluteIndex: Math.min(existingEntry.absoluteIndex, entry.absoluteIndex),
          } as TEntry)
        : ({
            ...entry,
            absoluteIndex: Math.min(existingEntry.absoluteIndex, entry.absoluteIndex),
          } as TEntry);

    mergedKeys.forEach((key) => keyToEntryIndex.set(key, existingEntryIndex));
  });

  return dedupedEntries;
};

export type TimelineRenderContextPrime = {
  prevEvent: MatrixEvent;
  isPrevRendered: boolean;
  pendingDayDivider: boolean;
};

/**
 * Computes the sequential renderer's `prevEvent`/`isPrevRendered` context as
 * it would stand just before `windowStartIndex`, for priming a virtual window
 * that does not render the preceding rows.
 *
 * Parity contract with the sequential path: events failing `isSkipped`
 * (ignored sender, hidden redaction, filtered thread reply) never touch the
 * context; every other event becomes `prevEvent` — including reaction/edit
 * events, which set `isPrevRendered = false`. Skipping edits here instead
 * (the original primer bug) makes a message that follows an edit burst group
 * as collapsed only when the window starts on it, so its height flips as the
 * window boundary crosses the burst and the row measurement cache goes stale
 * — visible flicker in edit-heavy streaming threads.
 */
export const primeTimelineRenderContextBefore = (
  getEvent: (index: number) => MatrixEvent | undefined,
  windowStartIndex: number,
  isSkipped: (event: MatrixEvent) => boolean
): TimelineRenderContextPrime | undefined => {
  let prevEvent: MatrixEvent | undefined;
  let oldestTrailing: MatrixEvent | undefined;
  let consumptionBase: MatrixEvent | undefined;
  for (let index = windowStartIndex - 1; index >= 0; index -= 1) {
    const event = getEvent(index);
    if (!event || !event.getId()) continue;
    if (isSkipped(event)) continue;
    if (!prevEvent) {
      prevEvent = event;
      // Residual approximation: a non-edit event whose renderer returns null
      // (e.g. hidden membership) sequentially yields isPrevRendered = false;
      // the collapsed check's sender/type equality makes that invisible.
      if (!reactionOrEditEvent(event)) break;
      oldestTrailing = event;
      continue;
    }
    oldestTrailing = event;
    if (!reactionOrEditEvent(event)) {
      consumptionBase = event;
      break;
    }
  }
  if (!prevEvent) return undefined;
  const isPrevRendered = !reactionOrEditEvent(prevEvent);
  // Sequential fold: dayDivider latches at any adjacent midnight crossing and
  // is only consumed (rendered) by a row with output — a crossing at a
  // null-rendering edit/reaction row carries forward to the next real
  // message. Events are ts-sorted, so a crossing exists among the trailing
  // null rows iff the endpoints differ in day: from the nearest rendered row
  // (where the last consumption happened) — or the oldest surviving event
  // when nothing before renders — up to prevEvent.
  const carryBase = consumptionBase ?? oldestTrailing;
  const pendingDayDivider =
    !isPrevRendered && carryBase !== undefined && carryBase !== prevEvent
      ? !inSameDay(carryBase.getTs(), prevEvent.getTs())
      : false;
  return { prevEvent, isPrevRendered, pendingDayDivider };
};
