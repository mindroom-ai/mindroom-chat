import { describe, expect, it } from 'vitest';
import {
  isScrollNearBottom,
  isTimelineAtLiveEnd,
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
      })
    ).toBe(true);
    expect(
      isTimelineAtLiveEnd({
        threadId: undefined,
        liveTimelineLinked: true,
        rangeAtEnd: false,
        canPaginateThreadFront: false,
      })
    ).toBe(false);
  });

  it('treats thread view as latest only when there is no forward pagination token', () => {
    expect(
      isTimelineAtLiveEnd({
        threadId: '$thread',
        liveTimelineLinked: false,
        rangeAtEnd: false,
        canPaginateThreadFront: false,
      })
    ).toBe(true);
    expect(
      isTimelineAtLiveEnd({
        threadId: '$thread',
        liveTimelineLinked: true,
        rangeAtEnd: true,
        canPaginateThreadFront: true,
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
