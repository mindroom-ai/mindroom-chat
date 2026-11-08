/**
 * Unread state per room, and per Space the sum over the rooms it contains (at any depth).
 * A room is listed while it has notification counts or an unread message by someone else in
 * its main timeline (shown as a dot without a count, unless the room is muted); thread activity
 * alone does not list it, and neither do notices that the thread lists of a room with an agent
 * leave out, or main-timeline counts for roots the user opened on this device
 * (`isMainTimelineMessageUnread`, `isMainUnreadCountRead`).
 */
import { useEffect } from 'react';
import { atom, type WritableAtom, useSetAtom } from 'jotai';
import {
  ClientEvent,
  EventType,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  NotificationCountType,
  type Room,
  RoomEvent,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import type { RoomToUnread, Unread, UnreadInfo } from '../types/room';
import { getUnreadInfo, isMainUnreadCountRead, roomHaveUnread } from '../room';
import { isRecord } from '../../lib/isRecord';
import { chatRoomParentsAtom, roomToParentsAtom } from './roomToParents';
import { matchesEnum } from '../../lib/matchesEnum';
import { getAncestorSpaceIds } from './spaceAncestors';
import { isRoomMuted } from '../hooks/useRoomsNotificationPreferences';

type RoomToUnreadAction =
  | { type: 'RESET'; unreadInfos: UnreadInfo[] }
  | { type: 'PUT'; unreadInfo: UnreadInfo }
  | { type: 'DELETE'; roomId: string };

type RoomToUnreadAtom = WritableAtom<RoomToUnread, [RoomToUnreadAction], void>;

type RoomUnread = Pick<Unread, 'total' | 'highlight'>;

const roomUnreadsAtom = atom<Map<string, RoomUnread>>(new Map());

/** Room unread entries plus one aggregate per Space, whose `from` lists the rooms counted. */
export const roomToUnreadAtom: RoomToUnreadAtom = atom<RoomToUnread, [RoomToUnreadAction], void>(
  (get) => {
    const roomUnreads = get(roomUnreadsAtom);
    const roomToParents = get(roomToParentsAtom);
    const chatRooms = get(chatRoomParentsAtom);
    const result: RoomToUnread = new Map(roomUnreads);
    const spaces = new Map<string, Required<Unread>>();

    roomUnreads.forEach((unread, roomId) => {
      getAncestorSpaceIds(roomToParents, roomId)
        // The chat rooms a sub-room sits under keep their own counts; only Spaces sum them up.
        .filter((id) => !chatRooms.has(id))
        .forEach((spaceId) => {
          const space = spaces.get(spaceId) ?? { total: 0, highlight: 0, from: new Set<string>() };
          space.total += unread.total;
          space.highlight += unread.highlight;
          space.from.add(roomId);
          spaces.set(spaceId, space);
        });
    });
    spaces.forEach((space, spaceId) => result.set(spaceId, space));
    return result;
  },
  (get, set, action) => {
    const current = get(roomUnreadsAtom);
    if (action.type === 'RESET') {
      set(
        roomUnreadsAtom,
        new Map(
          action.unreadInfos.map(({ roomId, total, highlight }) => [roomId, { total, highlight }])
        )
      );
      return;
    }
    if (action.type === 'PUT') {
      const { roomId, total, highlight } = action.unreadInfo;
      const existing = current.get(roomId);
      if (existing && existing.total === total && existing.highlight === highlight) return;
      const next = new Map(current);
      next.set(roomId, { total, highlight });
      set(roomUnreadsAtom, next);
      return;
    }
    if (!current.has(action.roomId)) return;
    const next = new Map(current);
    next.delete(action.roomId);
    set(roomUnreadsAtom, next);
  }
);

const isUnreadTracked = (room: Room): boolean =>
  matchesEnum(room.getMyMembership(), KnownMembership.Join) && !room.isSpaceRoom();

/** A read receipt of the user: for one thread (`threadId`, `main` for the room) or unthreaded. */
type OwnReadReceipt = {
  threadId?: string;
  unthreaded: boolean;
};

/**
 * The room's counts once the server applies the user's new receipts: an unthreaded receipt
 * reads everything, a threaded one only its thread or the main timeline.
 */
export const getOptimisticReceiptUnreadInfo = (
  room: Room,
  receipts: OwnReadReceipt[]
): UnreadInfo => {
  if (receipts.some((receipt) => receipt.unthreaded)) {
    return { roomId: room.roomId, highlight: 0, total: 0 };
  }

  let total = room.getUnreadNotificationCount(NotificationCountType.Total) ?? 0;
  let highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
  new Set(receipts.map((receipt) => receipt.threadId)).forEach((threadId) => {
    if (!threadId) return;
    if (threadId === MAIN_ROOM_TIMELINE) {
      total -= room.getRoomUnreadNotificationCount(NotificationCountType.Total) ?? 0;
      highlight -= room.getRoomUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
      return;
    }
    total -= room.getThreadUnreadNotificationCount(threadId, NotificationCountType.Total) ?? 0;
    highlight -=
      room.getThreadUnreadNotificationCount(threadId, NotificationCountType.Highlight) ?? 0;
  });

  return { roomId: room.roomId, highlight: Math.max(0, highlight), total: Math.max(0, total) };
};

/**
 * The counts without the main timeline's when everything it counts is read by the client's rule
 * (`isMainUnreadCountRead`), as a main receipt would leave them. The smaller of each count stays,
 * so counts a receipt of this client lowered already are not lowered twice.
 */
const withoutReadMainCounts = (
  mx: MatrixClient,
  room: Room,
  unreadInfo: UnreadInfo
): UnreadInfo => {
  if (!isMainUnreadCountRead(mx, room)) return unreadInfo;
  const threadsOnly = getOptimisticReceiptUnreadInfo(room, [
    { threadId: MAIN_ROOM_TIMELINE, unthreaded: false },
  ]);
  return {
    roomId: room.roomId,
    total: Math.min(unreadInfo.total, threadsOnly.total),
    highlight: Math.min(unreadInfo.highlight, threadsOnly.highlight),
  };
};

const toUnreadAction = (
  mx: MatrixClient,
  room: Room,
  roomUnreadInfo: UnreadInfo
): RoomToUnreadAction => {
  if (!isUnreadTracked(room)) return { type: 'DELETE', roomId: room.roomId };
  const unreadInfo = withoutReadMainCounts(mx, room, roomUnreadInfo);
  if (unreadInfo.total > 0 || unreadInfo.highlight > 0) return { type: 'PUT', unreadInfo };
  // A muted room pulls no attention: only its counts, which a mute keeps at zero, would show.
  if (!isRoomMuted(mx.pushRules, room.roomId) && roomHaveUnread(mx, room)) {
    return { type: 'PUT', unreadInfo };
  }
  return { type: 'DELETE', roomId: room.roomId };
};

/** The unread entry a room should have now. */
export const getRoomUnreadAction = (mx: MatrixClient, room: Room): RoomToUnreadAction =>
  toUnreadAction(mx, room, getUnreadInfo(room));

/** Set while this client sends a read receipt; see `sendOwnReceipt`. */
let sendingOwnReceipt = false;

/**
 * Runs `send`, which sends a read receipt of this client. The SDK adds the receipt's local echo
 * while `send` runs, and that echo alone lowers the room's counts at once
 * (`getOptimisticReceiptUnreadInfo`): it is ahead of the server. The user's other receipts are
 * not. One from a sync comes after that sync's counts, which already include it, and the SDK
 * also makes up a receipt for each message of the user's that it loads, though messages after it
 * may still be unread.
 */
export const sendOwnReceipt = <T>(send: () => T): T => {
  sendingOwnReceipt = true;
  try {
    return send();
  } finally {
    sendingOwnReceipt = false;
  }
};

const READ_RECEIPT_TYPES = new Set(['m.read', 'm.read.private']);

/** The user's own read receipts in an `m.receipt` event. */
const getOwnReadReceipts = (event: MatrixEvent, userId: string): OwnReadReceipt[] => {
  const content: unknown = event.getContent();
  if (!isRecord(content)) return [];
  const receipts: OwnReadReceipt[] = [];
  Object.values(content).forEach((byType) => {
    if (!isRecord(byType)) return;
    Object.entries(byType).forEach(([receiptType, byUser]) => {
      if (!READ_RECEIPT_TYPES.has(receiptType) || !isRecord(byUser)) return;
      const receipt = byUser[userId];
      if (!isRecord(receipt)) return;
      const threadId = typeof receipt.thread_id === 'string' ? receipt.thread_id : undefined;
      receipts.push(threadId ? { threadId, unthreaded: false } : { unthreaded: true });
    });
  });
  return receipts;
};

/** Tracks the unread state of every joined room of the current account. */
export const useBindRoomToUnreadAtom = (
  mx: MatrixClient,
  unreadAtom: RoomToUnreadAtom = roomToUnreadAtom
) => {
  const setUnread = useSetAtom(unreadAtom);

  useEffect(() => {
    const initialRooms = mx.getRooms();
    const resetAll = (rooms: Room[]) =>
      setUnread({
        type: 'RESET',
        unreadInfos: rooms.flatMap((room) => {
          const action = getRoomUnreadAction(mx, room);
          return action.type === 'PUT' ? [action.unreadInfo] : [];
        }),
      });
    resetAll(initialRooms);

    const update = (room: Room) => setUnread(getRoomUnreadAction(mx, room));

    // Counts can change without a timeline event (another device read the room).
    const countListeners = new Map<Room, () => void>();
    const watchCounts = (room: Room) => {
      if (countListeners.has(room)) return;
      const listener = () => update(room);
      room.on(RoomEvent.UnreadNotifications, listener);
      countListeners.set(room, listener);
    };
    initialRooms.forEach(watchCounts);

    const handleTimeline = (
      _event: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      _removed: boolean,
      data: { liveEvent?: boolean }
    ) => {
      if (!room || toStartOfTimeline || !data.liveEvent) return;
      update(room);
    };
    const handleReceipt = (event: MatrixEvent, room: Room) => {
      const userId = mx.getUserId();
      const receipts = userId ? getOwnReadReceipts(event, userId) : [];
      // Other members' receipts do not change what this user has read.
      if (receipts.length === 0) return;
      setUnread(
        sendingOwnReceipt
          ? toUnreadAction(mx, room, getOptimisticReceiptUnreadInfo(room, receipts))
          : getRoomUnreadAction(mx, room)
      );
    };
    const handleRoom = (room: Room) => {
      watchCounts(room);
      update(room);
    };
    const handleDeleteRoom = (roomId: string) => setUnread({ type: 'DELETE', roomId });
    // Muting a room, or unmuting it, changes whether its unread messages show.
    const handleAccountData = (event: MatrixEvent) => {
      if (matchesEnum(event.getType(), EventType.PushRules)) resetAll(mx.getRooms());
    };

    mx.on(RoomEvent.Timeline, handleTimeline);
    mx.on(RoomEvent.Receipt, handleReceipt);
    mx.on(RoomEvent.MyMembership, update);
    mx.on(ClientEvent.Room, handleRoom);
    mx.on(ClientEvent.DeleteRoom, handleDeleteRoom);
    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handleTimeline);
      mx.removeListener(RoomEvent.Receipt, handleReceipt);
      mx.removeListener(RoomEvent.MyMembership, update);
      mx.removeListener(ClientEvent.Room, handleRoom);
      mx.removeListener(ClientEvent.DeleteRoom, handleDeleteRoom);
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
      countListeners.forEach((listener, room) =>
        room.removeListener(RoomEvent.UnreadNotifications, listener)
      );
    };
  }, [mx, setUnread]);
};
