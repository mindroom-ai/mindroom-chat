import { useEffect } from 'react';
import {
  ClientEvent,
  KnownMembership,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { matchesEnum } from '../../lib/matchesEnum';

/**
 * Resolves `roomId` on `mx` while the user is joined to it, re-rendering when the room arrives in
 * the client store or the user's membership in it changes.
 */
export const useJoinedRoom = (
  mx: MatrixClient | undefined,
  roomId: string | undefined
): Room | undefined => {
  const [, refresh] = useForceUpdate();

  useEffect(() => {
    if (!mx || !roomId) return undefined;
    const onMembership = (changedRoom: Room) => {
      if (changedRoom.roomId === roomId) refresh();
    };
    mx.on(RoomEvent.MyMembership, onMembership);
    mx.on(ClientEvent.Room, onMembership);
    return () => {
      mx.removeListener(RoomEvent.MyMembership, onMembership);
      mx.removeListener(ClientEvent.Room, onMembership);
    };
  }, [mx, refresh, roomId]);

  if (!mx || !roomId) return undefined;
  const candidate = mx.getRoom(roomId);
  return candidate && matchesEnum(candidate.getMyMembership(), KnownMembership.Join)
    ? candidate
    : undefined;
};
