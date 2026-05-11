import { describe, expect, it } from 'vitest';
import {
  getActiveTimelineRange,
  getEmptyTimeline,
  getFocusedRoomEventIndex,
  getLatestTimelineRange,
  getRoomTimelineRenderLimit,
  getVisibleTimelineRange,
  ROOM_TIMELINE_RENDER_LIMIT,
} from './timelinePagination';

const makeEvent = (eventId: string) =>
  ({
    getId: () => eventId,
  } as never);

describe('timeline pagination helpers', () => {
  it('selects the latest range for fresh room timelines', () => {
    expect(getLatestTimelineRange(120, 50)).toEqual({ start: 70, end: 120 });
    expect(getLatestTimelineRange(20, 50)).toEqual({ start: 0, end: 20 });
  });

  it('caps the DOM render window independently of the preload limit', () => {
    expect(getRoomTimelineRenderLimit(10_000)).toBe(ROOM_TIMELINE_RENDER_LIMIT);
    expect(getRoomTimelineRenderLimit(50)).toBe(50);
  });

  it('keeps a valid visible range and repairs out-of-bounds ranges', () => {
    expect(getVisibleTimelineRange({ start: 10, end: 20 }, 100, 50)).toEqual({
      start: 10,
      end: 20,
    });
    expect(getVisibleTimelineRange({ start: 0, end: 294 }, 294, 50)).toEqual({
      start: 244,
      end: 294,
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
});
