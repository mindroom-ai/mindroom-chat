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
  viewportAtBottom?: boolean;
  scrollToBottomRef?: { current: { count: number; smooth: boolean } };
  onRelink?: () => void;
};

const ResetHarness = ({
  room,
  threadId,
  eventId,
  timeline,
  rebuildTimeline,
  setTimeline,
  viewportAtBottom = false,
  scrollToBottomRef = { current: { count: 0, smooth: false } },
  onRelink = () => undefined,
}: HarnessProps) => {
  useRoomTimelineResetRelink({
    room: room as unknown as Room,
    threadId,
    eventId,
    timeline,
    rebuildTimeline,
    setTimeline: setTimeline as never,
    isViewportAtBottomNow: () => viewportAtBottom,
    scrollToBottomRef,
    onRelink,
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
    props.setLiveTimeline(props.newLiveTimeline);
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
    props.setLiveTimeline(props.newLiveTimeline);
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, otherTimelineSet);
    });

    expect(props.setTimeline).not.toHaveBeenCalled();
  });

  it('pins the reader back to bottom only when they were at bottom', async () => {
    const props = makeProps();
    const scrollToBottomRef = { current: { count: 0, smooth: true } };

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
          viewportAtBottom: true,
          scrollToBottomRef,
        })
      );
    });
    props.setLiveTimeline(props.newLiveTimeline);
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });

    expect(scrollToBottomRef.current.count).toBe(1);
    expect(scrollToBottomRef.current.smooth).toBe(false);
  });

  it('does not bump the bottom pin for a scrolled-up reader', async () => {
    const props = makeProps();
    const scrollToBottomRef = { current: { count: 0, smooth: true } };

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
          viewportAtBottom: false,
          scrollToBottomRef,
        })
      );
    });
    props.setLiveTimeline(props.newLiveTimeline);
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });

    expect(props.setTimeline).toHaveBeenCalledTimes(1);
    expect(scrollToBottomRef.current.count).toBe(0);
  });

  it('notifies once for one reset even if the event repeats', async () => {
    const props = makeProps();
    const onRelink = vi.fn();

    await act(async () => {
      create(
        React.createElement(ResetHarness, {
          room: props.room,
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
          onRelink,
        })
      );
    });
    props.setLiveTimeline(props.newLiveTimeline);
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('recovers a reset that happened before the passive subscription', async () => {
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

    expect(props.setTimeline).toHaveBeenCalledTimes(1);
    expect(props.setTimeline).toHaveBeenCalledWith(props.rebuiltTimeline);
  });

  it('uses the current event route without re-registering the listener', async () => {
    const props = makeProps();
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ResetHarness, {
          room: props.room,
          eventId: '$event:example.org',
          timeline: props.timeline,
          rebuildTimeline: props.rebuildTimeline,
          setTimeline: props.setTimeline,
        })
      );
    });
    props.setLiveTimeline(props.newLiveTimeline);
    await act(async () => {
      props.room.emit(RoomEvent.TimelineReset, props.room, props.room.getUnfilteredTimelineSet());
    });
    expect(props.setTimeline).not.toHaveBeenCalled();
    expect(props.room.listenerCount(RoomEvent.TimelineReset)).toBe(1);

    await act(async () => {
      renderer?.update(
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

    expect(props.room.listenerCount(RoomEvent.TimelineReset)).toBe(1);
    expect(props.setTimeline).toHaveBeenCalledTimes(1);
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
