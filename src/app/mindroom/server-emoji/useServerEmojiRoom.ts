import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Membership, StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { isRoomAlias } from '../../utils/matrix';
import { getStateEvent } from '../../utils/room';
import { useServerEmojiRoomAddress } from './serverEmojiConfig';

/** The joined room the address names, found by room ID or by canonical alias. */
export const findServerEmojiRoom = (
  mx: MatrixClient,
  address: string | undefined
): Room | undefined => {
  if (!address) return undefined;
  if (!isRoomAlias(address)) {
    const room = mx.getRoom(address);
    return room?.getMyMembership() === Membership.Join ? room : undefined;
  }
  // Only a joined, current room may match: a room left after a replacement, or an invite whose
  // stripped state claims the alias, must not hide it.
  return mx
    .getRooms()
    .find(
      (room) =>
        room.getMyMembership() === Membership.Join &&
        room.getCanonicalAlias() === address &&
        getStateEvent(room, StateEvent.RoomTombstone) === undefined
    );
};

/** The server emoji room once the user has joined it; follows the joined room list. */
export const useServerEmojiRoom = (): Room | undefined => {
  const mx = useMatrixClient();
  const address = useServerEmojiRoomAddress();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  return useMemo(
    () => findServerEmojiRoom(mx, address),
    // The client holds the rooms; the joined room list signals that a join or leave changed them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mx, address, joinedRoomIds]
  );
};
