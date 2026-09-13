import { MatrixEvent } from 'matrix-js-sdk';
import { getLatestEdit } from '../../utils/room';

export type ThreadInitialRenderMode = 'loading' | 'cached' | 'live';
type ThreadOpenBottomPinOpts = {
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
  threadId,
  threadLatestOpenPending,
  threadInitialRenderMode,
  threadEventCount,
}: ThreadOpenBottomPinOpts): boolean =>
  !!threadId &&
  threadLatestOpenPending &&
  threadInitialRenderMode !== 'loading' &&
  threadEventCount > 0;

const getThreadRenderEventId = (mEvent: MatrixEvent): string | undefined => {
  const eventId = mEvent.getId();
  return typeof eventId === 'string' && eventId.length > 0 ? eventId : undefined;
};

const getThreadRenderTransactionId = (mEvent: MatrixEvent): string | undefined => {
  const txnId = mEvent.getTxnId() ?? mEvent.getUnsigned()?.transaction_id;
  return typeof txnId === 'string' && txnId.length > 0 ? txnId : undefined;
};

export const getThreadRenderEventKey = (mEvent: MatrixEvent): string | undefined => {
  const txnId = getThreadRenderTransactionId(mEvent);
  if (txnId) return `txn:${txnId}`;

  const eventId = getThreadRenderEventId(mEvent);
  if (eventId) return `event:${eventId}`;

  return undefined;
};

const isLocalEchoEvent = (mEvent: MatrixEvent): boolean => {
  const eventId = getThreadRenderEventId(mEvent);
  if (eventId?.startsWith('~')) return true;
  return mEvent.isSending();
};

export const pickPreferredThreadRenderEvent = (
  existingEvent: MatrixEvent,
  incomingEvent: MatrixEvent
): MatrixEvent => {
  if (existingEvent === incomingEvent) return existingEvent;

  const existingKey = getThreadRenderEventKey(existingEvent);
  const incomingKey = getThreadRenderEventKey(incomingEvent);
  if (existingKey && existingKey === incomingKey) {
    const existingLocalEcho = isLocalEchoEvent(existingEvent);
    const incomingLocalEcho = isLocalEchoEvent(incomingEvent);
    if (existingLocalEcho !== incomingLocalEcho) {
      return existingLocalEcho ? incomingEvent : existingEvent;
    }
  }

  if (existingEvent.isRedacted() && !incomingEvent.isRedacted()) return existingEvent;
  if (!existingEvent.isRedacted() && incomingEvent.isRedacted()) return incomingEvent;

  const existingReplacement = existingEvent.replacingEvent() ?? undefined;
  const incomingReplacement = incomingEvent.replacingEvent() ?? undefined;
  if (existingReplacement || incomingReplacement) {
    const preferredReplacement = getLatestEdit(
      existingEvent,
      [existingReplacement, incomingReplacement].filter(
        (replacement): replacement is MatrixEvent => !!replacement
      )
    );
    if (preferredReplacement === existingReplacement && preferredReplacement !== incomingReplacement) {
      return existingEvent;
    }
    if (preferredReplacement === incomingReplacement && preferredReplacement !== existingReplacement) {
      return incomingEvent;
    }
  }

  return incomingEvent;
};

export const mergeThreadRenderEvents = (
  existingEvents: MatrixEvent[],
  incomingEvents: MatrixEvent[]
): MatrixEvent[] => {
  const eventMap = new Map<string, MatrixEvent>();

  existingEvents.forEach((mEvent) => {
    const eventKey = getThreadRenderEventKey(mEvent);
    if (!eventKey) return;
    eventMap.set(eventKey, mEvent);
  });

  incomingEvents.forEach((mEvent) => {
    const eventKey = getThreadRenderEventKey(mEvent);
    if (!eventKey) return;

    const existingEvent = eventMap.get(eventKey);
    eventMap.set(
      eventKey,
      existingEvent ? pickPreferredThreadRenderEvent(existingEvent, mEvent) : mEvent
    );
  });

  return Array.from(eventMap.values()).sort((a, b) => {
    const tsDiff = a.getTs() - b.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (a.getId() ?? '').localeCompare(b.getId() ?? '');
  });
};
