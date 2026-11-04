import React from 'react';
import { Direction } from 'matrix-js-sdk';
import { act } from 'react-test-renderer';
import { describe, expect, it, type Mock } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  loadCachedRoomPaginationTokenMock,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  roomIntroType,
  virtualPaginatorState,
} from '../test-utils/RoomTimeline.test.shared';

type TestTimeline = ReturnType<typeof makeTimeline>;

// The shared harness replaces the paginator (imported after it, as the timeline is); its retry
// is one mock for every render.
const loadRetryPaginationMock = async (): Promise<Mock> => {
  const { useVirtualPaginator } = await import('../../../hooks/useVirtualPaginator');
  const paginator = (
    useVirtualPaginator as unknown as (options: object) => { retryPagination: Mock }
  )({ count: 0, range: { start: 0, end: 0 }, onRangeChange: () => undefined });
  return paginator.retryPagination;
};

const renderRoom = async (liveTimeline: TestTimeline) => {
  const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(
      React.createElement(ControlledRoomTimeline, { room: makeRoom({ liveTimeline }) })
    );
    await flushAsyncWork();
  });
  return renderer!;
};

/** Asks the room for its next older page, as the paginator does at the back sentinel. */
const paginateBack = async () => {
  await act(async () => {
    await virtualPaginatorState.lastOptions?.onEnd?.(true);
    await flushAsyncWork();
  });
};

describe('RoomTimeline room pages without rows', () => {
  it('shows the room start when the last page brings no events', async () => {
    const liveTimeline = makeTimeline([makeEvent('$latest', { ts: 10 })], {
      backwardToken: 'before-latest',
    });
    loadCachedRoomPaginationTokenMock.mockResolvedValue(undefined);
    // The server answers with an empty chunk and no further token: the room starts here.
    matrixClientMock.paginateEventTimeline.mockImplementation(async (timeline: TestTimeline) => {
      timeline.setPaginationToken(null, Direction.Backward);
      return false;
    });
    const renderer = await renderRoom(liveTimeline);
    expect(renderer.root.findAllByType(roomIntroType)).toHaveLength(0);

    await paginateBack();

    expect(matrixClientMock.paginateEventTimeline).toHaveBeenCalled();
    expect(renderer.root.findAllByType(roomIntroType)).toHaveLength(1);
    act(() => renderer.unmount());
  });

  it('asks again when a page only moved the token', async () => {
    const liveTimeline = makeTimeline([makeEvent('$latest', { ts: 10 })], {
      backwardToken: 'before-latest',
    });
    loadCachedRoomPaginationTokenMock.mockResolvedValue(undefined);
    matrixClientMock.paginateEventTimeline.mockImplementation(async (timeline: TestTimeline) => {
      timeline.setPaginationToken('further-back', Direction.Backward);
      return true;
    });
    const retryPaginationMock = await loadRetryPaginationMock();
    const renderer = await renderRoom(liveTimeline);
    retryPaginationMock.mockClear();

    await paginateBack();

    expect(retryPaginationMock).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType(roomIntroType)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('leaves a failed page for the reader to retry', async () => {
    const liveTimeline = makeTimeline([makeEvent('$latest', { ts: 10 })], {
      backwardToken: 'before-latest',
    });
    loadCachedRoomPaginationTokenMock.mockResolvedValue(undefined);
    matrixClientMock.paginateEventTimeline.mockRejectedValue(new Error('offline'));
    const retryPaginationMock = await loadRetryPaginationMock();
    const renderer = await renderRoom(liveTimeline);
    retryPaginationMock.mockClear();

    await paginateBack();

    expect(retryPaginationMock).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
