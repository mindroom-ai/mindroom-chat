import React, { Activity } from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import { PaneCollapsedContext } from '../../lib/hooks/usePaneCollapsed';
import {
  RoomEvent,
  create,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  roomThreadOverviewType,
  roomTimelineVirtualizerState,
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

  it('resyncs room messages that arrived while parked in Activity hidden on commit without mid-peek churn, and pins to the latest end', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const first = makeEvent('$msg-1', { ts: 100 });
    const second = makeEvent('$msg-2', { ts: 200 });
    const room = makeRoom({ liveEvents: [first, second] });
    const renderTree = (mode: 'visible' | 'hidden', collapsed: boolean) =>
      wrapWithSyncEngine(
        React.createElement(
          PaneCollapsedContext.Provider,
          { value: collapsed },
          React.createElement(
            Activity as React.ComponentType<{
              mode: 'visible' | 'hidden';
              children?: React.ReactNode;
            }>,
            { mode },
            React.createElement(RoomTimeline as never, {
              room,
              hasMindroomAgents: false,
              summaryMap: new Map(),
              onStoreThreadSummary: vi.fn(),
              threadFilterState: createDefaultThreadFilterState(),
              threadSortFreezeState: null,
              viewMode: 'classic',
              editor: {} as never,
            })
          )
        )
      );

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(renderTree('visible', false));
      await flushAsyncWork(2);
    });
    expect(getRenderedEventIds(renderer)).toEqual(['$msg-1', '$msg-2']);

    // Park inside Activity hidden (thread fills phone screen) and append a live room message
    // while useLiveEventArrive listeners are disconnected.
    await act(async () => {
      renderer.update(renderTree('hidden', true));
    });
    expect(room.__listeners.has(RoomEvent.Timeline)).toBe(false);
    const arrived = makeEvent('$msg-3', { ts: 300 });
    room.getLiveTimeline().getEvents().push(arrived);
    room.__listeners.get(RoomEvent.Timeline)?.(arrived, room, false, false, { liveEvent: true });

    // Passive back-peek reveals Activity while PaneCollapsedContext stays true: stays frozen.
    roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
    await act(async () => {
      renderer.update(renderTree('visible', true));
    });
    expect(getRenderedEventIds(renderer)).toEqual(['$msg-1', '$msg-2']);

    // Commit flips PaneCollapsedContext to false: resyncs the new message and pins to latest end.
    await act(async () => {
      renderer.update(renderTree('visible', false));
      await flushAsyncWork(2);
    });
    expect(getRenderedEventIds(renderer)).toEqual(['$msg-1', '$msg-2', '$msg-3']);
    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalledWith(2, {
      align: 'end',
    });
  });
});
