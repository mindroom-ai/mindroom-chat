import type { Room } from 'matrix-js-sdk';
import { type RecentThreadItem } from '../../state/recentThreads';

export type VisibleRecentThreadItem = RecentThreadItem & {
  room: Room;
};

export const buildVisibleRecentThreadEntries = (
  getRoom: (roomId: string) => Room | null | undefined,
  recentThreads: RecentThreadItem[]
): VisibleRecentThreadItem[] =>
  recentThreads.reduce<VisibleRecentThreadItem[]>((entries, recentThread) => {
    const room = getRoom(recentThread.roomId);
    if (!room || room.getMyMembership() !== 'join') return entries;

    entries.push({
      ...recentThread,
      room,
    });
    return entries;
  }, []);
