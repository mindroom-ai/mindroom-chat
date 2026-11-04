/**
 * Which Spaces contain each room, from the `m.space.child` state of the Spaces the client knows.
 * A child counts only while its event has a non-empty `via`, as the Matrix spec defines.
 */
import { useEffect } from 'react';
import { atom, type WritableAtom, useSetAtom } from 'jotai';
import {
  ClientEvent,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { type RoomToParents, StateEvent } from '../../../types/matrix/room';
import { matchesEnum } from '../../utils/matchesEnum';

type RoomToParentsAction =
  | { type: 'INITIALIZE'; roomToParents: RoomToParents }
  /** Sets the children of one Space. */
  | { type: 'PUT'; parent: string; children: string[] }
  /** Forgets a Space, for example after leaving it. */
  | { type: 'DELETE'; parent: string };

type RoomToParentsAtom = WritableAtom<RoomToParents, [RoomToParentsAction], void>;

const parentsAtom = atom<RoomToParents>(new Map());

/** `roomToParents` with `parent` listing exactly `children`; unchanged input is returned as is. */
const setSpaceChildren = (
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

/** Room ID to the IDs of the Spaces that list it as a child. */
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
      return;
    }
    const current = get(parentsAtom);
    const children = action.type === 'PUT' ? new Set(action.children) : new Set<string>();
    const next = setSpaceChildren(current, action.parent, children);
    if (next !== current) set(parentsAtom, next);
  }
);

/** The rooms a Space lists as children. */
export const getSpaceChildIds = (space: Room): string[] =>
  space.currentState
    .getStateEvents(StateEvent.SpaceChild)
    .filter((event) => {
      const { via } = event.getContent();
      return (
        Array.isArray(via) &&
        via.length > 0 &&
        via.every((server) => typeof server === 'string') &&
        !!event.getStateKey()
      );
    })
    .map((event) => event.getStateKey() as string);

const isTrackedSpace = (room: Room): boolean => {
  if (!room.isSpaceRoom()) return false;
  const membership = room.getMyMembership();
  return (
    !matchesEnum(membership, KnownMembership.Invite) &&
    !matchesEnum(membership, KnownMembership.Ban)
  );
};

/** Builds the parents of every room and follows Space changes for the current account. */
export const useBindRoomToParentsAtom = (
  mx: MatrixClient,
  parentsAtom: RoomToParentsAtom = roomToParentsAtom
) => {
  const setParents = useSetAtom(parentsAtom);

  useEffect(() => {
    const roomToParents: RoomToParents = new Map();
    mx.getRooms()
      .filter(isTrackedSpace)
      .forEach((space) => {
        getSpaceChildIds(space).forEach((childId) => {
          const parents = roomToParents.get(childId) ?? new Set<string>();
          parents.add(space.roomId);
          roomToParents.set(childId, parents);
        });
      });
    setParents({ type: 'INITIALIZE', roomToParents });

    const putSpace = (space: Room) =>
      setParents({ type: 'PUT', parent: space.roomId, children: getSpaceChildIds(space) });
    const handleRoom = (room: Room) => {
      if (isTrackedSpace(room)) putSpace(room);
    };
    const handleMembership = (room: Room, membership: string) => {
      if (!room.isSpaceRoom()) return;
      if (matchesEnum(membership, KnownMembership.Join)) putSpace(room);
      else setParents({ type: 'DELETE', parent: room.roomId });
    };
    const handleStateEvent = (event: MatrixEvent) => {
      if (!matchesEnum(event.getType(), StateEvent.SpaceChild)) return;
      const roomId = event.getRoomId();
      const space = roomId ? mx.getRoom(roomId) : null;
      if (space && isTrackedSpace(space)) putSpace(space);
    };
    const handleDeleteRoom = (roomId: string) => setParents({ type: 'DELETE', parent: roomId });

    mx.on(RoomStateEvent.Events, handleStateEvent);
    mx.on(ClientEvent.Room, handleRoom);
    mx.on(RoomEvent.MyMembership, handleMembership);
    mx.on(ClientEvent.DeleteRoom, handleDeleteRoom);
    return () => {
      mx.removeListener(RoomStateEvent.Events, handleStateEvent);
      mx.removeListener(ClientEvent.Room, handleRoom);
      mx.removeListener(RoomEvent.MyMembership, handleMembership);
      mx.removeListener(ClientEvent.DeleteRoom, handleDeleteRoom);
    };
  }, [mx, setParents]);
};
