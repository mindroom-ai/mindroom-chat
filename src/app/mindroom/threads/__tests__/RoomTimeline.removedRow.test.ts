import React from 'react';
import { Direction, EventStatus, RoomEvent } from 'matrix-js-sdk';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { getRangeWithoutRow } from '../timelinePagination';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  loadCachedRoomPaginationTokenMock,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  virtualPaginatorState,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test-utils/importBeforeTests';

type TestEvent = ReturnType<typeof makeEvent>;
type TestTimeline = ReturnType<typeof makeTimeline>;
type TestRoom = ReturnType<typeof makeRoom>;
type Handler = (...args: unknown[]) => void;

/**
 * The shared room keeps one listener per event name, so the room's last listener hides the
 * others. This room keeps every listener, as the SDK does, and returns its emitter.
 */
const keepEveryListener = (room: TestRoom) => {
  const handlers = new Map<unknown, Set<Handler>>();
  Object.assign(room, {
    on: (name: unknown, handler: Handler) => {
      const named = handlers.get(name) ?? new Set<Handler>();
      named.add(handler);
      handlers.set(name, named);
    },
    removeListener: (name: unknown, handler: Handler) => {
      handlers.get(name)?.delete(handler);
    },
  });
  return (name: unknown, ...args: unknown[]) => {
    [...(handlers.get(name) ?? [])].forEach((handler) => handler(...args));
  };
};

const makeEvents = (count: number, prefix = '$e') =>
  Array.from({ length: count }, (_, index) => makeEvent(`${prefix}${index}`, { ts: index + 1 }));

const renderRoom = async (liveTimeline: TestTimeline) => {
  const room = makeRoom({ liveTimeline });
  const emit = keepEveryListener(room);
  const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(React.createElement(ControlledRoomTimeline, { room }));
    await flushAsyncWork();
  });
  return { renderer: renderer!, room, emit };
};

/** Takes `event` out of the timeline in place and reports it, as `EventTimelineSet.removeEvent` does. */
const removeFromTimeline = (
  emit: ReturnType<typeof keepEveryListener>,
  room: TestRoom,
  timeline: TestTimeline,
  event: TestEvent
) => {
  const events = timeline.getEvents();
  events.splice(events.indexOf(event), 1);
  emit(RoomEvent.Timeline, event, room, undefined, true, { timeline });
};

const windowRange = () => virtualPaginatorState.lastOptions?.range;

importBeforeTests(() => import('../../../features/room/RoomTimeline'));

describe('getRangeWithoutRow', () => {
  it('moves the window up one row when a row above it leaves', () => {
    expect(getRangeWithoutRow({ start: 4, end: 10 }, 2)).toEqual({ start: 3, end: 9 });
  });

  it('shortens the window when one of its rows leaves', () => {
    expect(getRangeWithoutRow({ start: 4, end: 10 }, 4)).toEqual({ start: 4, end: 9 });
    expect(getRangeWithoutRow({ start: 4, end: 10 }, 9)).toEqual({ start: 4, end: 9 });
  });

  it('keeps the window when a row below it leaves', () => {
    expect(getRangeWithoutRow({ start: 4, end: 10 }, 10)).toEqual({ start: 4, end: 10 });
  });
});

