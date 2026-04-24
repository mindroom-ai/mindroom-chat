import type { Dispatch, SetStateAction } from 'react';
import { Direction, type EventTimeline, type Room } from 'matrix-js-sdk';
import type { ItemRange } from '../../hooks/useVirtualPaginator';
import { getRenderableEvents } from './roomTimelineEvents';

export type Timeline = {
  linkedTimelines: EventTimeline[];
  range: ItemRange;
};

export type RecalibrateFilterOpts = {
  room: Room;
  threadId: string | undefined;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
};

export const getLiveTimeline = (room: Room): EventTimeline =>
  room.getUnfilteredTimelineSet().getLiveTimeline();

export const getFirstLinkedTimeline = (
  timeline: EventTimeline,
  direction: Direction
): EventTimeline => {
  const linkedTm = timeline.getNeighbouringTimeline(direction);
  if (!linkedTm) return timeline;
  return getFirstLinkedTimeline(linkedTm, direction);
};

export const getLinkedTimelines = (timeline: EventTimeline): EventTimeline[] => {
  const firstTimeline = getFirstLinkedTimeline(timeline, Direction.Backward);
  const timelines: EventTimeline[] = [];

  for (
    let nextTimeline: EventTimeline | null = firstTimeline;
    nextTimeline;
    nextTimeline = nextTimeline.getNeighbouringTimeline(Direction.Forward)
  ) {
    timelines.push(nextTimeline);
  }
  return timelines;
};

export const timelineToEventsCount = (timeline: EventTimeline) => timeline.getEvents().length;

export const getTimelinesEventsCount = (timelines: EventTimeline[]): number =>
  timelines.reduce((count, timeline) => count + timelineToEventsCount(timeline), 0);

export const recalibrateTimelinePagination = (
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  linkedTimelines: EventTimeline[],
  timelinesEventsCount: number[],
  backwards: boolean,
  filterOpts?: RecalibrateFilterOpts,
  timelinesRenderableCounts?: number[]
) => {
  const topTimeline = linkedTimelines[0];
  const timelineMatch = (mt: EventTimeline) => (t: EventTimeline) => t === mt;

  const newLTimelines = getLinkedTimelines(topTimeline);
  const topTmIndex = newLTimelines.findIndex(timelineMatch(topTimeline));
  const topAddedTm = topTmIndex === -1 ? [] : newLTimelines.slice(0, topTmIndex);

  let offsetRange: number;
  if (filterOpts) {
    const countRenderable = (tms: EventTimeline[]) =>
      getRenderableEvents(
        tms,
        filterOpts.room,
        filterOpts.threadId,
        filterOpts.ignoredUsersSet,
        filterOpts.showHiddenEvents,
        filterOpts.hideMembershipEvents,
        filterOpts.hideNickAvatarEvents
      ).length;
    const oldTopRenderableCount =
      timelinesRenderableCounts?.[0] ?? countRenderable([linkedTimelines[0]]);
    const newTopRenderableCount = countRenderable([newLTimelines[topTmIndex]]);
    const topTmAddedRenderable = newTopRenderableCount - oldTopRenderableCount;
    const addedTmRenderable = countRenderable(topAddedTm);
    offsetRange = addedTmRenderable + (backwards ? topTmAddedRenderable : 0);
  } else {
    const topTmAddedEvt =
      timelineToEventsCount(newLTimelines[topTmIndex]) - timelinesEventsCount[0];
    offsetRange = getTimelinesEventsCount(topAddedTm) + (backwards ? topTmAddedEvt : 0);
  }

  setTimeline((currentTimeline) => ({
    linkedTimelines: newLTimelines,
    range:
      offsetRange > 0
        ? {
            start: currentTimeline.range.start + offsetRange,
            end: currentTimeline.range.end + offsetRange,
          }
        : { ...currentTimeline.range },
  }));
};
