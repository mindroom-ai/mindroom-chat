import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  roomTimelineVirtualizerState,
  settingsState,
} from '../test-utils/RoomTimeline.test.shared';

const BOB = '@bob:example.org';

const makeThread = (rootId: string, ts: number, replies: ReturnType<typeof makeEvent>[]) => ({
  id: rootId,
  rootEvent: makeEvent(rootId, { isThreadRoot: true, ts }),
  events: replies,
});

// The harness mocks these modules, so they are imported after it.
const mocked = async () => ({
  ...(await import('../../../hooks/useDocumentFocusChange')),
  ...(await import('../../notifications/readReceipts')),
});

const render = async (
  room: ReturnType<typeof makeRoom>,
  props: Record<string, unknown> = {}
): Promise<void> => {
  const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  await act(async () => {
    create(React.createElement(ControlledRoomTimeline, { room, ...props }));
    await flushAsyncWork();
  });
};

describe('RoomTimeline read receipts', () => {
  it('reads only the inline thread replies on screen in the classic view', async () => {
    const offScreen = makeThread('$old-root', 0, [
      makeEvent('$old-reply', { threadRootId: '$old-root', ts: 400, sender: BOB }),
    ]);
    const onScreen = makeThread('$new-root', 300, [
      makeEvent('$new-reply', { threadRootId: '$new-root', ts: 350, sender: BOB }),
    ]);
    const filler = Array.from({ length: 50 }, (_, index) =>
      makeEvent(`$event-${index}`, { ts: index + 1 })
    );
    const latest = [makeEvent('$latest-0', { ts: 500 }), makeEvent('$latest-1', { ts: 501 })];
    const room = makeRoom({
      // Later messages keep the thread's rows inside the window, which counts only room events.
      liveEvents: [offScreen.rootEvent, ...filler, onScreen.rootEvent, ...latest],
      threads: [offScreen, onScreen] as never,
    });
    settingsState.prefetchDepth = 10000;

    const { markThreadAsRead, useDocumentFocusChange } = await mocked();
    await render(room, { initialViewMode: 'classic' });
    // The reader is at the bottom; the rows on screen start at the newest root.
    const { count, getItemKey } = roomTimelineVirtualizerState.lastOptions!;
    const rows = Array.from({ length: count }, (_, index) => getItemKey?.(index));
    Object.assign(roomTimelineVirtualizerState.lastInstance!, {
      range: { startIndex: rows.indexOf('$new-root'), endIndex: rows.length - 1 },
    });
    await act(async () => {
      vi.mocked(useDocumentFocusChange).mock.lastCall![0](true);
      await flushAsyncWork();
    });

    const threadIds = vi.mocked(markThreadAsRead).mock.calls.map(([, , threadId]) => threadId);
    expect(threadIds).toEqual(['$new-root']);
  });
});