describe('RoomTimeline rows that leave the room timeline', () => {
  it('drops a removed event from the room at once', async () => {
    const events = makeEvents(5);
    const liveTimeline = makeTimeline(events);
    const { renderer, room, emit } = await renderRoom(liveTimeline);
    expect(getRenderedEventIds(renderer)).toContain('$e2');

    await act(async () => {
      removeFromTimeline(emit, room, liveTimeline, events[2]!);
      await flushAsyncWork(1);
    });

    expect(getRenderedEventIds(renderer)).toEqual(['$e0', '$e1', '$e3', '$e4']);
    act(() => renderer.unmount());
  });

  it('keeps the rows paged in above when a cancelled send leaves the newest place', async () => {
    const events = makeEvents(260);
    const liveTimeline = makeTimeline(events);
    const { renderer, room, emit } = await renderRoom(liveTimeline);
    // The reader paged back over every loaded row.
    await act(async () => {
      virtualPaginatorState.lastOptions?.onRangeChange({ start: 0, end: 260 });
      await flushAsyncWork(1);
    });
    expect(windowRange()).toEqual({ start: 0, end: 260 });

    const echo = makeEvent('~txn-1', { ts: 300, isSending: true });
    await act(async () => {
      events.push(echo);
      emit(RoomEvent.Timeline, echo, room, false, false, {
        timeline: liveTimeline,
        liveEvent: true,
      });
      await flushAsyncWork(1);
    });
    expect(windowRange()).toEqual({ start: 0, end: 261 });

    // Cancelling takes the echo out of the timeline, then reports the new status.
    await act(async () => {
      removeFromTimeline(emit, room, liveTimeline, echo);
      emit(RoomEvent.LocalEchoUpdated, echo, room, echo.getId(), EventStatus.NOT_SENT);
      await flushAsyncWork(1);
    });

    expect(windowRange()).toEqual({ start: 0, end: 260 });
    const rendered = getRenderedEventIds(renderer);
    expect(rendered).toContain('$e0');
    expect(rendered).not.toContain('~txn-1');
    act(() => renderer.unmount());
  });

  it('keeps the window on the rows around a failed send the reader deletes', async () => {
    const events = makeEvents(260);
    const failed = makeEvent('~txn-failed', { ts: 100 });
    events.splice(100, 0, failed);
    const liveTimeline = makeTimeline(events);
    const { renderer, room, emit } = await renderRoom(liveTimeline);
    await act(async () => {
      virtualPaginatorState.lastOptions?.onRangeChange({ start: 0, end: 261 });
      await flushAsyncWork(1);
    });

    await act(async () => {
      removeFromTimeline(emit, room, liveTimeline, failed);
      emit(RoomEvent.LocalEchoUpdated, failed, room, failed.getId(), EventStatus.NOT_SENT);
      await flushAsyncWork(1);
    });

    expect(windowRange()).toEqual({ start: 0, end: 260 });
    const rendered = getRenderedEventIds(renderer);
    expect(rendered).toContain('$e0');
    expect(rendered).toContain('$e259');
    expect(rendered).not.toContain('~txn-failed');
    act(() => renderer.unmount());
  });

  it('leaves a removal during a back page to the page, which keeps the newest row', async () => {
    const events = makeEvents(10);
    const deleted = events[5]!;
    const liveTimeline = makeTimeline(events, { backwardToken: 'before-e0' });
    loadCachedRoomPaginationTokenMock.mockResolvedValue(undefined);
    const { decryptAllTimelineEvent } = await import('../../../utils/room');
    vi.mocked(decryptAllTimelineEvent).mockResolvedValue(undefined);
    let finishPage: () => void = () => undefined;
    matrixClientMock.paginateEventTimeline.mockImplementation(
      (timeline: TestTimeline) =>
        new Promise<boolean>((resolve) => {
          // The SDK adds the page's events before the request settles.
          timeline.getEvents().unshift(...makeEvents(5, '$older'));
          timeline.setPaginationToken(null, Direction.Backward);
          finishPage = () => resolve(false);
        })
    );
    const { renderer, room, emit } = await renderRoom(liveTimeline);
    expect(windowRange()).toEqual({ start: 0, end: 10 });

    let page: Promise<void> | void = undefined;
    await act(async () => {
      page = virtualPaginatorState.lastOptions?.onEnd?.(true);
      await flushAsyncWork();
    });
    expect(matrixClientMock.paginateEventTimeline).toHaveBeenCalled();

    await act(async () => {
      removeFromTimeline(emit, room, liveTimeline, deleted);
      await flushAsyncWork(1);
    });
    // The window waits for the page: its rows are not drawn again with the old range.
    expect(getRenderedEventIds(renderer)).toContain('$e5');

    await act(async () => {
      finishPage();
      await page;
      await flushAsyncWork();
    });

    const rendered = getRenderedEventIds(renderer);
    expect(rendered).not.toContain('$e5');
    expect(rendered).toContain('$e9');
    expect(rendered).toContain('$older4');
    act(() => renderer.unmount());
  });
});
