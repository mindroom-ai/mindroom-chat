import React from 'react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  useRoomTimelineNavigationController,
  type RoomTimelineNavigationControllerOptions,
} from './roomTimelineNavigationController';
import { placeClassicWindow } from './roomTimelineClassicRows';
import type { Timeline } from '../event-store/timeline/timelinePagination';

type Controller = ReturnType<typeof useRoomTimelineNavigationController>;

const renderController = (overrides: Partial<RoomTimelineNavigationControllerOptions>) => {
  const options: RoomTimelineNavigationControllerOptions = {
    handleOpenEvent: vi.fn(),
    hideMembershipEvents: false,
    hideNickAvatarEvents: false,
    ignoredUsersSet: new Set(),
    navigateRoom: vi.fn(),
    navigateRoomThread: vi.fn(),
    room: { roomId: '!room:example.org' } as Room,
    prefetchDepth: 0,
    scrollToBottomRef: { current: { count: 0, smooth: true } },
    setAtBottom: vi.fn(),
    setTimeline: vi.fn(),
    showHiddenEvents: false,
    threadId: '$root',
    ...overrides,
  };
  let controller: Controller | undefined;
  function Harness() {
    controller = useRoomTimelineNavigationController(options);
    return null;
  }
  act(() => {
    create(React.createElement(Harness));
  });
  return { controller: controller as Controller, options };
};

describe('useRoomTimelineNavigationController', () => {
  it('replaces an anchored Classic window with the newest rows including thread replies', async () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: '@reader:example.org' });
    const room = new Room('!room:example.org', mx, '@reader:example.org');
    const events = ['$a', '$b', '$root'].map((eventId, index) => new MatrixEvent({
      event_id: eventId,
      room_id: room.roomId,
      sender: '@reader:example.org',
      type: 'm.room.message',
      origin_server_ts: index,
      content: { msgtype: 'm.text', body: eventId },
    }));
    await room.addLiveEvents(events, { addToState: false });
    const range = { start: 0, end: 3 };
    const previous = {
      source: range, range, chain: [room.getLiveTimeline()], firstRowId: '$a',
    };
    // Room history has three rows; Classic adds two inline replies after the root.
    const rows = [...events, ...['$reply1', '$newest'].map((eventId) => new MatrixEvent({
      event_id: eventId,
    }))].map((event, absoluteIndex) => ({ event, absoluteIndex }));
    let jumped: Timeline | undefined;
    const { controller } = renderController({
      room, threadId: undefined, showThreadRepliesInRoom: true, prefetchDepth: 3,
      setTimeline: (next) => { if (typeof next !== 'function') jumped = next; },
    });

    controller.handleJumpToLatest();

    if (!jumped) throw new Error('Jump did not set a room window');
    const placed = placeClassicWindow(previous, jumped, rows, 3);
    expect(rows.slice(placed.start, placed.end).map(({ event }) => event.getId())).toEqual([
      '$root', '$reply1', '$newest',
    ]);
  });

  it('pins a thread to its newest reply synchronously on Jump to Latest', () => {
    const { controller, options } = renderController({});

    const result: unknown = controller.handleJumpToLatest();

    // Nothing is awaited: older-history loading must not gate the jump.
    expect(result).toBeUndefined();
    expect(options.scrollToBottomRef.current).toEqual({ count: 1, smooth: false });
    expect(options.setAtBottom).toHaveBeenCalledWith(true);
    expect(options.navigateRoomThread).not.toHaveBeenCalled();
    expect(options.setTimeline).not.toHaveBeenCalled();
  });

  it('drops a thread permalink before pinning', () => {
    const { controller, options } = renderController({ eventId: '$reply' });

    controller.handleJumpToLatest();

    expect(options.navigateRoomThread).toHaveBeenCalledWith(
      '!room:example.org',
      '$root',
      undefined,
      {
        replace: true,
      }
    );
    expect(options.scrollToBottomRef.current.count).toBe(1);
    expect(options.setAtBottom).toHaveBeenCalledWith(true);
  });
});
