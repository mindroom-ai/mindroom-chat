import { IconSrc, Icons } from 'folds';
import { JoinRule } from 'matrix-js-sdk';
import { SubRoomGlobeIcon, SubRoomIcon, SubRoomLockIcon } from './subRoomIcons';

// Kept apart from RoomAvatar.tsx so callers can use it without loading the avatar styles.
/**
 * The icon for a room or space without an avatar, by how it can be joined. A sub-room frames its
 * hash; the caller says whether the room is one.
 */
export const getRoomIconSrc = (space: boolean, joinRule?: string, subRoom = false): IconSrc => {
  const restricted = joinRule === JoinRule.Invite || joinRule === JoinRule.Knock;
  if (space) {
    if (joinRule === JoinRule.Public) return Icons.SpaceGlobe;
    return restricted ? Icons.SpaceLock : Icons.Space;
  }
  if (subRoom) {
    if (joinRule === JoinRule.Public) return SubRoomGlobeIcon;
    return restricted ? SubRoomLockIcon : SubRoomIcon;
  }
  if (joinRule === JoinRule.Public) return Icons.HashGlobe;
  return restricted ? Icons.HashLock : Icons.Hash;
};
