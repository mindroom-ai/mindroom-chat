import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const findTimelineContentBox = (renderer: ReturnType<typeof create>) => {
  const matches = renderer.root.findAll(
    (node) => node.type === 'div' && node.props.style?.minHeight === '100%'
  );
  expect(matches).toHaveLength(1);
  return matches[0];
};

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline layout', () => {
  it('top-aligns short active thread timelines', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const threadRoot = makeEvent('$thread-root');
    threadRenderStateMock.threadEvents = [threadRoot];
    const room = makeRoom({ liveEvents: [threadRoot] });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          threadId: '$thread-root',
        })
      );
      await flushAsyncWork(1);
    });

    expect(findTimelineContentBox(renderer!)!.props.justifyContent).toBe('Start');
  });

  it('keeps normal room timelines bottom-aligned', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const room = makeRoom({ liveEvents: [makeEvent('$message')] });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(findTimelineContentBox(renderer!)!.props.justifyContent).toBe('End');
  });

  it('shows the minimap only inside a thread with a fine pointer', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    const root = makeEvent('$root', { isThreadRoot: true });
    const reply = makeEvent('$reply', { threadRootId: '$root' });
    const room = makeRoom({ liveEvents: [root, makeEvent('$message')] });
    threadRenderStateMock.threadEvents = [root, reply];
    const mediaQuery = window.matchMedia('(pointer: fine)');
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...mediaQuery,
      matches: query === '(pointer: fine)',
    }));
    let renderer: ReturnType<typeof create> | undefined;
    const hasMinimap = () =>
      renderer!.root.findAllByProps({ 'data-testid': 'timeline-minimap' }).length > 0;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, { room }));
        await flushAsyncWork(1);
      });
      expect(hasMinimap()).toBe(false);

      await act(async () => {
        renderer!.update(React.createElement(Harness, { room, threadId: '$root' }));
        await flushAsyncWork(1);
      });
      expect(hasMinimap()).toBe(true);
    } finally {
      act(() => renderer?.unmount());
      matchMedia.mockRestore();
    }
  });
});
