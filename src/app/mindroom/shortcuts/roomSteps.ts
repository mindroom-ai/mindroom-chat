/**
 * The room `step` places from `current` in the list: from a room outside the list, down starts
 * at the first room and up at the last. Undefined past either end.
 */
export const stepRoom = (
  roomIds: readonly string[],
  current: string | undefined,
  step: -1 | 1
): string | undefined => {
  const index = current === undefined ? -1 : roomIds.indexOf(current);
  if (index < 0) return step === 1 ? roomIds[0] : roomIds[roomIds.length - 1];
  return roomIds[index + step];
};

/** The next unread room after `current` going `step` ways, around the end of the list. */
export const stepUnreadRoom = (
  roomIds: readonly string[],
  current: string | undefined,
  step: -1 | 1,
  isUnread: (roomId: string) => boolean
): string | undefined => {
  const count = roomIds.length;
  const index = current === undefined ? -1 : roomIds.indexOf(current);
  // From outside the list, the search starts just before the first room or after the last.
  const start = index < 0 && step === -1 ? count : index;
  for (let offset = 1; offset <= count; offset += 1) {
    const roomId = roomIds[(((start + step * offset) % count) + count) % count];
    if (roomId !== undefined && roomId !== current && isUnread(roomId)) return roomId;
  }
  return undefined;
};
