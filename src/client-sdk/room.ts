// `@mindroom/client-sdk/room`, the client SDK's subpath for taking the user to rooms and threads
// (docs/architecture.md "Client plugins"): it opens them and links to them. Like `/core` it only
// grows, and each addition raises CLIENT_PLUGIN_API_VERSION in scripts/client-plugins.mjs.
import { useMemo } from 'react';
import { useHref } from 'react-router-dom';
import { useRoomNavigate as useAppRoomNavigate } from '../app/navigation/useRoomNavigate';
import { withSearchParam } from '../app/routes/pathUtils';

/** What `useRoomNavigate` gives. */
export type RoomNavigate = {
  /** Opens the room `roomId` where the app opens it: in its space, in Direct, or in Home. */
  navigateRoom: (roomId: string) => void;
  /** Opens the thread `threadId` (its root's event ID) of the room; its back button returns here. */
  navigateRoomThread: (roomId: string, threadId: string) => void;
};

/** Opens rooms and threads, as the app's own room list and thread links do. */
export const useRoomNavigate = (): RoomNavigate => {
  const { navigateRoom, navigateRoomThread } = useAppRoomNavigate();
  // Each passes on only its own arguments, also when it is a callback that gets called with more.
  return useMemo(
    () => ({
      navigateRoom: (roomId) => navigateRoom(roomId),
      navigateRoomThread: (roomId, threadId) => navigateRoomThread(roomId, threadId),
    }),
    [navigateRoom, navigateRoomThread]
  );
};

/**
 * The `href` of the room `roomId`, or of its thread `threadId`, where `useRoomNavigate` opens it,
 * with the base path the app is served under, or after `#` with the hash router.
 */
export const useRoomHref = (roomId: string, threadId?: string): string =>
  useHref(withSearchParam(useAppRoomNavigate().roomPath(roomId), { threadId }));
