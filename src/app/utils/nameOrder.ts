import type { MatrixClient } from 'matrix-js-sdk';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Orders names A to Z the way people read a list: ignoring case and accents, numbers by value. */
export const compareNames = (a: string, b: string): number => collator.compare(a, b);

/** Room IDs by their rooms' names (a room the client does not have by its ID), as the sidebar lists them. */
export const sortRoomIdsByName = (mx: MatrixClient, roomIds: readonly string[]): string[] => {
  const nameOf = (roomId: string): string => mx.getRoom(roomId)?.name ?? roomId;
  return [...roomIds].sort((a, b) => compareNames(nameOf(a), nameOf(b)));
};
