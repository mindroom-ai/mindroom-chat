import { atom } from 'jotai';
import type { Position, RectCords } from 'folds';

/** Who the card shows: a member of a room, reached through a space when the room has one. */
type ProfileSubject = {
  userId: string;
  roomId: string;
  spaceId?: string;
};

/** Where the card is placed on screen. */
type ProfileAnchor = {
  cords: RectCords;
  position?: Position;
};

/** The member profile card that is open and the rectangle it anchors to. */
export type UserRoomProfileState = ProfileSubject & ProfileAnchor;

/** Holds `undefined` while no profile card is open. */
export const userRoomProfileAtom = atom<UserRoomProfileState | undefined>(undefined);
