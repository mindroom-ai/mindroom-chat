import { describe, expect, it } from 'vitest';
import {
  captureThreadPrependScrollAnchor,
  getEventElementById,
  isScrollNearBottom,
  isTimelineAtLiveEnd,
  restoreThreadPrependScrollAnchor,
  shouldAutoScrollRoomOnLiveEvent,
  shouldAutoScrollThreadOnLiveEvent,
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
  it('allows a small threshold for bottom stickiness', () => {
    expect(
      isScrollNearBottom({
        scrollHeight: 1000,
        scrollTop: 576,
        clientHeight: 400,
      })
    ).toBe(true);
    expect(
      isScrollNearBottom({
        scrollHeight: 1000,
        scrollTop: 540,
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

  it('returns true when at live end and scroll is near bottom (within 100px threshold)', () => {
    // scrollHeight 1000, clientHeight 400 → max scrollTop = 600
    // scrollTop 550 → distance from bottom = 1000 - 550 - 400 = 50 → within 100px
    expect(
      shouldAutoScrollRoomOnLiveEvent({
        scrollElement: makeScrollElement(1000, 550, 400),
        isTimelineAtLiveEnd: true,
      })
    ).toBe(true);
  });

  it('returns false when user has scrolled up beyond threshold', () => {
    // scrollTop 400 → distance from bottom = 1000 - 400 - 400 = 200 → beyond 100px
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

  it('captures the first visible thread message as the prepend scroll anchor', () => {
    const aboveViewport = {
      getAttribute: () => '$above',
      getBoundingClientRect: () => ({
        top: 40,
        bottom: 90,
      }),
    };
    const anchor = {
      getAttribute: () => '$anchor',
      getBoundingClientRect: () => ({
        top: 140,
        bottom: 180,
      }),
    };
    const scroll = {
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 500,
      }),
      querySelector: () => aboveViewport,
      querySelectorAll: () => [aboveViewport, anchor],
    } as unknown as HTMLElement;

    expect(captureThreadPrependScrollAnchor(scroll)).toEqual({
      eventId: '$anchor',
      top: 140,
    });
  });

  it('captures visibility against the timeline scroll root, not an overflowing content wrapper', () => {
    const overflowWrapper = {
      getBoundingClientRect: () => ({
        top: -1000,
        bottom: 2000,
      }),
      scrollHeight: 3000,
      clientHeight: 400,
      parentElement: null as HTMLElement | null,
    };
    const aboveViewport = {
      getAttribute: () => '$above',
      getBoundingClientRect: () => ({
        top: -100,
        bottom: 50,
      }),
      parentElement: overflowWrapper,
    };
    const anchor = {
      getAttribute: () => '$anchor',
      getBoundingClientRect: () => ({
        top: 140,
        bottom: 180,
      }),
      parentElement: overflowWrapper,
    };
    const scroll = {
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 500,
      }),
      querySelector: () => aboveViewport,
      querySelectorAll: () => [aboveViewport, anchor],
    } as unknown as HTMLElement;
    overflowWrapper.parentElement = scroll;

    expect(captureThreadPrependScrollAnchor(scroll)).toEqual({
      eventId: '$anchor',
      top: 140,
    });
  });

  it('restores the captured thread prepend anchor position after older messages are prepended', () => {
    const anchor = {
      getAttribute: () => '$anchor',
      getBoundingClientRect: () => ({
        top: 420,
        bottom: 460,
      }),
      parentElement: null,
    };
    const scroll = {
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 500,
      }),
      querySelector: () => anchor,
      querySelectorAll: () => [anchor],
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 40,
    } as unknown as HTMLElement;

    expect(
      restoreThreadPrependScrollAnchor(scroll, {
        eventId: '$anchor',
        top: 140,
      })
    ).toBe(true);
    expect(scroll.scrollTop).toBe(320);
  });

  it('restores thread prepend position on the timeline scroll root when the anchor element overflows', () => {
    const anchor = {
      getAttribute: () => '$anchor',
      getBoundingClientRect: () => ({
        top: 420,
        bottom: 460,
      }),
      parentElement: null,
      scrollHeight: 100,
      clientHeight: 40,
      scrollTop: 0,
    };
    const scroll = {
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 500,
      }),
      querySelector: () => anchor,
      querySelectorAll: () => [anchor],
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 40,
    } as unknown as HTMLElement;

    expect(
      restoreThreadPrependScrollAnchor(scroll, {
        eventId: '$anchor',
        top: 140,
      })
    ).toBe(true);
    expect(scroll.scrollTop).toBe(320);
    expect(anchor.scrollTop).toBe(0);
  });
});
