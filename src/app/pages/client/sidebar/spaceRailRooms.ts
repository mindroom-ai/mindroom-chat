import { useRoomUnread } from '../../../state/hooks/unread';
import { navigationRoomToUnreadAtom } from '../../../mindroom/rooms/navigationUnread';
import { useVisibleRooms } from '../../../mindroom/rooms/archivedRooms';
import { useSpaceNavigationRooms } from '../space/useSpaceSearchRooms';

/**
 * What a space's rail button counts and marks read: the rooms its page lists, so an archived
 * room adds nothing to the badge, as on the Home and Direct Messages buttons.
 */
export const useSpaceRailRooms = (spaceId: string) => ({
  unread: useRoomUnread(spaceId, navigationRoomToUnreadAtom),
  rooms: useVisibleRooms(useSpaceNavigationRooms(spaceId)),
});
