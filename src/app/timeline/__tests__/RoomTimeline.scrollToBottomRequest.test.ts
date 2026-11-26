import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getClickableByText,
  isScrollNearBottomMock,
  isTimelineAtLiveEndMock,
  makeEvent,
  makeRoom,
  roomTimelineVirtualizerState,
  scrollToItemMock,
  scrollType,
  virtualPaginatorState,
  type ViewModeControl,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';
import type { RoomRowsPlace } from '../roomTimelineScroll';

const makeScroll = () => {
  const listeners = new Map<string, Set<EventListener>>();
  const el = {
    isConnected: true,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelector: () => null,
    querySelectorAll: () => [],
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 1400,
    scrollTo: vi.fn(),
    style: {},
  };
  return {
    el,
    fire: (type: string) => listeners.get(type)?.forEach((listener) => listener({ type } as Event)),
  };
};

const setup = async (initialViewMode: 'classic' | 'threaded', extra: Record<string, unknown>) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
  const reply1 = makeEvent('$reply1', { threadRootId: '$root', ts: 2 });
  const reply2 = makeEvent('$reply2', { threadRootId: '$root', ts: 3 });
  const plain = makeEvent('$plain', { ts: 4 });
  const room = makeRoom({
    liveEvents: [root, reply1, reply2, plain],
    threads: [{ id: '$root', rootEvent: root, events: [root, reply1, reply2] }] as never,
  });
  const scroll = makeScroll();
  const viewModeControl: ViewModeControl = {};
  let renderer: ReturnType<typeof create> | undefined;
  isTimelineAtLiveEndMock.mockReturnValue(false);
  await act(async () => {
    renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
        initialViewMode,
        viewModeControl,
        ...extra,
      }),
      {
        createNodeMock: (element) => {
          if (element.type === scrollType) return scroll.el;
          return null;
        },
      }
    );
    await flushAsyncWork();
  });
  return {
    renderer: renderer!,
    scroll,
    room,
    ControlledRoomTimeline,
    root,
    setViewMode: viewModeControl.setViewMode!,
  };
};

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline scroll-to-bottom request', () => {
  it('lands on the latest row after a view switch, even once the reader scrolled', async () => {
    const { renderer, scroll, setViewMode } = await setup('classic', {});
    // Request: Jump to Latest.
    await act(async () => {
      getClickableByText(renderer, 'Jump to Latest').props.onClick();
      await flushAsyncWork();
    });
    const afterJump = roomTimelineVirtualizerState.scrollToIndexMock.mock.calls.length;
    expect(afterJump).toBeGreaterThan(0);
    // The reader scrolls, which ends the Jump to Latest request.
    scroll.fire('wheel');
    roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
    await act(async () => {
      setViewMode('threaded');
      await flushAsyncWork();
    });
    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalled();
    renderer.unmount();
  });

  it('lands on the latest row back from compact view, even once the reader scrolled', async () => {
    const { renderer, scroll, setViewMode } = await setup('classic', {});
    await act(async () => {
      getClickableByText(renderer, 'Jump to Latest').props.onClick();
      await flushAsyncWork();
    });
    scroll.fire('wheel');
    await act(async () => {
      setViewMode('compact');
      await flushAsyncWork();
    });
    roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
    await act(async () => {
      setViewMode('classic');
      await flushAsyncWork();
    });
    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalled();
    renderer.unmount();
  });

  it('does not move a reader who scrolled when the window is rebuilt', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const room = makeRoom({ liveEvents: [makeEvent('$a', { ts: 1 }), makeEvent('$b', { ts: 2 })] });
    const scroll = makeScroll();
    isTimelineAtLiveEndMock.mockReturnValue(false);
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, { room, initialViewMode: 'classic' }),
        {
          createNodeMock: (element) => (element.type === scrollType ? scroll.el : null),
        }
      );
      await flushAsyncWork();
    });
    await act(async () => {
      getClickableByText(renderer!, 'Jump to Latest').props.onClick();
      await flushAsyncWork();
    });
    scroll.fire('wheel');
    roomTimelineVirtualizerState.scrollToIndexMock.mockClear();

    // A rebuilt window moves the latest row's index; no new request was made.
    (room.getLiveTimeline().getEvents() as unknown[]).push(makeEvent('$c', { ts: 3 }));
    await act(async () => {
      room.__listeners.get('Room.TimelineRefresh')?.(room);
      await flushAsyncWork();
    });

    expect(roomTimelineVirtualizerState.scrollToIndexMock).not.toHaveBeenCalled();
    renderer!.unmount();
  });

  it('keeps the reader where they scrolled after a view switch that never commits', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    // A sibling suspends the threaded view, so React renders it but never commits.
    function SuspendThreaded({ viewMode }: { viewMode: string }) {
      if (viewMode === 'threaded') throw new Promise(() => {});
      return null;
    }
    const Timeline = (props: Record<string, unknown>) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(RoomTimeline as never, props),
        React.createElement(SuspendThreaded, props as { viewMode: string })
      );
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(Timeline as never);
    const room = makeRoom({ liveEvents: [makeEvent('$a', { ts: 1 }), makeEvent('$b', { ts: 2 })] });
    const scroll = makeScroll();
    isTimelineAtLiveEndMock.mockReturnValue(false);
    const viewModeControl: ViewModeControl = {};
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'classic',
            viewModeControl,
          })
        ),
        {
          unstable_isConcurrent: true,
          createNodeMock: (element) => (element.type === scrollType ? scroll.el : null),
        } as Parameters<typeof create>[1]
      );
      await flushAsyncWork();
    });
    await act(async () => {
      getClickableByText(renderer!, 'Jump to Latest').props.onClick();
      await flushAsyncWork();
    });
    scroll.fire('wheel');
    await act(async () => {
      React.startTransition(() => viewModeControl.setViewMode!('threaded'));
      await flushAsyncWork();
    });
    await act(async () => {
      viewModeControl.setViewMode!('classic');
      await flushAsyncWork();
    });
    roomTimelineVirtualizerState.scrollToIndexMock.mockClear();

    await act(async () => {
      virtualPaginatorState.lastOptions?.onRangeChange({ start: 1, end: 2 });
      await flushAsyncWork();
    });

    expect(roomTimelineVirtualizerState.scrollToIndexMock).not.toHaveBeenCalled();
    renderer!.unmount();
  });

  it('preserves return place, live-end pin with unread, and expansion state across Threads -> Compact -> Threads', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply1 = makeEvent('$reply1', { threadRootId: '$root', ts: 2 });
    const plain = makeEvent('$plain', { sender: '@other:example.org', ts: 4 });
    const room = makeRoom({
      liveEvents: [root, reply1, plain],
      threads: [{ id: '$root', rootEvent: root, events: [root, reply1] }] as never,
    });
    // Mark $root as read so $plain is unread in the live timeline (opensAtLatest === false).
    Object.assign(room, { getEventReadUpTo: () => '$root' });

    const scroll = makeScroll();
    // Simulate a scrolled-up position with a visible old row so any bogus unmount save would record it.
    scroll.el.scrollTop = 100;
    isScrollNearBottomMock.mockImplementation(
      (metrics) => !metrics || metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= 96
    );
    const oldRowNode = {
      dataset: { messageId: '$root' },
      getAttribute: (name: string) => (name === 'data-message-id' ? '$root' : null),
      getBoundingClientRect: () => ({ top: 120, bottom: 200 }),
    };
    scroll.el.querySelectorAll = (() => [
      oldRowNode,
    ]) as unknown as typeof scroll.el.querySelectorAll;

    const threadReturnPlaceRef: { current: RoomRowsPlace | undefined } = { current: undefined };
    const viewModeControl: ViewModeControl = {};
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          initialViewMode: 'threaded',
          viewModeControl,
          extraProps: { threadReturnPlaceRef },
        }),
        {
          createNodeMock: (element) => (element.type === scrollType ? scroll.el : null),
        }
      );
      await flushAsyncWork();
    });

    // Initial mount with unread info opens at the unread marker (align: 'start'), not pinned to latest (align: 'end').
    const hasEndPin = () =>
      roomTimelineVirtualizerState.scrollToIndexMock.mock.calls.some(
        ([, opts]) => (opts as { align?: string } | undefined)?.align === 'end'
      );
    expect(hasEndPin()).toBe(false);

    // Toggle Expand All on and record a per-message manual override.
    const findExpansionProvider = () =>
      renderer!.root.find(
        (node) =>
          typeof node.props.expandAllInit === 'boolean' &&
          node.props.manualExpansionState instanceof Map
      );
    expect(findExpansionProvider().props.expandAllInit).toBe(false);
    await act(async () => {
      getClickableByText(renderer!, '[+all]').props.onClick({ preventDefault: vi.fn() });
      await flushAsyncWork();
    });
    const beforeSwitchProvider = findExpansionProvider();
    expect(beforeSwitchProvider.props.expandAllInit).toBe(true);
    const manualMap = beforeSwitchProvider.props.manualExpansionState as Map<string, boolean>;
    manualMap.set('$plain', false);

    // Switch Threads (scrolled up) -> Compact.
    await act(async () => {
      viewModeControl.setViewMode!('compact');
      await flushAsyncWork();
    });
    // Switching to Compact must NOT save a bogus threadReturnPlace.
    expect(threadReturnPlaceRef.current).toBeUndefined();

    roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
    scrollToItemMock.mockClear();

    // Switch Compact -> Threads: must pin to latest (even with unread!), never jump back to $root,
    // and preserve both expandAll and the manual per-message expansion choice.
    await act(async () => {
      viewModeControl.setViewMode!('threaded');
      await flushAsyncWork();
    });
    expect(threadReturnPlaceRef.current).toBeUndefined();
    expect(scrollToItemMock).not.toHaveBeenCalled();
    expect(hasEndPin()).toBe(true);
    const afterSwitchProvider = findExpansionProvider();
    expect(afterSwitchProvider.props.expandAllInit).toBe(true);
    expect(afterSwitchProvider.props.manualExpansionState).toBe(manualMap);
    expect(
      (afterSwitchProvider.props.manualExpansionState as Map<string, boolean>).get('$plain')
    ).toBe(false);

    // Real RoomSurface unmount (e.g. opening a thread while scrolled up) still saves return place.
    await act(async () => {
      renderer!.unmount();
    });
    expect(threadReturnPlaceRef.current).toEqual({
      roomId: room.roomId,
      eventId: '$root',
      offset: 120,
    });
  });
});
