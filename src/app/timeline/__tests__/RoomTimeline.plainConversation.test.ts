import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import {
  create,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  roomThreadOverviewType,
  threadLastActivityTsMapMock,
  wrapWithSyncEngine,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

/** Three threads sent in order, the oldest with the latest reply. */
const makeThreadRoom = () => {
  const first = makeEvent('$first', { isThreadRoot: true, ts: 1 });
  const second = makeEvent('$second', { isThreadRoot: true, ts: 2 });
  const third = makeEvent('$third', { isThreadRoot: true, ts: 3 });
  threadLastActivityTsMapMock.set(first.getId(), 300);
  threadLastActivityTsMapMock.set(second.getId(), 100);
  threadLastActivityTsMapMock.set(third.getId(), 200);
  return makeRoom({ liveEvents: [first, second, third] });
};

const renderThreadedView = async (hasMindroomAgents: boolean) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(
      wrapWithSyncEngine(
        React.createElement(RoomTimeline as never, {
          room: makeThreadRoom(),
          hasMindroomAgents,
          summaryMap: new Map(),
          onStoreThreadSummary: vi.fn(),
          // The stored default: Last Reply, newest first.
          threadFilterState: createDefaultThreadFilterState(),
          threadSortFreezeState: null,
          viewMode: 'threaded',
          editor: {} as never,
        })
      )
    );
    await flushAsyncWork(2);
  });
  return renderer!;
};

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline threaded view and the filter bar', () => {
  it('sorts the threads by their latest reply under the bar in a room with agents', async () => {
    const renderer = await renderThreadedView(true);

    expect(renderer.root.findAllByType(roomThreadOverviewType as never)).toHaveLength(1);
    expect(getRenderedEventIds(renderer)).toEqual(['$first', '$third', '$second']);
  });

  it('keeps a room without agents in the order it was sent, without the bar', async () => {
    const renderer = await renderThreadedView(false);

    expect(renderer.root.findAllByType(roomThreadOverviewType as never)).toHaveLength(0);
    expect(getRenderedEventIds(renderer)).toEqual(['$first', '$second', '$third']);
  });
});
