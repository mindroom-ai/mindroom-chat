import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { Position, RectCords } from 'folds';
import { type UserRoomProfileState, userRoomProfileAtom } from '../userRoomProfile';

export const useUserRoomProfileState = (): UserRoomProfileState | undefined =>
  useAtomValue(userRoomProfileAtom);

/** Opens a member's profile card in a room, anchored at `cords`. */
export const useOpenUserRoomProfile = () => {
  const setState = useSetAtom(userRoomProfileAtom);







    ) => setState({ roomId, spaceId, userId, cords, position }),
    [setState]
  );
};

export const useCloseUserRoomProfile = () => {
  const setState = useSetAtom(userRoomProfileAtom);
  return useCallback(() => setState(undefined), [setState]);
};
