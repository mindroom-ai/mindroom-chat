import { describe, expect, it } from 'vitest';
import {
  getEventElementById,
  isScrollNearBottom,
  isTimelineAtLiveEnd,
  shouldAutoScrollThreadOnLiveEvent,
  TIMELINE_BOTTOM_THRESHOLD_PX,
} from './timelineScrollUtils';

describe('isTimelineAtLiveEnd', () => {
  it('uses the room live timeline state outside thread view', () => {
    expect(
      isTimelineAtLiveEnd({
        threadId: undefined,
        liveTimelineLinked: true,
        rangeAtEnd: true,
        canPaginateThreadFront: true,
        threadTailLoaded: false,
      })
    ).toBe(true);
    expect(
      isTimelineAtLiveEnd({
        threadId: undefined,
        liveTimelineLinked: true,
        rangeAtEnd: false,
        canPaginateThreadFront: false,
        threadTailLoaded: false,
      })
    ).toBe(false);
  });

  it('treats thread view as latest when either the tail is loaded or there is no forward token', () => {
    expect(
      isTimelineAtLiveEnd({
        threadId: '$thread',
        liveTimelineLinked: false,
        rangeAtEnd: false,
        canPaginateThreadFront: false,
        threadTailLoaded: false,
      })
    ).toBe(true);
    expect(
      isTimelineAtLiveEnd({
        threadId: '$thread',
        liveTimelineLinked: true,
        rangeAtEnd: true,
        canPaginateThreadFront: true,
        threadTailLoaded: true,
      })
    ).toBe(true);
    expect(
      isTimelineAtLiveEnd({
        threadId: '$thread',
        liveTimelineLinked: true,
        rangeAtEnd: true,
        canPaginateThreadFront: true,
        threadTailLoaded: false,
      })
    ).toBe(false);
  });
});

describe('isScrollNearBottom', () => {
  it('counts the view as at the bottom up to the threshold Jump to Latest shows beyond', () => {
    expect(
      isScrollNearBottom({
        scrollHeight: 1000,
        scrollTop: 600 - TIMELINE_BOTTOM_THRESHOLD_PX,
        clientHeight: 400,
      })
    ).toBe(true);
    expect(
      isScrollNearBottom({
        scrollHeight: 1000,
        scrollTop: 599 - TIMELINE_BOTTOM_THRESHOLD_PX,
        clientHeight: 400,
      })
    ).toBe(false);
  });
});

describe('shouldAutoScrollThreadOnLiveEvent', () => {
  it('only sticks to bottom for live thread replies when already at the latest edge', () => {
    expect(
      shouldAutoScrollThreadOnLiveEvent({
        relationType: 'm.thread',
        isNearBottom: true,
        isTimelineAtLiveEnd: true,
      })
    ).toBe(true);
    expect(
      shouldAutoScrollThreadOnLiveEvent({
        relationType: 'm.thread',
        isNearBottom: true,
        isTimelineAtLiveEnd: false,
      })
    ).toBe(false);
    expect(
      shouldAutoScrollThreadOnLiveEvent({
        relationType: 'm.replace',
        isNearBottom: true,
        isTimelineAtLiveEnd: true,
      })
    ).toBe(false);
  });
});

describe('thread prepend scroll anchors', () => {
  it('finds message elements by Matrix event id', () => {
    const target = {
      getAttribute: (name: string) => (name === 'data-message-id' ? '$target' : null),
    };
    const other = {
      getAttribute: (name: string) => (name === 'data-message-id' ? '$other' : null),
    };
    const container = {
      querySelectorAll: () => [other, target],
    } as unknown as ParentNode;

    expect(getEventElementById(container, '$target')).toBe(target);
    expect(getEventElementById(container, '$missing')).toBeNull();
  });
});
