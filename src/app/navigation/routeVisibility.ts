import { Room } from 'matrix-js-sdk';
import { Membership } from '../matrix/types/room';

type RoutedRoom = Pick<Room, 'roomId' | 'getMyMembership'>;

export const isJoinedRoom = (room: RoutedRoom | null | undefined): boolean =>
  room?.getMyMembership() === Membership.Join;

export const canRenderRoutedRoom = (
  room: RoutedRoom | null | undefined,
  routedRoomIds: string[]
): boolean => !!room && (routedRoomIds.includes(room.roomId) || isJoinedRoom(room));

export const shouldDeferRoomRouteFallback = ({
  hasCompletedInitialSync,
  isResolvingAlias,
  room,
  routedRoomIds,
}: {
  hasCompletedInitialSync: boolean;
  isResolvingAlias: boolean;
  room: RoutedRoom | null | undefined;
  routedRoomIds: string[];
}): boolean =>
  isResolvingAlias || (!hasCompletedInitialSync && !canRenderRoutedRoom(room, routedRoomIds));
