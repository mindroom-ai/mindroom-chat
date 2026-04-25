import type { Dispatch, SetStateAction } from 'react';
import { Direction, type EventTimeline, type MatrixEvent, type Room } from 'matrix-js-sdk';
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

export const getEventTimeline = (room: Room, eventId: string): EventTimeline | undefined => {
  const timelineSet = room.getUnfilteredTimelineSet();
  return timelineSet.getTimelineForEvent(eventId) ?? undefined;
};

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

export const getLinkedTimelinesEventAbsoluteIndex = (
  linkedTimelines: EventTimeline[],
  eventId: string
): number | undefined => {
  let absoluteIndex = 0;

  for (const timeline of linkedTimelines) {
    const relativeIndex = timeline.getEvents().findIndex((mEvent) => mEvent.getId() === eventId);
    if (relativeIndex !== -1) {
      return absoluteIndex + relativeIndex;
    }

    absoluteIndex += timeline.getEvents().length;
  }

  return undefined;
};

export const getTimelineAndBaseIndex = (
  timelines: EventTimeline[],
  index: number
): [EventTimeline | undefined, number] => {
  let uptoTimelineLen = 0;
  const timeline = timelines.find((t) => {
    uptoTimelineLen += t.getEvents().length;
    if (index < uptoTimelineLen) return true;
    return false;
  });
  if (!timeline) return [undefined, 0];
  return [timeline, uptoTimelineLen - timeline.getEvents().length];
};

export const getTimelineRelativeIndex = (absoluteIndex: number, timelineBaseIndex: number) =>
  absoluteIndex - timelineBaseIndex;

export const getTimelineEvent = (timeline: EventTimeline, index: number): MatrixEvent | undefined =>
  timeline.getEvents()[index];

export const getEventIdAbsoluteIndex = (
  timelines: EventTimeline[],
  eventTimeline: EventTimeline,
  eventId: string
): number | undefined => {
  const timelineIndex = timelines.findIndex((t) => t === eventTimeline);
  if (timelineIndex === -1) return undefined;
  const eventIndex = eventTimeline.getEvents().findIndex((evt) => evt.getId() === eventId);
  if (eventIndex === -1) return undefined;
  const baseIndex = timelines
    .slice(0, timelineIndex)
    .reduce((accValue, timeline) => timeline.getEvents().length + accValue, 0);
  return baseIndex + eventIndex;
};

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
