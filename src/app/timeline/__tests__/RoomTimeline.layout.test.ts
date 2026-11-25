import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomIntroType,
  scrollType,
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

  it('shows the minimap only inside a thread', async () => {
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

  it('renders threadHeader directly inside ThreadTimelineHeader while keeping Scroll size="300"', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { ThreadTimelineHeader } = await import('../../threads/ThreadTimelineHeader');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const threadRoot = makeEvent('$thread-root');
    threadRenderStateMock.threadEvents = [threadRoot];
    const room = makeRoom({ liveEvents: [threadRoot] });
    const threadHeader = React.createElement('section', {
      'data-testid': 'example-thread-banner',
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: '$thread-root',
            extraProps: { threadHeader },
          })
        );
        await flushAsyncWork(1);
      });

      const header = renderer!.root.findByType(ThreadTimelineHeader);
      expect(header.props.children).toBe(threadHeader);

      const bannerNode = header.findByProps({ 'data-testid': 'example-thread-banner' });
      const headerContent = bannerNode.parent;
      expect(headerContent?.type).toBe('div');
      expect(headerContent?.props.style?.display).toBe('flow-root');
      expect(headerContent?.props.style?.paddingInlineEnd).toBeUndefined();
      expect(headerContent?.props.style?.paddingRight).toBeUndefined();

      // Keeps folds' 8px inline-end gutter on the scroller so message hover toolbars stay clear of InsetScrollbar.
      const scroll = renderer!.root.findByType(scrollType);
      expect(scroll.props.size).toBe('300');
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('renders the room intro before the [+all] toggle inside item 0, and keeps the outer toggle without an intro', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { ExpandAllLine } = await import('../RoomTimelineOverlays');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const readOrder = (renderer: ReturnType<typeof create>) =>
      renderer.root
        .findAll((node) => node.type === roomIntroType || node.type === ExpandAllLine)
        .map((node) => (node.type === roomIntroType ? 'intro' : 'toggle'));

    // At the start of an oldest-first room (no back token): intro and toggle render together in order.
    const roomAtStart = makeRoom({ liveEvents: [makeEvent('$m1')] });
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room: roomAtStart }));
        await flushAsyncWork(1);
      });
      expect(readOrder(renderer!)).toEqual(['intro', 'toggle']);
      const virtualInner = renderer!.root.findByProps({ 'data-testid': 'room-virtual-inner' });
      expect(virtualInner.findAllByType(ExpandAllLine)).toHaveLength(1);

      // When older history can still paginate back (no intro), only the outer toggle renders.
      const roomMidHistory = makeRoom({
        liveTimeline: makeTimeline([makeEvent('$m2')], { backwardToken: 'tok-back' }),
      });
      await act(async () => {
        renderer!.update(React.createElement(ControlledRoomTimeline, { room: roomMidHistory }));
        await flushAsyncWork(1);
      });
      expect(readOrder(renderer!)).toEqual(['toggle']);
      const virtualInnerMid = renderer!.root.findByProps({ 'data-testid': 'room-virtual-inner' });
      expect(virtualInnerMid.findAllByType(ExpandAllLine)).toHaveLength(0);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('includes the [+all] toggle height in the room intro estimate when rows exist', async () => {
    const { ROOM_INTRO_ESTIMATE_PX, timelineRowSizing } = await import('../roomTimelineRows');
    const row = makeEvent('$m1') as never;
    const base = {
      threadId: undefined,
      compactLayout: false,
      showThreadRepliesInRoom: true,
      threadEvents: [],
      hasRoomIntro: true,
      windowStart: 0,
      roomRowsRef: { current: [row] },
      activeRangeRef: { current: { start: 0, end: 1 } },
      threadRecordMapRef: { current: new Map() },
    };
    const withRows = timelineRowSizing({ ...base, roomWindowRows: [row] });
    const empty = timelineRowSizing({ ...base, roomWindowRows: [] });
    expect(empty.estimateSize(0)).toBe(ROOM_INTRO_ESTIMATE_PX);
    expect(withRows.estimateSize(0)).toBeGreaterThan(ROOM_INTRO_ESTIMATE_PX);
  });
});
