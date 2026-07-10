import { describe, expect, it } from 'vitest';
import {
  getActiveTimelineRange,
  getEmptyTimeline,
  getFocusedRoomEventIndex,
  getLatestTimelineRange,
  getVisibleTimelineRange,
  recalibrateTimelinePagination,
  type Timeline,
} from './timelinePagination';

const makeEvent = (eventId: string) =>
  ({
    getId: () => eventId,
  }) as never;

const makeTimeline = () =>
  ({
    getEvents: () => [],
    getNeighbouringTimeline: () => null,
  } as never);

describe('timeline pagination helpers', () => {
  it('selects the latest range for fresh room timelines', () => {
    expect(getLatestTimelineRange(120, 50)).toEqual({ start: 70, end: 120 });
    expect(getLatestTimelineRange(20, 50)).toEqual({ start: 0, end: 20 });
  });

  it('keeps a valid visible range and repairs out-of-bounds ranges', () => {
    expect(getVisibleTimelineRange({ start: 10, end: 20 }, 100, 50)).toEqual({
      start: 10,
      end: 20,
    });
    expect(getVisibleTimelineRange({ start: 120, end: 140 }, 100, 50)).toEqual({
      start: 50,
      end: 100,
    });
    expect(getVisibleTimelineRange({ start: 10, end: 10 }, 100, 50)).toEqual({
      start: 50,
      end: 100,
    });
    expect(getVisibleTimelineRange({ start: 0, end: 10 }, 0, 50)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it('uses full filtered range for room overviews and no virtual range inside threads', () => {
    expect(getActiveTimelineRange(undefined, true, { start: 10, end: 20 }, 80, 50)).toEqual({
      start: 0,
      end: 80,
    });
    expect(getActiveTimelineRange('$thread', true, { start: 10, end: 20 }, 80, 50)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it('resolves focused events against the filtered room order', () => {
    expect(getFocusedRoomEventIndex([makeEvent('$a'), makeEvent('$b')], '$b', 5)).toBe(1);
    expect(getFocusedRoomEventIndex([makeEvent('$a')], '$missing', 5)).toBe(5);
    expect(getFocusedRoomEventIndex([makeEvent('$a')], undefined, 5)).toBe(5);
  });

  it('builds an empty timeline placeholder', () => {
    expect(getEmptyTimeline()).toEqual({
      linkedTimelines: [],
      range: { start: 0, end: 0 },
    });
  });

  it('does not replace a newer linked chain with a stale pagination result', () => {
    const staleTimeline = makeTimeline();
    const focusedTimeline = makeTimeline();
    const focusedState: Timeline = {
      linkedTimelines: [focusedTimeline],
      range: { start: 4, end: 8 },
    };
    let currentState = focusedState;

    recalibrateTimelinePagination(
      (update) => {
        currentState = typeof update === 'function' ? update(currentState) : update;
      },
      [staleTimeline],
      [0],
      true
    );

    expect(currentState).toBe(focusedState);
  });
});
