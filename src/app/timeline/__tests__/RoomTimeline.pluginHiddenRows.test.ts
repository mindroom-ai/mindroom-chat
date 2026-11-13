import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  makeTimeline,
  pluginRowHiddenMock,
  roomTimelineVirtualizerState,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const threadId = '$root';
const forAgents = { msgtype: 'm.text', body: 'For the agents', 'org.example.relay': true };

importBeforeTests(() => import('../RoomTimeline'));

/** A thread whose root and second reply carry the content a plugin hides. */
const openThread = async (props: Record<string, unknown> = {}) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000, content: forAgents });
  const events = [
    rootEvent,
    makeEvent('$ask', { threadRootId: threadId, ts: 2_000 }),
    makeEvent('$relay', { threadRootId: threadId, ts: 3_000, content: forAgents }),
    makeEvent('$answer', {
      threadRootId: threadId,
      ts: 4_000,
      sender: '@mindroom_helper:example.org',
    }),
  ];
  const timeline = makeTimeline(events, { backwardToken: null });
  const timelineSet = { getLiveTimeline: () => timeline, getTimelineForEvent: () => undefined };
  const room = makeRoom({ liveEvents: [rootEvent] });
  room.getThread = () =>
    ({
      rootEvent,
      events: events.slice(1),
      getUnfilteredTimelineSet: () => timelineSet,
    } as never);
  threadRenderStateMock.threadEvents = events as never;
  threadRenderStateMock.threadEventIndexMapRef.current = new Map(
    events.map((event, index) => [event.getId(), index])
  );
  roomTimelineVirtualizerState.virtualIndexes = [0, 1, 2, 3];
  const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(React.createElement(Harness, { room, threadId, ...props }));
    await flushAsyncWork();
  });
  const rerender = async (next: Record<string, unknown>) => {
    await act(async () => {
      renderer!.update(React.createElement(Harness, { room, threadId, ...next }));
      await flushAsyncWork();
    });
  };
  return Object.assign(renderer!, { rerender });
};

/** The size the virtual list gives the tile of row `index`. */
const sizeOfRow = (renderer: ReturnType<typeof create>, index: number) =>
  renderer.root.find((node) => node.props['data-virtual-index'] === index).props[
    'data-virtual-size'
  ];

describe('rows a plugin hides', () => {
  it("leaves a reply in a thread it hides without a row, and keeps the thread's root", async () => {
    pluginRowHiddenMock.test = (event) => event.content['org.example.relay'] === true;
    const renderer = await openThread();
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$ask', '$answer']);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('keeps every row when no plugin hides any', async () => {
    const renderer = await openThread();
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$ask', '$relay', '$answer']);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('keeps the row the route opened, also once the route moves to another', async () => {
    pluginRowHiddenMock.test = (event) => event.content['org.example.relay'] === true;
    const renderer = await openThread({ eventId: '$relay' });
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$ask', '$relay', '$answer']);
      await renderer.rerender({ eventId: '$answer' });
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$ask', '$relay', '$answer']);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('sizes a hidden row as nothing, and gives it its size again once the route opens it', async () => {
    pluginRowHiddenMock.test = (event) => event.content['org.example.relay'] === true;
    const renderer = await openThread();
    try {
      expect(sizeOfRow(renderer, 2)).toBe(0);
      await renderer.rerender({ eventId: '$relay' });
      expect(getRenderedEventIds(renderer)).toContain('$relay');
      expect(sizeOfRow(renderer, 2)).toBeGreaterThan(0);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
