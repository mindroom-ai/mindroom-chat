import React from 'react';
import { RoomEvent, type EventTimeline, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Timeline } from './timelinePagination';
import { useRoomTimelineResetRelink } from './roomTimelineResetRelink';

type Listener = (...args: unknown[]) => void;

type MockRoom = {
  roomId: string;
  on: (eventName: string, listener: Listener) => void;
  removeListener: (eventName: string, listener: Listener) => void;
  emit: (eventName: string, ...args: unknown[]) => void;
  listenerCount: (eventName: string) => number;
  getUnfilteredTimelineSet: () => { getLiveTimeline: () => EventTimeline };
};

const makeTimeline = (): EventTimeline => ({ __tag: 'timeline' } as unknown as EventTimeline);

const makeRoom = ({
  liveTimeline,
  roomId = '!room:example.org',
}: {
  liveTimeline: EventTimeline;
  roomId?: string;
}): { room: MockRoom; setLiveTimeline: (timeline: EventTimeline) => void } => {
  const listeners = new Map<string, Set<Listener>>();
  let currentLive = liveTimeline;
  const timelineSet = {
    getLiveTimeline: () => currentLive,
  };
  return {
    room: {
      roomId,
      on: (eventName, listener) => {
        const eventListeners = listeners.get(eventName) ?? new Set();
        eventListeners.add(listener);
        listeners.set(eventName, eventListeners);
      },
      removeListener: (eventName, listener) => {
        listeners.get(eventName)?.delete(listener);
      },
      emit: (eventName, ...args) => {
        listeners.get(eventName)?.forEach((listener) => listener(...args));
      },
      listenerCount: (eventName) => listeners.get(eventName)?.size ?? 0,
      getUnfilteredTimelineSet: () => timelineSet as never,
    },
    setLiveTimeline: (timeline) => {
      currentLive = timeline;
    },
  };
};

type HarnessProps = {
  room: MockRoom;
  threadId?: string;
  eventId?: string;
  timeline: Timeline;
  rebuildTimeline: () => Timeline;
  setTimeline: (value: unknown) => void;
  atBottom?: boolean;
  scrollToBottomRef?: { current: { count: number; smooth: boolean } };
  roomPaginatingBackRef?: { current: boolean };
};

const ResetHarness = ({
  room,
  threadId,
  eventId,
  timeline,
  rebuildTimeline,
  setTimeline,
  atBottom = false,
  scrollToBottomRef = { current: { count: 0, smooth: false } },
  roomPaginatingBackRef = { current: false },
}: HarnessProps) => {
  useRoomTimelineResetRelink({
    room: room as unknown as Room,
    threadIdRef: { current: threadId },
    eventId,
    timeline,
    rebuildTimeline,
    setTimeline: setTimeline as never,
    atBottomRef: { current: atBottom },
    scrollToBottomRef,
    roomPaginatingBackRef,
  });
  return null;
};

const makeProps = () => {
  const staleTimeline = makeTimeline();
  const newLiveTimeline = makeTimeline();
  const { room, setLiveTimeline } = makeRoom({ liveTimeline: staleTimeline });
  const timeline: Timeline = {
    linkedTimelines: [staleTimeline],
    range: { start: 0, end: 1 },
  };
  const rebuiltTimeline: Timeline = {
    linkedTimelines: [newLiveTimeline],
    range: { start: 0, end: 0 },
  };
  const rebuildTimeline = vi.fn(() => rebuiltTimeline);
  const setTimeline = vi.fn();
  return {
    newLiveTimeline,
    rebuildTimeline,
    rebuiltTimeline,
    room,
    setLiveTimeline,
    setTimeline,
    timeline,
  };
};

describe('useRoomTimelineResetRelink', () => {
  it('rebuilds the timeline when a reset orphans the linked chain', async () => {
    const props = makeProps();
    props.setLiveTimeline(props.newLiveTimeline);

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
        })
      );
    });
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });

    expect(props.rebuildTimeline).toHaveBeenCalledTimes(1);
    expect(props.setTimeline).toHaveBeenCalledWith(props.rebuiltTimeline);
  });

  it('does nothing when the linked chain still contains the live timeline', async () => {
    const props = makeProps();
    // live timeline unchanged → chain still linked

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
        })
      );
    });
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });

    expect(props.setTimeline).not.toHaveBeenCalled();
  });

  it('ignores resets while a thread or event view is active', async () => {
    const props = makeProps();
    props.setLiveTimeline(props.newLiveTimeline);

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          threadId: '$thread:example.org',
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
        })
      );
    });
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });
    expect(props.setTimeline).not.toHaveBeenCalled();

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          eventId: '$event:example.org',
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
        })
      );
    });
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });
    expect(props.setTimeline).not.toHaveBeenCalled();
  });

  it('ignores resets of other timeline sets (e.g. thread sets)', async () => {
    const props = makeProps();
    props.setLiveTimeline(props.newLiveTimeline);
    const otherTimelineSet = { getLiveTimeline: () => makeTimeline() };

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
        })
      );
    });
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, otherTimelineSet);
    });

    expect(props.setTimeline).not.toHaveBeenCalled();
  });

  it('pins the reader back to bottom only when they were at bottom', async () => {
    const props = makeProps();
    props.setLiveTimeline(props.newLiveTimeline);
    const scrollToBottomRef = { current: { count: 0, smooth: true } };

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
          atBottom: true,
          scrollToBottomRef,
        })
      );
    });
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });

    expect(scrollToBottomRef.current.count).toBe(1);
    expect(scrollToBottomRef.current.smooth).toBe(false);
  });

  it('re-heals when an in-flight pagination clobbers the relinked chain', async () => {
    const props = makeProps();
    props.setLiveTimeline(props.newLiveTimeline);
    const roomPaginatingBackRef = { current: true };
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
          roomPaginatingBackRef,
        })
      );
    });
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });
    expect(props.setTimeline).toHaveBeenCalledTimes(1);

    // The pre-reset back-pagination settles and reinstalls the orphaned
    // chain (recalibrateTimelinePagination) — the latched heal must re-link.
    roomPaginatingBackRef.current = false;
    await act(async () => {
      renderer?.update(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: { ...props.timeline },
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
          roomPaginatingBackRef,
        })
      );
    });
    expect(props.setTimeline).toHaveBeenCalledTimes(2);

    // Once linked and quiescent the latch clears: a later live-timeline-less
    // chain (e.g. event-focused history) must NOT be hijacked.
    await act(async () => {
      renderer?.update(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.rebuiltTimeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
          roomPaginatingBackRef,
        })
      );
    });
    await act(async () => {
      renderer?.update(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: { ...props.timeline },
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
          roomPaginatingBackRef,
        })
      );
    });
    expect(props.setTimeline).toHaveBeenCalledTimes(2);
  });

  it('removes the listener on unmount', async () => {
    const props = makeProps();
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
        })
      );
    });
    expect(props.room.listenerCount(RoomEvent.TimelineReset)).toBe(1);

    await act(async () => {
      renderer?.unmount();
    });
    expect(props.room.listenerCount(RoomEvent.TimelineReset)).toBe(0);
  });
});
