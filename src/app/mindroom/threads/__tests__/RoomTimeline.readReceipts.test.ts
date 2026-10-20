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
  scrollType,
  settingsState,
  virtualPaginatorState,
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

// A 600px list whose composer covers its last 100px, with rows placed by event ID.
const makeScroll = (rowRects: Map<string, { top: number; bottom: number }>) => ({
  isConnected: true,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
  querySelector: (selector: string) => {
    const item = Number(/data-message-item="(\d+)"/.exec(selector)?.[1]);
    const start = virtualPaginatorState.lastOptions!.range.start;
    const rect = rowRects.get(
      String(roomTimelineVirtualizerState.lastOptions!.getItemKey?.(item - start))
    );
    return rect ? { getBoundingClientRect: () => rect } : null;
  },
  querySelectorAll: () => [],
  scrollHeight: 2000,
  clientHeight: 600,
  scrollTop: 1400,
  scrollTo: vi.fn(),
  style: {},
});

const render = async (room: ReturnType<typeof makeRoom>, scroll: ReturnType<typeof makeScroll>) => {
  const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  await act(async () => {
    create(React.createElement(ControlledRoomTimeline, { room, initialViewMode: 'classic' }), {
      createNodeMock: (element: { type: unknown }) => (element.type === scrollType ? scroll : null),
    });
    await flushAsyncWork();
  });
};

describe('RoomTimeline read receipts', () => {
  it('reads only the inline thread replies on screen in classic, not behind the composer', async () => {
    const offScreen = makeThread('$old-root', 0, [
      makeEvent('$old-reply', { threadRootId: '$old-root', ts: 400, sender: BOB }),
    ]);
    const onScreen = makeThread('$new-root', 300, [
      makeEvent('$new-reply', { threadRootId: '$new-root', ts: 350, sender: BOB }),
    ]);
    const behindComposer = makeThread('$last-root', 360, [
      makeEvent('$last-reply', { threadRootId: '$last-root', ts: 370, sender: BOB }),
    ]);
    const filler = Array.from({ length: 50 }, (_, index) =>
      makeEvent(`$event-${index}`, { ts: index + 1 })
    );
    const latest = [0, 1, 2].map((index) => makeEvent(`$latest-${index}`, { ts: 500 + index }));
    const room = makeRoom({
      // Later messages keep the thread rows inside the window, which counts only room events.
      liveEvents: [
        offScreen.rootEvent,
        ...filler,
        onScreen.rootEvent,
        behindComposer.rootEvent,
        ...latest,
      ],
      threads: [offScreen, onScreen, behindComposer] as never,
    });
    settingsState.prefetchDepth = 10000;

    const { markThreadAsRead, useDocumentFocusChange } = await mocked();
    const padding = vi
      .spyOn(globalThis, 'getComputedStyle')
      .mockReturnValue({ scrollPaddingTop: '0px', scrollPaddingBottom: '100px' } as never);
    // The last reply is short and sits wholly behind the composer.
    await render(
      room,
      makeScroll(
        new Map([
          ['$new-root', { top: 300, bottom: 360 }],
          ['$new-reply', { top: 360, bottom: 420 }],
          ['$last-root', { top: 420, bottom: 500 }],
          ['$last-reply', { top: 500, bottom: 540 }],
        ])
      )
    );
    // The reader is at the bottom; the visible range starts at the newest roots.
    const { count, getItemKey } = roomTimelineVirtualizerState.lastOptions!;
    const rows = Array.from({ length: count }, (_, index) => getItemKey?.(index));
    Object.assign(roomTimelineVirtualizerState.lastInstance!, {
      range: { startIndex: rows.indexOf('$new-root'), endIndex: rows.length - 1 },
    });
    await act(async () => {
      vi.mocked(useDocumentFocusChange).mock.lastCall![0](true);
      await flushAsyncWork();
    });

    padding.mockRestore();

    const threadIds = vi.mocked(markThreadAsRead).mock.calls.map(([, , threadId]) => threadId);
    expect(threadIds).toEqual(['$new-root']);
  });
});
