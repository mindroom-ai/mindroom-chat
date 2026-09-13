import { describe, expect, it } from 'vitest';
import { createDefaultThreadFilterState } from './roomThreadOverviewModel';
import {
  DIRECT_ROOM_TIMELINE_FILTER_STATE,
  resolveRoomTimelineViewState,
  THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
} from './roomTimelineViewState';

describe('resolveRoomTimelineViewState', () => {
  it('disables MindRoom overview controls and compact mode for direct rooms', () => {
    const requested = createDefaultThreadFilterState();

    expect(
      resolveRoomTimelineViewState({
        direct: true,
        eventId: '$event',
        focusEventInRoom: true,
        threadFilterState: requested,
        threadId: undefined,
        viewMode: 'compact',
      })
    ).toEqual({
      effectiveViewMode: 'normal',
      focusedRoomOverviewRequested: false,
      requestedThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
      showRoomThreadOverviewControls: false,
    });
  });

  it('preserves requested overview state for non-direct room overview routes', () => {
    const requested = createDefaultThreadFilterState();

    expect(
      resolveRoomTimelineViewState({
        direct: false,
        eventId: '$event',
        focusEventInRoom: true,
        threadFilterState: requested,
        threadId: undefined,
        viewMode: 'normal',
      })
    ).toEqual({
      effectiveViewMode: 'normal',
      focusedRoomOverviewRequested: true,
      requestedThreadFilterState: requested,
      showRoomThreadOverviewControls: true,
    });
  });

  it('does not request room overview focus inside an active thread', () => {
    const requested = createDefaultThreadFilterState();

    expect(
      resolveRoomTimelineViewState({
        direct: false,
        eventId: '$event',
        focusEventInRoom: true,
        threadFilterState: requested,
        threadId: '$thread',
        viewMode: 'normal',
      })
    ).toMatchObject({
      focusedRoomOverviewRequested: false,
      showRoomThreadOverviewControls: false,
    });
  });

  it('keeps the overview metadata cache limit explicit', () => {
    expect(THREAD_OVERVIEW_METADATA_CACHE_LIMIT).toBe(64);
  });
});
