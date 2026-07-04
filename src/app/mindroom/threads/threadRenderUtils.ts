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

  const setEventForKeys = (keys: string[], mEvent: MatrixEvent) => {
    keys.forEach((key) => {
      eventMap.set(key, mEvent);
    });
  };

  const findExistingEvent = (keys: string[]): MatrixEvent | undefined =>
    keys.map((key) => eventMap.get(key)).find((mEvent): mEvent is MatrixEvent => !!mEvent);

  existingEvents.forEach((mEvent) => {
    const keys = getThreadRenderEventKeys(mEvent, resolveConfirmedId);
    if (keys.length === 0) return;
    setEventForKeys(keys, mEvent);
  });

  incomingEvents.forEach((mEvent) => {
    const incomingKeys = getThreadRenderEventKeys(mEvent, resolveConfirmedId);
    if (incomingKeys.length === 0) return;

    const existingEvent = findExistingEvent(incomingKeys);
    if (!existingEvent) {
      setEventForKeys(incomingKeys, mEvent);
      return;
    }

    const preferredEvent = pickPreferredThreadRenderEvent(
      existingEvent,
      mEvent,
      resolveConfirmedId
    );
    const mergedKeys = Array.from(
      new Set([...getThreadRenderEventKeys(existingEvent, resolveConfirmedId), ...incomingKeys])
    );
    setEventForKeys(mergedKeys, preferredEvent);
  });

  const merged = Array.from(new Set(eventMap.values())).sort((a, b) => {
    const tsDiff = a.getTs() - b.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (a.getId() ?? '').localeCompare(b.getId() ?? '');
  });

  // CINNY-207 AC2 render-gap RG1 (2026-07-04): observability at the
  // merge seam — bumps once per incoming m.replace whose target IS
  // present in the merged output but has NO `replacingEvent()` set.
  // That shape is diagnostic for candidate (b) / (a) at the render
  // layer: the applier ran (or was expected to run) upstream, but the
  // instance the merge kept for the target does not carry the
  // repaired replacement. See engine/reconciler.ts and
  // threads/eventCacheEditUtils.ts for the upstream applier path.
  //
  // We deliberately measure this here (post-merge), not inside the
  // dedup loop, because the "target has a replacement" state is only
  // meaningful against the final chosen instance per key.
  const mergedById = new Map<string, MatrixEvent>();
  merged.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) mergedById.set(eventId, mEvent);
  });
  let incomingHadEditRelation = false;
  incomingEvents.forEach((mEvent) => {
    if (mEvent.getRelation()?.rel_type !== RelationType.Replace) return;
    incomingHadEditRelation = true;
    const targetEventId = mEvent.getRelation()?.event_id;
    if (!targetEventId) return;
    const target = mergedById.get(targetEventId);
    if (!target) return;
    if (!target.replacingEvent()) {
      countCacheProbe('mergeSawEditRelationNoTargetChange');
    }
  });
  if (incomingHadEditRelation) {
    countCacheProbe('mergeSawIncomingEditRelation');
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
