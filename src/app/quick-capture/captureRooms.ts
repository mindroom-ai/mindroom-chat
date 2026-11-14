import type { CaptureRoom } from './captureProtocol';

export const MAX_CAPTURE_ROOMS = 500;
export const MAX_PICKER_ROWS = 50;

export type CaptureRoomSource = {
  id: string;
  name: string;
  direct: boolean;
  space: boolean;
  lastActiveTs: number;
};

/** The rooms the picker can offer: no spaces, newest activity first, at most 500. */
export const buildCaptureRooms = (rooms: CaptureRoomSource[]): CaptureRoom[] =>
  rooms
    .filter((room) => !room.space)
    .sort((a, b) => b.lastActiveTs - a.lastActiveTs)
    .slice(0, MAX_CAPTURE_ROOMS)
    .map(({ id, name, direct }) => ({ id, name, direct }));

/** The picker's rows for a query: a case-insensitive match anywhere in the name, at most 50. */
export const filterCaptureRooms = (rooms: CaptureRoom[], query: string): CaptureRoom[] => {
  const needle = query.toLowerCase();
  return rooms.filter((room) => room.name.toLowerCase().includes(needle)).slice(0, MAX_PICKER_ROWS);
};
