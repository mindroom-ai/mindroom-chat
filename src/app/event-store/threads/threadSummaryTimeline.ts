import type { MatrixEvent } from 'matrix-js-sdk';
import { reactionOrEditEvent } from '../../matrix/room';
import { getThreadSummaryInfo, isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';

export type ThreadSummaryMarkerPlan = {
  /** The thread's first summary: it titled the thread rather than updating the title. */
  first: boolean;
  previousSummaryText?: string;
};

export type ThreadSummaryTimelinePlan = {
  hiddenEventIds: ReadonlySet<string>;
  markersByEventId: ReadonlyMap<string, ThreadSummaryMarkerPlan>;
};

/** What is known about thread history older than the events given. */
export type ThreadSummaryHistory = {
  sdkLoaded: boolean;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
};

type PlanOptions = {
  history: ThreadSummaryHistory;
  /** Events the route or a jump opened stay visible even when they repeat the previous summary. */
  revealedEventIds?: ReadonlySet<string>;
  /** The content an event's row shows, after its latest edit. */
  getContent?: (event: MatrixEvent) => Record<string, unknown>;
  /** Senders whose rows the timeline hides. */
  ignoredUserIds?: ReadonlySet<string>;
};

// MindRoom posts a summary after the first reply and then every ten messages,
// and it is meant to stay the same while the thread's topic does. In a thread,
// a summary that repeats the previous one is hidden; the others become markers.
// Markers with no other row between them (a provisional title while the reply
// streams, then the title after it) show as one: the last of the run, which
// keeps the first marker's place in the thread (`first`, the text it replaces).
export const planThreadSummaryTimeline = (
  events: readonly MatrixEvent[],
  {
    history,
    revealedEventIds,
    getContent = (event) => event.getContent(),
    ignoredUserIds,
  }: PlanOptions
): ThreadSummaryTimelinePlan => {
  // Only then is the earliest summary given also the thread's first.
  const historyStartLoaded =
    history.sdkLoaded && !history.canPaginateBack && !history.hasMoreCachedBack;
  const hiddenEventIds = new Set<string>();
  const markersByEventId = new Map<string, ThreadSummaryMarkerPlan>();
  let previousSummaryText: string | undefined;
  // The last marker planned, while no other row has followed it.
  let lastMarker: { eventId: string; plan: ThreadSummaryMarkerPlan } | undefined;

  events.forEach((event) => {
    const eventId = event.getId();
    // Edits, reactions and ignored senders have no row of their own.
    if (!eventId || reactionOrEditEvent(event)) return;
    if (ignoredUserIds?.has(event.getSender() ?? '')) return;
    // Parse as the timeline row does, so only rows that would show a marker are planned.
    const summaryText = isThreadSummaryEvent(event)
      ? getThreadSummaryInfo(getContent(event))?.summaryText
      : undefined;
    if (!summaryText) {
      lastMarker = undefined;
      return;
    }

    const repeated = summaryText === previousSummaryText;
    if (repeated && !revealedEventIds?.has(eventId)) {
      hiddenEventIds.add(eventId);
      return;
    }
    let plan: ThreadSummaryMarkerPlan = {
      first: previousSummaryText === undefined && historyStartLoaded,
      ...(previousSummaryText !== undefined && !repeated ? { previousSummaryText } : {}),
    };
    if (lastMarker && !repeated && !revealedEventIds?.has(lastMarker.eventId)) {
      hiddenEventIds.add(lastMarker.eventId);
      markersByEventId.delete(lastMarker.eventId);
      // A run that comes back to the title before it replaces nothing.
      plan =
        lastMarker.plan.previousSummaryText === summaryText
          ? { first: lastMarker.plan.first }
          : lastMarker.plan;
    }
    markersByEventId.set(eventId, plan);
    lastMarker = { eventId, plan };
    previousSummaryText = summaryText;
  });

  return { hiddenEventIds, markersByEventId };
};
