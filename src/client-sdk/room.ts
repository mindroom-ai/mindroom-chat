// `@mindroom/client-sdk/room`, the client SDK's subpath for taking the user to rooms and threads
// (docs/architecture.md "Client plugins"): it opens them and links to them. Like `/core` it only
// grows, and each addition raises CLIENT_PLUGIN_API_VERSION in scripts/client-plugins.mjs.
import { useMemo } from 'react';
import { useHref } from 'react-router-dom';
import { useRoomNavigate as useAppRoomNavigate } from '../app/navigation/useRoomNavigate';
import { withSearchParam } from '../app/routes/pathUtils';

/** Where in the room `navigateRoom` and `navigateRoomThread` open it, and how. */
type RoomNavigateOptions = {
  /** The event to open it at, scrolled to and marked, as the app's own message links open one. */
  eventId?: string;
  /** Replaces the current history entry instead of adding one, so Back skips the page it leaves. */
  replace?: boolean;
};

/**
 * What `useRoomNavigate` gives. Each function also keeps its call without options, so it still fits
 * a callback type that passes more arguments, as it did before it took options.
 */
export type RoomNavigate = {
  /** Opens the room `roomId` where the app opens it: in its space, in Direct, or in Home. */
  navigateRoom: {
    (roomId: string): void;
    (roomId: string, options: RoomNavigateOptions): void;
  };
  /**
   * Opens the thread `threadId` (its root's event ID) of the room; its back button returns here,
   * unless it replaced this page: then it leads to the page before, or to the room.
   */
  navigateRoomThread: {
    (roomId: string, threadId: string): void;
    (roomId: string, threadId: string, options: RoomNavigateOptions): void;
  };
};

/**
 * The app's event ID and router options for `options`. Only an `eventId` and `replace: true` count,
 * so a callback's extra arguments (an index, a name, a click event) still open the room itself.
 */
const appArguments = (options: RoomNavigateOptions | undefined) => {
  const { eventId, replace } = options ?? {};
  return [eventId, { replace: replace === true }] as const;
};

/** Opens rooms and threads, as the app's own room list and thread links do. */
export const useRoomNavigate = (): RoomNavigate => {
  const { navigateRoom, navigateRoomThread } = useAppRoomNavigate();
  return useMemo(
    () => ({
      navigateRoom: (roomId: string, options?: RoomNavigateOptions) =>
        navigateRoom(roomId, ...appArguments(options)),
      navigateRoomThread: (roomId: string, threadId: string, options?: RoomNavigateOptions) =>
        navigateRoomThread(roomId, threadId, ...appArguments(options)),
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
