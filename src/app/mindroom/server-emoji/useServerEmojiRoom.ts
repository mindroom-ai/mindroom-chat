import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Membership } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { getCanonicalAliasRoomId, isRoomAlias } from '../../utils/matrix';
import { useServerEmojiRoomAddress } from './serverEmojiConfig';

/** The joined room the address names, found by room ID or by canonical alias. */
export const findServerEmojiRoom = (
  mx: MatrixClient,
  address: string | undefined
): Room | undefined => {
  if (!address) return undefined;
  const roomId = isRoomAlias(address) ? getCanonicalAliasRoomId(mx, address) : address;
  const room = roomId ? mx.getRoom(roomId) : null;
  return room?.getMyMembership() === Membership.Join ? room : undefined;
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
