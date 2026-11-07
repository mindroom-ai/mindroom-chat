/**
 * Which Spaces and chat rooms list each room, from the `m.space.child` state of the rooms the
 * client knows. A child counts only while its event has a non-empty `via`, as the Matrix spec
 * defines. A chat room's joined child is a sub-room only while it is not a Space and names the
 * chat room back as its canonical `m.space.parent`, the rule MindRoom's agents follow to join it;
 * one link alone leaves a joined room where it was. A listed room the account has not joined
 * counts on the listing alone, as a Space's children do.
 */
import { useEffect } from 'react';
import { atom, type WritableAtom, useSetAtom, useStore } from 'jotai';
import {
  ClientEvent,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { type RoomToParents, StateEvent } from '../types/room';
import { matchesEnum } from '../../lib/matchesEnum';
import { isJoined } from './roomList';

type RoomToParentsAction =
  /** `chatRooms`: the parents that are chat rooms, not Spaces. */
  | { type: 'INITIALIZE'; roomToParents: RoomToParents; chatRooms?: Iterable<string> }
  /** Sets the children of one Space or chat room. */
  | { type: 'PUT'; parent: string; children: string[]; chatRoom: boolean }
  /** Forgets a Space or chat room, for example after leaving it. */
  | { type: 'DELETE'; parent: string };

type RoomToParentsAtom = WritableAtom<RoomToParents, [RoomToParentsAction], void>;

const parentsAtom = atom<RoomToParents>(new Map());
const chatRoomsAtom = atom<ReadonlySet<string>>(new Set<string>());

/** `roomToParents` with `parent` listing exactly `children`; unchanged input is returned as is. */
const setChildren = (
  roomToParents: RoomToParents,
  parent: string,
  children: Set<string>
): RoomToParents => {
  let next: RoomToParents | undefined;
  const update = (roomId: string, parents: Set<string> | undefined) => {
    next = next ?? new Map(roomToParents);
    if (parents && parents.size > 0) next.set(roomId, parents);
    else next.delete(roomId);
  };

  roomToParents.forEach((parents, roomId) => {
    if (parents.has(parent) && !children.has(roomId)) {
      const remaining = new Set(parents);
      remaining.delete(parent);
      update(roomId, remaining);
    }
  });
  children.forEach((roomId) => {
    const parents = roomToParents.get(roomId);
    if (parents?.has(parent)) return;
    update(roomId, new Set([...(parents ?? []), parent]));
  });
  return next ?? roomToParents;
};

/** Room ID to the IDs of the Spaces and chat rooms that list it as a child. */
export const roomToParentsAtom: RoomToParentsAtom = atom<
  RoomToParents,
  [RoomToParentsAction],
  void
>(
  (get) => get(parentsAtom),
  (get, set, action) => {
    if (action.type === 'INITIALIZE') {
      set(
        parentsAtom,
        new Map(Array.from(action.roomToParents, ([roomId, parents]) => [roomId, new Set(parents)]))
      );
      set(chatRoomsAtom, new Set(action.chatRooms));
      return;
    }
    const current = get(parentsAtom);
    const children = action.type === 'PUT' ? new Set(action.children) : new Set<string>();
    const next = setChildren(current, action.parent, children);
    if (next !== current) set(parentsAtom, next);

    const chatRooms = get(chatRoomsAtom);
    const listsSubRooms = action.type === 'PUT' && action.chatRoom && children.size > 0;
    if (listsSubRooms !== chatRooms.has(action.parent)) {
      const nextChatRooms = new Set(chatRooms);
      if (listsSubRooms) nextChatRooms.add(action.parent);
      else nextChatRooms.delete(action.parent);
      set(chatRoomsAtom, nextChatRooms);
    }
  }
);

/**
 * The parents in `roomToParentsAtom` that are chat rooms listing sub-rooms, not Spaces: what tells
 * the rooms above a room apart from the Spaces above it, for counts that only Spaces sum up and
 * for the sidebar, which shows a sub-room on its own while these rooms are hidden.
 */
export const chatRoomParentsAtom = atom((get) => get(chatRoomsAtom));

const hasVia = (content: Record<string, unknown>): boolean => {
  const { via } = content;
  return Array.isArray(via) && via.length > 0 && via.every((server) => typeof server === 'string');
};

/** The rooms a Space or chat room lists as children. */
export const getSpaceChildIds = (space: Room): string[] =>
  space.currentState
    .getStateEvents(StateEvent.SpaceChild)
    .filter((event) => hasVia(event.getContent()) && !!event.getStateKey())
    .map((event) => event.getStateKey() as string);

/** Whether `child` names `parentId` as its canonical parent (`m.space.parent`). */
const namesParent = (child: Room, parentId: string): boolean => {
  const content = child.currentState.getStateEvents(StateEvent.SpaceParent, parentId)?.getContent();
  return content?.canonical === true && hasVia(content);
};

/**
 * The children `room` adds to the map: every child of a Space, the sub-rooms of a chat room. A
 * listed room the account has not joined counts on the listing alone, as a Space's children do,
 * until it joins and its own state shows whether it names the chat room back.
 */
const getChildIds = (mx: MatrixClient, room: Room): string[] => {
  const children = getSpaceChildIds(room);
  if (room.isSpaceRoom()) return children;
  return children.filter((childId) => {
    const child = mx.getRoom(childId);
    if (child?.isSpaceRoom()) return false;
    return !child || !isJoined(child) || namesParent(child, room.roomId);
  });
};

const isTrackedParent = (room: Room): boolean => {
  if (!room.isSpaceRoom()) return isJoined(room);
  const membership = room.getMyMembership();
  return (
    !matchesEnum(membership, KnownMembership.Invite) &&
    !matchesEnum(membership, KnownMembership.Ban)
  );
};

/** Builds the parents of every room and follows their changes for the current account. */
export const useBindRoomToParentsAtom = (
  mx: MatrixClient,
  parentsAtom: RoomToParentsAtom = roomToParentsAtom
) => {
  const store = useStore();
  const setParents = useSetAtom(parentsAtom);

  useEffect(() => {
    const roomToParents: RoomToParents = new Map();
    const chatRooms = new Set<string>();
    mx.getRooms()
      .filter(isTrackedParent)
      .forEach((parent) => {
        getChildIds(mx, parent).forEach((childId) => {
          const parents = roomToParents.get(childId) ?? new Set<string>();
          parents.add(parent.roomId);
          roomToParents.set(childId, parents);
          if (!parent.isSpaceRoom()) chatRooms.add(parent.roomId);
        });
      });
    setParents({ type: 'INITIALIZE', roomToParents, chatRooms });

    const putParent = (parent: Room) => {
      if (!isTrackedParent(parent)) return;
      setParents({
        type: 'PUT',
        parent: parent.roomId,
        children: getChildIds(mx, parent),
        chatRoom: !parent.isSpaceRoom(),
      });
    };
    // The rooms that list `room`, since a chat room's list depends on its membership and state.
    const putListingRooms = (room: Room) =>
      store
        .get(parentsAtom)
        .get(room.roomId)
        ?.forEach((parentId) => {
          const parent = mx.getRoom(parentId);
          if (parent) putParent(parent);
        });
    const putRoom = (room: Room) => {
      putParent(room);
      putListingRooms(room);
    };
    const handleMembership = (room: Room, membership: string) => {
      if (matchesEnum(membership, KnownMembership.Join)) putParent(room);
      else setParents({ type: 'DELETE', parent: room.roomId });
      putListingRooms(room);
    };
    const handleStateEvent = (event: MatrixEvent) => {
      const room = mx.getRoom(event.getRoomId() ?? '');
      if (!room) return;
      if (matchesEnum(event.getType(), StateEvent.SpaceChild)) putParent(room);
      if (matchesEnum(event.getType(), StateEvent.SpaceParent)) {
        const parent = mx.getRoom(event.getStateKey() ?? '');
        if (parent && !parent.isSpaceRoom()) putParent(parent);
      }
    };
    const handleDeleteRoom = (roomId: string) => setParents({ type: 'DELETE', parent: roomId });

    mx.on(RoomStateEvent.Events, handleStateEvent);
    mx.on(ClientEvent.Room, putRoom);
    mx.on(RoomEvent.MyMembership, handleMembership);
    mx.on(ClientEvent.DeleteRoom, handleDeleteRoom);
    return () => {
      mx.removeListener(RoomStateEvent.Events, handleStateEvent);
      mx.removeListener(ClientEvent.Room, putRoom);
      mx.removeListener(RoomEvent.MyMembership, handleMembership);
      mx.removeListener(ClientEvent.DeleteRoom, handleDeleteRoom);
    };
  }, [mx, setParents, store, parentsAtom]);
};
