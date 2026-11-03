import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { type UserRoomProfileState, userRoomProfileAtom } from '../userRoomProfile';

export const useUserRoomProfileState = (): UserRoomProfileState | undefined =>
  useAtomValue(userRoomProfileAtom);

type Profile = UserRoomProfileState;

/** Opens a member's profile card in a room, anchored at `cords`. */
export const useOpenUserRoomProfile = () => {
  const setState = useSetAtom(userRoomProfileAtom);
  return useCallback(
    (
      roomId: Profile['roomId'],
      spaceId: Profile['spaceId'],
      userId: Profile['userId'],
      cords: Profile['cords'],
      position?: Profile['position']
    ) => setState({ roomId, spaceId, userId, cords, position }),
    [setState]
  );
};

export const useCloseUserRoomProfile = () => {
  const setState = useSetAtom(userRoomProfileAtom);
  return useCallback(() => setState(undefined), [setState]);
};
