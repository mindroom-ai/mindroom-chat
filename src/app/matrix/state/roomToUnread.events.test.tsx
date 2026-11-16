// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { ClientEvent, MatrixEvent, ReceiptType, RoomEvent } from 'matrix-js-sdk';
import { synthesizeReceipt } from 'matrix-js-sdk/lib/models/read-receipt';
import { describe, expect, it, vi } from 'vitest';
import { roomToUnreadAtom, sendOwnReceipt, useBindRoomToUnreadAtom } from './roomToUnread';

const USER_ID = '@reader:example.org';
const THREAD_ID = '$root';

const message = (eventId: string, roomId: string) =>
  new MatrixEvent({
    content: { body: eventId, msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: roomId,
    sender: '@writer:example.org',
    type: 'm.room.message',
  });

/** A room whose counts, membership and loaded messages the test changes. */
const makeRoom = (roomId = '!desk:example.org') => {
  const state = {
    main: { total: 0, highlight: 0 },
    thread: { total: 0, highlight: 0 },
    membership: 'join',
    events: [] as MatrixEvent[],
  };
  const room = Object.assign(new EventEmitter(), {
    roomId,
    state,
    findEventById: () => undefined,
    getMyMembership: () => state.membership,
    isSpaceRoom: () => false,
    getUnreadNotificationCount: vi.fn(
      (type: 'total' | 'highlight' = 'total') => state.main[type] + state.thread[type]
    ),
    getRoomUnreadNotificationCount: (type: 'total' | 'highlight' = 'total') => state.main[type],
    getThreadUnreadNotificationCount: (threadId: string, type: 'total' | 'highlight' = 'total') =>
      threadId === THREAD_ID ? state.thread[type] : 0,
    getLiveTimeline: () => ({ getEvents: () => state.events }),
    getEventReadUpTo: () => null,
    getThread: () => null,
  });
  return room;
};

type TestRoom = ReturnType<typeof makeRoom>;

const setUp = (rooms: TestRoom[] = [makeRoom()]) => {
  const mx = Object.assign(new EventEmitter(), {
    getRooms: () => rooms,
    getUserId: () => USER_ID,
    getPushActionsForEvent: () => ({ notify: true }),
    getAccountData: () => undefined,
    getRoomPushRule: () => undefined,
    pushRules: undefined,
  });
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { unmount } = renderHook(() => useBindRoomToUnreadAtom(mx as never), { wrapper });
  const [room] = rooms;
  if (!room) throw new Error('no room');
  const entry = (roomId = room.roomId) => store.get(roomToUnreadAtom).get(roomId);
  return { mx, room, entry, unmount };
};

/** Lets the recount that waits for the end of a burst of count changes run. */
const afterCounts = () => Promise.resolve();

describe('useBindRoomToUnreadAtom', () => {
  it('lists a room for a new message without a count, at once', () => {
    const { mx, room, entry } = setUp();
    expect(entry()).toBeUndefined();
    const event = message('$new', room.roomId);
    room.state.events = [event];
    mx.emit(RoomEvent.Timeline, event, room, false, false, { liveEvent: true });
    expect(entry()).toEqual({ total: 0, highlight: 0 });
  });

  it('counts the room again when the server changes its notification count', async () => {
    const { room, entry } = setUp();
    room.state.main.total = 2;
    room.emit(RoomEvent.UnreadNotifications, room.state.main);
    await afterCounts();
    expect(entry()).toEqual({ total: 2, highlight: 0 });
  });

  it('counts the room again when its highlight count changes', async () => {
    const room = makeRoom();
    room.state.main.total = 1;
    const { entry } = setUp([room]);
    expect(entry()).toEqual({ total: 1, highlight: 0 });
    room.state.main.highlight = 1;
    room.emit(RoomEvent.UnreadNotifications, room.state.main);
    await afterCounts();
    expect(entry()).toEqual({ total: 1, highlight: 1 });
  });

  it('counts the room again when the counts of a thread change, and when they are reset', async () => {
    const { room, entry } = setUp();
    room.state.thread = { total: 3, highlight: 1 };
    room.emit(RoomEvent.UnreadNotifications, room.state.thread, THREAD_ID);
    await afterCounts();
    expect(entry()).toEqual({ total: 3, highlight: 1 });

    // The SDK's reset before a sync's thread counts has no arguments.
    room.state.thread = { total: 0, highlight: 0 };
    room.emit(RoomEvent.UnreadNotifications);
    await afterCounts();
    expect(entry()).toBeUndefined();
  });

  it('counts the room once for a burst of count changes, with the last counts', async () => {
    const { room, entry } = setUp();
    room.getUnreadNotificationCount.mockClear();
    const queued = vi.spyOn(globalThis, 'queueMicrotask');
    for (let total = 1; total <= 100; total += 1) {
      room.state.thread.total = total;
      room.emit(RoomEvent.UnreadNotifications, room.state.thread, THREAD_ID);
    }
    await afterCounts();
    expect(entry()).toEqual({ total: 100, highlight: 0 });
    // One count: the total and the highlights.
    expect(room.getUnreadNotificationCount).toHaveBeenCalledTimes(2);
    // A sync of a room with hundreds of threads announces a thousand changes.
    expect(queued).toHaveBeenCalledTimes(1);
    queued.mockRestore();

    room.state.thread.total = 101;
    room.emit(RoomEvent.UnreadNotifications, room.state.thread, THREAD_ID);
    await afterCounts();
    expect(entry()).toEqual({ total: 101, highlight: 0 });
  });

  it('counts the room again for a count change after a new message in the same task', async () => {
    const { mx, room, entry } = setUp();
    room.state.main.total = 1;
    room.emit(RoomEvent.UnreadNotifications, room.state.main);
    mx.emit(RoomEvent.Timeline, message('$new', room.roomId), room, false, false, {
      liveEvent: true,
    });
    expect(entry()).toEqual({ total: 1, highlight: 0 });
    room.state.main.total = 2;
    room.emit(RoomEvent.UnreadNotifications, room.state.main);
    await afterCounts();
    expect(entry()).toEqual({ total: 2, highlight: 0 });
  });

  it('keeps the counts a receipt of this client lowered after a count change before it', async () => {
    // Sending a receipt, the SDK sets the highlight count before it announces the receipt.
    const { mx, room, entry } = setUp();
    room.state.main.total = 3;
    room.state.thread.total = 2;
    sendOwnReceipt(() => {
      room.emit(RoomEvent.UnreadNotifications, room.state.main);
      const receipt = synthesizeReceipt(USER_ID, message('$read', room.roomId), ReceiptType.Read);
      mx.emit(RoomEvent.Receipt, receipt, room);
    });
    expect(entry()).toEqual({ total: 2, highlight: 0 });
    await afterCounts();
    expect(entry()).toEqual({ total: 2, highlight: 0 });
  });

  it('counts the room again for a receipt of the user from a sync, at once', () => {
    const { mx, room, entry } = setUp();
    room.state.main.total = 4;
    const receipt = synthesizeReceipt(USER_ID, message('$read', room.roomId), ReceiptType.Read);
    mx.emit(RoomEvent.Receipt, receipt, room);
    expect(entry()).toEqual({ total: 4, highlight: 0 });
  });

  it('drops the room when the user leaves it and lists it again on a join, at once', () => {
    const room = makeRoom();
    room.state.main.total = 1;
    const { mx, entry } = setUp([room]);
    expect(entry()).toEqual({ total: 1, highlight: 0 });
    room.state.membership = 'leave';
    mx.emit(RoomEvent.MyMembership, room, 'leave');
    expect(entry()).toBeUndefined();
    room.state.membership = 'join';
    mx.emit(RoomEvent.MyMembership, room, 'join');
    expect(entry()).toEqual({ total: 1, highlight: 0 });
  });

  it('watches the counts of a room that arrives later', async () => {
    const { mx, entry } = setUp();
    const later = makeRoom('!later:example.org');
    later.state.main.total = 1;
    mx.emit(ClientEvent.Room, later);
    expect(entry(later.roomId)).toEqual({ total: 1, highlight: 0 });
    later.state.main.total = 2;
    later.emit(RoomEvent.UnreadNotifications, later.state.main);
    await afterCounts();
    expect(entry(later.roomId)).toEqual({ total: 2, highlight: 0 });
  });

  it('leaves a deleted room out after a count change before the deletion', async () => {
    const { mx, room, entry } = setUp();
    room.state.main.total = 1;
    room.emit(RoomEvent.UnreadNotifications, room.state.main);
    mx.emit(ClientEvent.DeleteRoom, room.roomId);
    await afterCounts();
    expect(entry()).toBeUndefined();
  });

  it('counts nothing after it stops', async () => {
    const { room, entry, unmount } = setUp();
    room.state.main.total = 1;
    room.emit(RoomEvent.UnreadNotifications, room.state.main);
    unmount();
    await afterCounts();
    expect(entry()).toBeUndefined();
  });
});
