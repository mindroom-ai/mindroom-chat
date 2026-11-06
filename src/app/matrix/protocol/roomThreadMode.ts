import type { Room } from 'matrix-js-sdk';

/**
 * Room state MindRoom publishes (state key "") with the room's effective thread mode: whether its
 * agents answer in threads (`thread`), in the main timeline (`room`), or either (`mixed`).
 */
export const ROOM_THREAD_MODE_EVENT = 'io.mindroom.thread_mode';

export type RoomThreadMode = 'room' | 'thread' | 'mixed';

const isRoomThreadMode = (value: unknown): value is RoomThreadMode =>
  value === 'room' || value === 'thread' || value === 'mixed';

/** The mode an `io.mindroom.thread_mode` content names; anything else names none. */
export const parseRoomThreadMode = (content: unknown): RoomThreadMode | undefined => {
  if (typeof content !== 'object' || content === null) return undefined;
  const { mode } = content as { mode?: unknown };
  return isRoomThreadMode(mode) ? mode : undefined;
};

/** The thread mode the room's current state names, if any. */
export const getRoomThreadMode = (room: Room | null | undefined): RoomThreadMode | undefined =>
  parseRoomThreadMode(room?.currentState.getStateEvents(ROOM_THREAD_MODE_EVENT, '')?.getContent());
