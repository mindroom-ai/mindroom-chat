import { describe, expect, it } from 'vitest';
import {
  getEventElementById,
  isScrollNearBottom,
  isTimelineAtLiveEnd,
  shouldAutoScrollRoomOnLiveEvent,
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

describe('shouldAutoScrollRoomOnLiveEvent', () => {
  const makeScrollElement = (scrollHeight: number, scrollTop: number, clientHeight: number) =>
    ({ scrollHeight, scrollTop, clientHeight } as unknown as HTMLElement);

  it('returns true when at live end and scroll is near bottom (within 96px threshold)', () => {
    // scrollHeight 1000, clientHeight 400 → max scrollTop = 600
    // scrollTop 550 → distance from bottom = 1000 - 550 - 400 = 50 → within 96px
    expect(
      shouldAutoScrollRoomOnLiveEvent({
        scrollElement: makeScrollElement(1000, 550, 400),
        isTimelineAtLiveEnd: true,
      })
    ).toBe(true);
  });

  it('returns false when user has scrolled up beyond threshold', () => {
    // scrollTop 400 → distance from bottom = 1000 - 400 - 400 = 200 → beyond 96px
    expect(
      shouldAutoScrollRoomOnLiveEvent({
        scrollElement: makeScrollElement(1000, 400, 400),
        isTimelineAtLiveEnd: true,
      })
    ).toBe(false);
  });

  it('returns false when not at live end even if near bottom', () => {
    expect(
      shouldAutoScrollRoomOnLiveEvent({
        scrollElement: makeScrollElement(1000, 580, 400),
        isTimelineAtLiveEnd: false,
      })
    ).toBe(false);
  });

  it('returns false when scrollElement is null', () => {
    expect(
      shouldAutoScrollRoomOnLiveEvent({
        scrollElement: null,
        isTimelineAtLiveEnd: true,
      })
    ).toBe(false);
  });

  it('respects custom thresholdPx', () => {
    // distance from bottom = 1000 - 550 - 400 = 50
    expect(
      shouldAutoScrollRoomOnLiveEvent({
        scrollElement: makeScrollElement(1000, 550, 400),
        isTimelineAtLiveEnd: true,
        thresholdPx: 30,
      })
    ).toBe(false);

    expect(
      shouldAutoScrollRoomOnLiveEvent({
        scrollElement: makeScrollElement(1000, 550, 400),
        isTimelineAtLiveEnd: true,
        thresholdPx: 60,
      })
    ).toBe(true);
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
