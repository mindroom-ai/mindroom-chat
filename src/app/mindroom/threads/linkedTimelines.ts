import { Direction, type EventTimeline, type MatrixEvent, type Thread } from 'matrix-js-sdk';

/**
 * Follow the neighbour links of `timeline` in `direction` and return the last timeline reached.
 * Walks iteratively so long chains cannot exhaust the call stack. When the links form a cycle
 * there is no real end, so the starting timeline is returned instead.
 */




  const visited = new Set<EventTimeline>([timeline]);
  let current = timeline;
  for (;;) {
    const next = current.getNeighbouringTimeline(direction);
    if (!next) return current;
    if (visited.has(next)) return timeline;
    visited.add(next);
    current = next;
  }
};

/**
 * Every timeline linked to `timeline`, oldest first: walks back to the earliest neighbour, then
 * forward again. Each timeline appears once even when the forward links form a cycle.
 */
export const getLinkedTimelines = (timeline: EventTimeline): EventTimeline[] => {
  const first = getFirstLinkedTimeline(timeline, Direction.Backward);
  const linked: EventTimeline[] = [];
  const seen = new Set<EventTimeline>();
  let current: EventTimeline | null = first;
  while (current && !seen.has(current)) {
    seen.add(current);
    linked.push(current);
    current = current.getNeighbouringTimeline(Direction.Forward);
  }
  return linked;
};

/**
 * Events of a thread, oldest first: those of the older timelines linked before its live timeline,
 * then `thread.events`, which the thread keeps for its live timeline.
 */
export const getThreadTimelineEvents = (thread: Thread): MatrixEvent[] => {
  const liveTimeline = thread.getUnfilteredTimelineSet().getLiveTimeline();
  const linked = getLinkedTimelines(liveTimeline);
  const liveIndex = linked.indexOf(liveTimeline);
  const older = liveIndex < 0 ? linked : linked.slice(0, liveIndex);
  return [...older.flatMap((timeline) => timeline.getEvents()), ...thread.events];
};
