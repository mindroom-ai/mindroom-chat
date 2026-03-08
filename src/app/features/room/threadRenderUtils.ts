import { MatrixEvent } from 'matrix-js-sdk';
import { getLatestEdit } from '../../utils/room';

export type ThreadInitialRenderMode = 'loading' | 'cached' | 'live';

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

export const pickPreferredThreadRenderEvent = (
  existingEvent: MatrixEvent,
  incomingEvent: MatrixEvent
): MatrixEvent => {
  if (existingEvent === incomingEvent) return existingEvent;

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
    const eventId = mEvent.getId();
    if (!eventId) return;
    eventMap.set(eventId, mEvent);
  });

  incomingEvents.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (!eventId) return;

    const existingEvent = eventMap.get(eventId);
    eventMap.set(
      eventId,
      existingEvent ? pickPreferredThreadRenderEvent(existingEvent, mEvent) : mEvent
    );
  });

  return Array.from(eventMap.values()).sort((a, b) => {
    const tsDiff = a.getTs() - b.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (a.getId() ?? '').localeCompare(b.getId() ?? '');
  });
};
