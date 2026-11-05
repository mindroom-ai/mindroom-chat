import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getClickableByText,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomUnreadState,
  wrapWithSyncEngine,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test-utils/importBeforeTests';

type TestRoom = ReturnType<typeof makeRoom>;

/** A room whose read marker is an event further back than its live timeline. */
const makeRoomWithOlderReadMarker = (roomId: string) => {
  const older = makeEvent(`$older-${roomId}`, { ts: 1 });
  const room = makeRoom({
    liveEvents: [makeEvent(`$latest-${roomId}`, { ts: 10 })],
    timelinesByEventId: new Map([[older.getId(), makeTimeline([older])]]),
  });
  room.roomId = roomId;
  // The harness room has read nothing; this one has read up to the older event.
  Object.assign(room, { getEventReadUpTo: () => older.getId() });
  return room;
};

const makeReadRoom = (roomId: string) => {
  const room = makeRoom({ liveEvents: [makeEvent(`$latest-${roomId}`, { ts: 10 })] });
  room.roomId = roomId;
  return room;
};

const findJumpToUnread = (renderer: ReturnType<typeof create>) => {
  try {
    return getClickableByText(renderer, 'Jump to Unread');
  } catch {
    return undefined;
  }
};

const renderTimeline = async (room: TestRoom, threadId?: string) => {
  const { RoomTimeline } = await import('../MindroomRoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(React.createElement(ControlledRoomTimeline, { room, threadId }));
    await flushAsyncWork(1);
  });
  const show = async (next: TestRoom) => {
    await act(async () => {
      renderer?.update(React.createElement(ControlledRoomTimeline, { room: next }));
      await flushAsyncWork(1);
    });
  };
  return { renderer: renderer!, show };
};

importBeforeTests(() => import('../MindroomRoomTimeline'));

describe('RoomTimeline across room switches', () => {
  it("does not carry one room's Jump to Unread into the next room", async () => {
    roomUnreadState.value = true;
    const { renderer, show } = await renderTimeline(makeRoomWithOlderReadMarker('!a:test'));
    expect(findJumpToUnread(renderer)).toBeDefined();

    roomUnreadState.value = false;
    await show(makeReadRoom('!b:test'));

    expect(findJumpToUnread(renderer)).toBeUndefined();
    act(() => renderer.unmount());
  });

  it("reads the next room's own read marker", async () => {
    roomUnreadState.value = false;
    const { renderer, show } = await renderTimeline(makeReadRoom('!a:test'));
    expect(findJumpToUnread(renderer)).toBeUndefined();

    roomUnreadState.value = true;
    await show(makeRoomWithOlderReadMarker('!b:test'));

    expect(findJumpToUnread(renderer)).toBeDefined();
    act(() => renderer.unmount());
  });

  it('drops Jump to Unread once the reader marks the room as read', async () => {
    roomUnreadState.value = true;
    const { renderer } = await renderTimeline(makeRoomWithOlderReadMarker('!a:test'));
    const markAsRead = getClickableByText(renderer, 'Mark as Read');

    roomUnreadState.value = false;
    await act(async () => {
      markAsRead.props.onClick();
      await flushAsyncWork(1);
    });

    expect(findJumpToUnread(renderer)).toBeUndefined();
    act(() => renderer.unmount());
  });

  it('leaves the room focus to the room view, which skips unsent thread roots', async () => {
    const engine = wrapWithSyncEngine(React.createElement('div')).props.engine as {
      noteRoomFocused: (roomId: string, threadId?: string) => void;
    };
    const noteRoomFocused = vi.spyOn(engine, 'noteRoomFocused');
    const { renderer } = await renderTimeline(makeReadRoom('!a:test'), '~!a:test:txn-root');

    expect(noteRoomFocused).not.toHaveBeenCalled();
    noteRoomFocused.mockRestore();
    act(() => renderer.unmount());
  });
});
