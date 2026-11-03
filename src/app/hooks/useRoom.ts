import { createContext, useContext } from 'react';
import type { Room } from 'matrix-js-sdk';

const providedRoom = createContext<Room | undefined>(undefined);
providedRoom.displayName = 'Room';

const directFlag = createContext(false);
directFlag.displayName = 'IsDirectRoom';

/** Provides the room the surrounding view shows. */
export const RoomProvider = providedRoom.Provider;

/** Marks the provided room as a direct room (`m.direct`). */
export const IsDirectRoomProvider = directFlag.Provider;

/** The room from the nearest `RoomProvider`; throws when there is none. */
export const useRoom = (): Room => {
  const room = useContext(providedRoom);
  if (room === undefined) {
    throw new Error('useRoom() was called outside a RoomProvider');
  }
  return room;
};

export function useIsDirectRoom(): boolean {
  return useContext(directFlag);
}
