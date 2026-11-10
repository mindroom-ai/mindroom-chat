import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';

const compareBooleanDesc = (left: boolean, right: boolean): number =>
  left === right ? 0 : left ? -1 : 1;

/** A thread the cross-room lists show: it has replies, or one of the user's is on its way. */
export const isCrossRoomThreadEntryEligible = (entry: CrossRoomThreadIndexEntry): boolean =>
  entry.threadRecord.status.replyCount > 0 || entry.threadRecord.status.hasPendingSend === true;

/** The order of cross-room thread lists: by activity, then unread, attention, resolved, room. */
export const compareCrossRoomThreadEntries = (
  left: CrossRoomThreadIndexEntry,
  right: CrossRoomThreadIndexEntry
): number => {
  const activityDiff = right.lastActivityTs - left.lastActivityTs;
  if (activityDiff !== 0) return activityDiff;

  const unreadDiff = compareBooleanDesc(left.isUnread, right.isUnread);
  if (unreadDiff !== 0) return unreadDiff;

  const attentionDiff = compareBooleanDesc(left.hasAttention, right.hasAttention);
  if (attentionDiff !== 0) return attentionDiff;

  const resolvedDiff = compareBooleanDesc(!left.isResolved, !right.isResolved);
  if (resolvedDiff !== 0) return resolvedDiff;

  const roomDiff = left.roomName.localeCompare(right.roomName);
  if (roomDiff !== 0) return roomDiff;

  return left.threadRootId.localeCompare(right.threadRootId);
};
