import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { CompactRoomWithoutThreads } from '../CompactRoomWithoutThreads';
import {
  compactPlaceholderType,
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  roomIntroType,
  roomThreadOverviewType,
} from '../test-utils/RoomTimeline.test.shared';

const renderRoom = async (
  room: ReturnType<typeof makeRoom>,
  initialViewMode: 'compact' | 'threaded'
) => {
  const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(React.createElement(ControlledRoomTimeline, { room, initialViewMode }));
    await flushAsyncWork(5);
  });
  if (!renderer) throw new Error('the room timeline did not render');
  return renderer;
};

/** The rendered nodes of a component or of one of the harness's named doubles. */
const nodesOf = (renderer: ReturnType<typeof create>, type: unknown) =>
  renderer.root.findAll((node) => node.type === type);

describe('RoomTimeline Compact room without threads', () => {
  // The header names the room, so its start says there is no thread instead of repeating the
  // name in the intro (the offline invitation spec finds the room's name once).
  it('shows the cards empty state at the room start instead of the intro', async () => {
    const renderer = await renderRoom(makeRoom(), 'compact');

    expect(nodesOf(renderer, roomThreadOverviewType)[0]?.props.threadCount).toBe(0);
    expect(nodesOf(renderer, compactPlaceholderType)).toHaveLength(0);
    expect(nodesOf(renderer, CompactRoomWithoutThreads)).toHaveLength(1);
    expect(nodesOf(renderer, roomIntroType)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('keeps the intro at the start of the threaded view', async () => {
    const renderer = await renderRoom(makeRoom(), 'threaded');

    expect(nodesOf(renderer, roomIntroType)).toHaveLength(1);
    expect(nodesOf(renderer, CompactRoomWithoutThreads)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('shows the cards once the room has a thread', async () => {
    const room = makeRoom({ liveEvents: [makeEvent('$root', { isThreadRoot: true })] });
    const renderer = await renderRoom(room, 'compact');

    expect(nodesOf(renderer, compactPlaceholderType)).toHaveLength(1);
    expect(nodesOf(renderer, CompactRoomWithoutThreads)).toHaveLength(0);
    act(() => renderer.unmount());
  });
});
