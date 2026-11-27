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
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
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

  it('pins a newly opened room to its latest row after a completed focus jump in the previous room', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const roomA = makeRoom({
      roomId: '!room-a:example.org',
      liveEvents: [
        makeEvent('$a1', { roomId: '!room-a:example.org', ts: 1 }),
        makeEvent('$a2', { roomId: '!room-a:example.org', ts: 2 }),
      ],
    });
    const roomB = makeRoom({
      roomId: '!room-b:example.org',
      liveEvents: [
        makeEvent('$b1', { roomId: '!room-b:example.org', ts: 3 }),
        makeEvent('$b2', { roomId: '!room-b:example.org', ts: 4 }),
      ],
    });
    const scroll = makeScroll();
    const threadReturnPlaceRef: { current: RoomRowsPlace | undefined } = {
      current: { roomId: roomA.roomId, eventId: '$a1', offset: 80 },
    };
    const hasAlignPin = (align: 'start' | 'end') =>
      roomTimelineVirtualizerState.scrollToIndexMock.mock.calls.some(
        ([, opts]) => (opts as { align?: string } | undefined)?.align === align
      );

    vi.useFakeTimers();
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room: roomA,
            initialViewMode: 'classic',
            extraProps: { threadReturnPlaceRef },
          }),
          {
            createNodeMock: (element) => (element.type === scrollType ? scroll.el : null),
          }
        );
        await flushAsyncWork();
      });
      expect(hasAlignPin('start')).toBe(true);

      // Let FOCUS_LIFETIME_MS expire so focusItem remains non-null with scrollTo: false.
      await act(async () => {
        vi.advanceTimersByTime(5000);
        await flushAsyncWork();
      });

      roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
      await act(async () => {
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room: roomB,
            initialViewMode: 'classic',
            extraProps: { threadReturnPlaceRef },
          })
        );
        await flushAsyncWork();
      });

      expect(hasAlignPin('end')).toBe(true);
    } finally {
      act(() => renderer?.unmount());
      vi.useRealTimers();
    }
  });

  it('lands on the unread marker when returning to a room after a Compact → Threads switch', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const rootA = makeEvent('$root-a', {
      roomId: '!room-a:example.org',
      isThreadRoot: true,
      ts: 1,
    });
    const replyA = makeEvent('$reply-a', {
      roomId: '!room-a:example.org',
      threadRootId: '$root-a',
      ts: 2,
    });
    const plainA = makeEvent('$plain-a', {
      roomId: '!room-a:example.org',
      sender: '@other:example.org',
      ts: 3,
    });
    const roomA = makeRoom({
      roomId: '!room-a:example.org',
      liveEvents: [rootA, replyA, plainA],
      threads: [{ id: '$root-a', rootEvent: rootA, events: [rootA, replyA] }] as never,
    });
    Object.assign(roomA, { getEventReadUpTo: () => '$root-a' });
    const roomB = makeRoom({
      roomId: '!room-b:example.org',
      liveEvents: [
        makeEvent('$b1', { roomId: '!room-b:example.org', ts: 4 }),
        makeEvent('$b2', { roomId: '!room-b:example.org', ts: 5 }),
      ],
    });
    const scroll = makeScroll();
    const viewModeControl: ViewModeControl = {};
    const hasAlignPin = (align: 'start' | 'end') =>
      roomTimelineVirtualizerState.scrollToIndexMock.mock.calls.some(
        ([, opts]) => (opts as { align?: string } | undefined)?.align === align
      );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room: roomA,
            initialViewMode: 'compact',
            viewModeControl,
          }),
          {
            createNodeMock: (element) => (element.type === scrollType ? scroll.el : null),
          }
        );
        await flushAsyncWork(5);
      });

      // Same-room Compact(A) → Threads(A) suppresses unread opening and pins to latest.
      roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
      scrollToItemMock.mockClear();
      await act(async () => {
        viewModeControl.setViewMode!('threaded');
        await flushAsyncWork();
      });
      expect(scrollToItemMock).not.toHaveBeenCalled();
      expect(hasAlignPin('start')).toBe(false);
      expect(hasAlignPin('end')).toBe(true);

      // Visiting Room B clears the same-room switch suppression.
      await act(async () => {
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room: roomB,
            initialViewMode: 'compact',
            viewModeControl,
          })
        );
        await flushAsyncWork();
      });

      roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
      scrollToItemMock.mockClear();
      // Returning to Room A with unreads lands on the unread marker (align: 'start').
      await act(async () => {
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room: roomA,
            initialViewMode: 'compact',
            viewModeControl,
          })
        );
        await flushAsyncWork();
      });
      expect(hasAlignPin('start')).toBe(true);
      expect(hasAlignPin('end')).toBe(false);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('clears stale return-from-thread focus on Compact unmount so returning to Threads opens at newest', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const root1 = makeEvent('$root1', { isThreadRoot: true, ts: 1 });
    const reply1 = makeEvent('$reply1', { threadRootId: '$root1', ts: 2 });
    const root2 = makeEvent('$root2', { isThreadRoot: true, ts: 3 });
    const room = makeRoom({
      liveEvents: [root1, reply1, root2],
      threads: [
        { id: '$root1', rootEvent: root1, events: [root1, reply1] },
        { id: '$root2', rootEvent: root2, events: [root2] },
      ] as never,
    });
    const scroll = makeScroll();
    const viewModeControl: ViewModeControl = {};
    const threadReturnPlaceRef: { current: RoomRowsPlace | undefined } = {
      current: { roomId: room.roomId, eventId: '$root1', offset: 120 },
    };

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'threaded',
            initialThreadFilterState: createDefaultThreadFilterState(),
            viewModeControl,
            extraProps: { threadReturnPlaceRef },
          }),
          {
            createNodeMock: (element) => (element.type === scrollType ? scroll.el : null),
          }
        );
        await flushAsyncWork();
      });
      // Initial return from thread triggered the focus jump while scrollTo is still active.
      expect(
        roomTimelineVirtualizerState.scrollToIndexMock.mock.calls.some(
          ([, opts]) => (opts as { align?: string } | undefined)?.align === 'start'
        )
      ).toBe(true);

      // Switch to Compact before FOCUS_LIFETIME_MS expires.
      await act(async () => {
        viewModeControl.setViewMode!('compact');
        await flushAsyncWork();
      });

      scrollToItemMock.mockClear();
      scroll.el.scrollTo.mockClear();
      roomTimelineVirtualizerState.scrollToIndexMock.mockClear();

      // Returning to Threads opens at newest (scrollTo({ top: 0 }) in latestAtTop) and does not replay the old focus jump.
      await act(async () => {
        viewModeControl.setViewMode!('threaded');
        await flushAsyncWork();
      });
      expect(scrollToItemMock).not.toHaveBeenCalled();
      expect(roomTimelineVirtualizerState.scrollToIndexMock).not.toHaveBeenCalled();
      expect(scroll.el.scrollTo).toHaveBeenCalledWith({ top: 0 });
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('preserves expanded membership folds and avoids blank hideInitialRows flash across Classic → Compact → Classic', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const m1 = makeEvent('$m1', {
      type: 'm.room.member',
      stateKey: '@u1:example.org',
      content: { membership: 'join' },
      ts: 1,
    });
    const m2 = makeEvent('$m2', {
      type: 'm.room.member',
      stateKey: '@u2:example.org',
      content: { membership: 'join' },
      ts: 2,
    });
    const m3 = makeEvent('$m3', {
      type: 'm.room.member',
      stateKey: '@u3:example.org',
      content: { membership: 'join' },
      ts: 3,
    });
    const root = makeEvent('$root', { isThreadRoot: true, ts: 4 });
    const reply1 = makeEvent('$reply1', { threadRootId: '$root', ts: 5 });
    const room = makeRoom({
      liveEvents: [m1, m2, m3, root, reply1],
      threads: [{ id: '$root', rootEvent: root, events: [root, reply1] }] as never,
    });
    const scroll = makeScroll();
    const viewModeControl: ViewModeControl = {};
    const findMembershipToggle = (r: ReturnType<typeof create>) =>
      r.root.find(
        (node) => node.type === 'button' && typeof node.props['aria-expanded'] === 'boolean'
      );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'classic',
            viewModeControl,
          }),
          {
            createNodeMock: (element) => (element.type === scrollType ? scroll.el : null),
          }
        );
        await flushAsyncWork();
      });

      // Genuine room open keeps automatic fill active (rows hidden until initial geometry settles).
      const initialInner = renderer!.root.findByProps({ 'data-testid': 'room-virtual-inner' });
      expect(initialInner.props.style.visibility).toBe('hidden');

      // Expand the membership fold manually.
      const toggleBefore = findMembershipToggle(renderer!);
      expect(toggleBefore.props['aria-expanded']).toBe(false);
      await act(async () => {
        toggleBefore.props.onClick();
        await flushAsyncWork();
      });
      expect(findMembershipToggle(renderer!).props['aria-expanded']).toBe(true);

      // Switch Classic → Compact (unmounts RoomRowsTimeline).
      await act(async () => {
        viewModeControl.setViewMode!('compact');
        await flushAsyncWork();
      });
      expect(renderer!.root.findAllByProps({ 'data-testid': 'room-virtual-inner' })).toHaveLength(
        0
      );

      // Switch Compact → Classic: fold remains expanded and rows are NOT hidden by automatic fill.
      await act(async () => {
        viewModeControl.setViewMode!('classic');
        await flushAsyncWork();
      });
      const returnedInner = renderer!.root.findByProps({ 'data-testid': 'room-virtual-inner' });
      expect(returnedInner.props.style.visibility).toBeUndefined();
      expect(findMembershipToggle(renderer!).props['aria-expanded']).toBe(true);
    } finally {
      act(() => renderer?.unmount());
    }
  });
});
