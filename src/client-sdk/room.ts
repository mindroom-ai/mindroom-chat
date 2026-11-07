// `@mindroom/client-sdk/room`, the client SDK's subpath for taking the user to rooms and threads
// (docs/architecture.md "Client plugins"): it opens them, links to them, and reloads the page into
// a newly deployed version. Like `/core` it only grows, and each addition raises
// CLIENT_PLUGIN_API_VERSION in scripts/client-plugins.mjs.
import { useHref } from 'react-router-dom';
import { reloadForNewVersion as reloadAppForNewVersion } from '../app/config/appUpdate';
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
export const useRoomNavigate = (): RoomNavigate => useAppRoomNavigate();

/**
 * The `href` of the room `roomId`, or of its thread `threadId`, where `useRoomNavigate` opens it,
 * with the base path the app is served under, or after `#` with the hash router.
 */
export const useRoomHref = (roomId: string, threadId?: string): string =>
  useHref(withSearchParam(useAppRoomNavigate().roomPath(roomId), { threadId }));

/**
 * Reloads the page into the newest version the server has, as the app's own update notice does.
 */
export const reloadForNewVersion = (): Promise<void> => reloadAppForNewVersion();
