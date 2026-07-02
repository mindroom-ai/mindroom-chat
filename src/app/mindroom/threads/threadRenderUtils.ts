import { MatrixEvent, Room } from 'matrix-js-sdk';
import { getSerializedReplacementEvent, isSameSenderEditEvent } from '../../utils/editEvent';
import { getLatestEdit, reactionOrEditEvent } from '../../utils/room';

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

  return Array.from(new Set(eventMap.values())).sort((a, b) => {
    const tsDiff = a.getTs() - b.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (a.getId() ?? '').localeCompare(b.getId() ?? '');
  });
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
  for (let index = windowStartIndex - 1; index >= 0; index -= 1) {
    const event = getEvent(index);
    if (!event || !event.getId()) continue;
    if (isSkipped(event)) continue;
    // Residual approximation: a non-edit event whose renderer returns null
    // (e.g. hidden membership) sequentially yields isPrevRendered = false;
    // the collapsed check's sender/type equality makes that invisible.
    return { prevEvent: event, isPrevRendered: !reactionOrEditEvent(event) };
  }
  return undefined;
};
