// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { MatrixEvent, ReceiptType, RelationType, RoomEvent } from 'matrix-js-sdk';
import { synthesizeReceipt } from 'matrix-js-sdk/lib/models/read-receipt';
import { describe, expect, it } from 'vitest';
import { roomToUnreadAtom, sendOwnReceipt, useBindRoomToUnreadAtom } from './roomToUnread';

const ROOM_ID = '!desk:example.org';
const ROOT_ID = '$root';
const USER_ID = '@reader:example.org';

const threadReply = (eventId: string, sender: string, ts: number) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
      'm.relates_to': { event_id: ROOT_ID, rel_type: RelationType.Thread },
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
  });

/** A room whose thread the server counts 2 unread replies in, beside 3 in the main timeline. */
const makeRoom = () =>
  Object.assign(new EventEmitter(), {
    roomId: ROOM_ID,
    getMyMembership: () => 'join',
    isSpaceRoom: () => false,
    getUnreadNotificationCount: (type = 'total') => (type === 'highlight' ? 0 : 5),
    getRoomUnreadNotificationCount: (type = 'total') => (type === 'highlight' ? 0 : 3),
    getThreadUnreadNotificationCount: (threadId: string, type = 'total') =>
      threadId === ROOT_ID && type !== 'highlight' ? 2 : 0,
  });

const setUp = () => {
  const room = makeRoom();
  const mx = Object.assign(new EventEmitter(), {
    getRooms: () => [room],
    getUserId: () => USER_ID,
  });
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  renderHook(() => useBindRoomToUnreadAtom(mx as never), { wrapper });
  const total = () => store.get(roomToUnreadAtom).get(ROOM_ID)?.total;
  const emitReceipt = (event: MatrixEvent) =>
    mx.emit(RoomEvent.Receipt, synthesizeReceipt(USER_ID, event, ReceiptType.Read), room);
  return { total, emitReceipt };
};

describe('useBindRoomToUnreadAtom receipts', () => {
  it('lowers the counts for a receipt this client sends', () => {
    const { total, emitReceipt } = setUp();
    expect(total()).toBe(5);
    sendOwnReceipt(() => emitReceipt(threadReply('$newest', '@writer:example.org', 3)));
    expect(total()).toBe(3);
  });

  it('keeps the counts for a receipt the SDK makes up on an older reply of the user', () => {
    // Loading the thread, the SDK gives the user a receipt on their own reply, which two
    // replies of someone else's follow.
    const { total, emitReceipt } = setUp();
    emitReceipt(threadReply('$own', USER_ID, 1));
    expect(total()).toBe(5);
  });
});
