import { IconSrc, Icons } from 'folds';
import { JoinRule } from 'matrix-js-sdk';
import { WorkRoomGlobeIcon, WorkRoomIcon, WorkRoomLockIcon } from './workRoomIcons';

// Kept apart from RoomAvatar.tsx so callers can use it without loading the avatar styles.
/**
 * The icon for a room or space without an avatar, by how it can be joined. A work room, one a
 * MindRoom agent is in, frames its hash.
 */
export const getRoomIconSrc = (space: boolean, joinRule?: string, work = false): IconSrc => {
  const restricted = joinRule === JoinRule.Invite || joinRule === JoinRule.Knock;
  if (space) {
    if (joinRule === JoinRule.Public) return Icons.SpaceGlobe;
    return restricted ? Icons.SpaceLock : Icons.Space;
  }
  if (work) {
    if (joinRule === JoinRule.Public) return WorkRoomGlobeIcon;
    return restricted ? WorkRoomLockIcon : WorkRoomIcon;
  }
  if (joinRule === JoinRule.Public) return Icons.HashGlobe;
  return restricted ? Icons.HashLock : Icons.Hash;
};
