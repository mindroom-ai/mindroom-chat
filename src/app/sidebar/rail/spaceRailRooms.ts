import { useRoomUnread } from '../../matrix/state/useUnread';
import { navigationRoomToUnreadAtom } from '../../notifications/navigationUnread';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { useSpaceNavigationRooms } from '../../matrix/state/useSpaceSearchRooms';

/**
 * What a space's rail button counts and marks read: the rooms its page lists, so an archived
 * room adds nothing to the badge, as on the Home and Direct Messages buttons.
 */
export const useSpaceRailRooms = (spaceId: string) => ({
  unread: useRoomUnread(spaceId, navigationRoomToUnreadAtom),
  rooms: useVisibleRooms(useSpaceNavigationRooms(spaceId)),
});
