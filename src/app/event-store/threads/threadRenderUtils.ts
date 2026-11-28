import { MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { isMindroomAgentUserId } from '../../matrix/protocol/agentIdentity';
import { getThreadSummaryInfo, hasThreadSummary } from '../../matrix/protocol/threadSummary';
import { getSerializedReplacementEvent, isSameSenderEditEvent } from '../../matrix/editEvent';
import { getLatestEdit } from '../../matrix/room';
import { countCacheProbe } from '../cache/cacheProbe';

export type ThreadInitialRenderMode = 'loading' | 'cached' | 'live';
type ThreadOpenBottomPinOpts = {
  suppressOpenBottomPin?: boolean;
  threadId?: string;
  threadLatestOpenPending: boolean;
  // Latched true once an open-at-latest began for this thread; survives
  // the open chain completing. Hydration bands can land long after the
  // chain (background prefetch/reconciler) — the pin must hold for them.
  threadOpenedAtLatest: boolean;
  // A real scroll gesture ends the pin permanently for this thread view:
  // from then on the reader owns the position.
  hasUserScrollIntent: boolean;
  threadInitialRenderMode: ThreadInitialRenderMode;
  threadEventCount: number;
};

export const getThreadInitialRenderMode = ({
  initializationComplete,
  availableEventCount,
}: {
  initializationComplete: boolean;
  availableEventCount: number;
}): ThreadInitialRenderMode => {
  if (initializationComplete) return 'live';
  return availableEventCount > 0 ? 'cached' : 'loading';
};

export const shouldPinThreadToBottomOnOpen = ({
  suppressOpenBottomPin,
  threadId,
  threadLatestOpenPending,
  threadOpenedAtLatest,
  hasUserScrollIntent,
  threadInitialRenderMode,
  threadEventCount,
}: ThreadOpenBottomPinOpts): boolean =>
  !!threadId &&
  !suppressOpenBottomPin &&
  (threadLatestOpenPending || (threadOpenedAtLatest && !hasUserScrollIntent)) &&
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

// Estimate from each message's content rather than a shared average: short
// messages and folded long messages have substantially different heights.
// The base and line sizes were calibrated against measured virtualizer tiles;
// the fold budget tracks CollapsibleMessage's preview with an overlaid control.
// Tile rectangles exclude inter-row margins, as does the virtualizer cache.
// MessageBase vertical padding (S100 * 2 = 8px) and Folds T400 line height (22px).
export const THREAD_ROW_BASE_PX = 8;
export const THREAD_ROW_BASE_COMPACT_PX = 6;
export const THREAD_ROW_LINE_PX = 22;
// CollapsibleMessage previews 11em; its collapsed control adds no row height.
export const THREAD_ROW_FOLD_CONTENT_LINES = 9;
export const THREAD_ROW_WRAP_CHARS_PER_LINE = 48;
// Always-expanded rows (agent replies, legacy summaries) render in full; keep a
// ceiling high enough for long replies on 390 px phones while bounding abuse.
export const THREAD_ROW_MAX_ESTIMATED_LINES = 240;
const THREAD_ROW_BODY_SCAN_CHARS = 16_384;

const estimateBodyLines = (
  body: string,
  wrapChars = THREAD_ROW_WRAP_CHARS_PER_LINE,
  maxLines = THREAD_ROW_MAX_ESTIMATED_LINES
): number => {
  const scanned =
    body.length > THREAD_ROW_BODY_SCAN_CHARS ? body.slice(0, THREAD_ROW_BODY_SCAN_CHARS) : body;
  let lines = 0;
  let lineStart = 0;
  for (let i = 0; i <= scanned.length; i += 1) {
    if (i === scanned.length || scanned.charCodeAt(i) === 10) {
      const lineLength = i - lineStart;
      lines += Math.max(1, Math.ceil(lineLength / wrapChars));
      lineStart = i + 1;
      if (lines >= maxLines) return maxLines;
    }
  }
  if (body.length > scanned.length) return maxLines;
  return Math.min(lines, maxLines);
};

export const estimateThreadEventRowHeight = (
  mEvent: MatrixEvent,
  {
    compact,
    wrapChars = THREAD_ROW_WRAP_CHARS_PER_LINE,
    content: resolvedContent,
    showsInFull: showsInFullOverride,
  }: {
    compact: boolean;
    wrapChars?: number;
    content?: Record<string, unknown>;
    showsInFull?: boolean;
  }
): number => {
  const base = compact ? THREAD_ROW_BASE_COMPACT_PX : THREAD_ROW_BASE_PX;
  const relationType = mEvent.getRelation()?.rel_type;
  // Edits and reactions have no tile to measure. Reserve exactly zero
  // space so a streaming history cannot accumulate phantom scroll height.
  if (relationType === RelationType.Replace || relationType === RelationType.Annotation) {
    return 0;
  }
  const contentRecord = resolvedContent ?? mEvent.getContent<Record<string, unknown>>();
  const body = typeof contentRecord.body === 'string' ? contentRecord.body : '';
  // Thread rows render a summary as a one-line marker under the reply before it.
  if (getThreadSummaryInfo(contentRecord)?.summaryText) return base + THREAD_ROW_LINE_PX;
  // Always-expanded rows (agent replies and legacy thread summaries) never fold:
  // plain-text and inline-HTML agent replies render in full.
  const inFull =
    showsInFullOverride ??
    (isMindroomAgentUserId(mEvent.getSender() ?? undefined) || hasThreadSummary(contentRecord));
  const maxLines = inFull ? THREAD_ROW_MAX_ESTIMATED_LINES : THREAD_ROW_FOLD_CONTENT_LINES;
  const lines = estimateBodyLines(body, wrapChars, maxLines);
  return base + lines * THREAD_ROW_LINE_PX;
};

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

  // ISSUE-207 AC2 render-gap RG5-fix2 (2026-07-04): structural monotonic
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

/** Thread rows render oldest first; equal timestamps fall back to event ID. */
export const compareThreadRenderOrder = (a: MatrixEvent, b: MatrixEvent): number =>
  a.getTs() - b.getTs() || (a.getId() ?? '').localeCompare(b.getId() ?? '');

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

  // ISSUE-207 AC2 render-gap RG5d (2026-07-04): canonicalize on write.
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
      // ISSUE-207 AC2 render-gap RG5c (re-homed post-F1): permanent
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

  // setEventForKeys picks the winner and displaces the losers (RG5d).
  const addEvent = (mEvent: MatrixEvent) =>
    setEventForKeys(getThreadRenderEventKeys(mEvent, resolveConfirmedId), mEvent);
  existingEvents.forEach(addEvent);
  incomingEvents.forEach(addEvent);

  return Array.from(new Set(eventMap.values())).sort(compareThreadRenderOrder);
};
