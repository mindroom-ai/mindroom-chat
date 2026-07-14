import { useEffect } from 'react';
import { MatrixClient } from 'matrix-js-sdk';

export type PendingSpaceDrop = {
  roomId: string;
  spaceId: string;
  placement: { orderKey: string; roomIds: string[] };
};

export function useResolvedPendingSpaceDrop(
  mx: MatrixClient,
  pending: PendingSpaceDrop | undefined,
  joinedRoomIds: readonly string[],
  joinedSpaceIds: readonly string[],
  onInvalid: () => void
) {
  const room =
    pending && joinedRoomIds.includes(pending.roomId) ? mx.getRoom(pending.roomId) : undefined;
  const space =
    pending && joinedSpaceIds.includes(pending.spaceId) ? mx.getRoom(pending.spaceId) : undefined;

  useEffect(() => {
    if (pending && (!room || !space)) onInvalid();
  }, [onInvalid, pending, room, space]);

  return pending && room && space ? { pending, room, space } : undefined;
}
