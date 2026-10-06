import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getClickableByText,
  isTimelineAtLiveEndMock,
  makeEvent,
  makeRoom,
  roomTimelineVirtualizerState,
  scrollType,
} from '../test-utils/RoomTimeline.test.shared';

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
  const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
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
  let renderer: ReturnType<typeof create> | undefined;
  isTimelineAtLiveEndMock.mockReturnValue(false);
  await act(async () => {
    renderer = create(
      React.createElement(ControlledRoomTimeline, { room, initialViewMode, ...extra }),
      {
        createNodeMock: (element: { type: string }) => {
          if (element.type === scrollType) return scroll.el;
          return null;
        },
      }
    );
    await flushAsyncWork();
  });
  return { renderer: renderer!, scroll, room, ControlledRoomTimeline, root };
};

describe('RoomTimeline scroll-to-bottom request', () => {
  it('lands on the latest row after a view switch, even once the reader scrolled', async () => {
    const { renderer, scroll } = await setup('classic', {});
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
    const switcher = renderer.root.find(
      (node) => typeof node.props.onViewModeChange === 'function'
    );
    await act(async () => {
      switcher.props.onViewModeChange('threaded');
      await flushAsyncWork();
    });
    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalled();
    renderer.unmount();
  });

  it('lands on the latest row back from compact view, even once the reader scrolled', async () => {
    const { renderer, scroll } = await setup('classic', {});
    await act(async () => {
      getClickableByText(renderer, 'Jump to Latest').props.onClick();
      await flushAsyncWork();
    });
    scroll.fire('wheel');
    const switcher = () =>
      renderer.root.find((node) => typeof node.props.onViewModeChange === 'function');
    await act(async () => {
      switcher().props.onViewModeChange('compact');
      await flushAsyncWork();
    });
    roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
    await act(async () => {
      switcher().props.onViewModeChange('classic');
      await flushAsyncWork();
    });
    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalled();
    renderer.unmount();
  });
});
