// `@mindroom/client-sdk/room`, the client SDK's subpath for rooms and threads (docs/architecture.md
// "Client plugins"): it opens them, links to them, names the thread a room's page shows, creates
// sub-rooms and names the rooms a room is a sub-room of, shows a person's profile card in a room,
// names the floating one that is open and closes it, and shows a thread on a plugin's own surface.
// Like `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION in
// scripts/client-plugins.mjs.
import { createElement, lazy, Suspense, useCallback, useContext, useMemo } from 'react';
import { useHref } from 'react-router-dom';
import type { Position, RectCords } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { getClientConfig } from '../app/config/useClientConfig';
import { useMatrixClient } from '../app/matrix/hooks/useMatrixClient';
import { useRoomNavigate as useAppRoomNavigate } from '../app/navigation/useRoomNavigate';
import { UserRoomProfile } from '../app/members/profile/UserRoomProfile';
import {
  useCloseUserRoomProfile,
  useOpenUserRoomProfile,
  useUserRoomProfileState,
} from '../app/navigation/useUserRoomProfileState';
import { PluginPanelControlsContext } from '../app/plugins/sidePanels';
import { withSearchParam } from '../app/routes/pathUtils';
import { createSubRoom as createAppSubRoom } from '../app/rooms/create/createSubRoom';

export { getParentRooms, offersSubRooms, useParentRooms } from '../app/matrix/state/subRooms';

/** Where in the room `navigateRoom` and `navigateRoomThread` open it, and how. */
type RoomNavigateOptions = {
  /** The event to open it at, scrolled to and marked, as the app's own message links open one. */
  eventId?: string;
  /** Replaces the current history entry instead of adding one, so Back skips the page it leaves. */
  replace?: boolean;
};

/**
 * What `useRoomNavigate` gives. Each function also has a call without options, so it fits a callback
 * type that passes more arguments.
 */
export type RoomNavigate = {
  /** Opens the room `roomId` where the app opens it: in its space, in Direct, or in Home. */
  navigateRoom: {
    (roomId: string): void;
    (roomId: string, options?: RoomNavigateOptions): void;
  };
  /**
   * Opens the thread `threadId` (its root's event ID) of the room; its back button returns here,
   * unless it replaced this page: then it leads to the page before, or to the room.
   */
  navigateRoomThread: {
    (roomId: string, threadId: string): void;
    (roomId: string, threadId: string, options?: RoomNavigateOptions): void;
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

/**
 * The root event ID of the thread the room's page shows, also when its address names a reply in
 * the thread: the ID `openBesideThread` of `useRoomSidePanel` takes. Undefined while the page
 * shows the room's own timeline, until the room has the event the address names, while the server
 * has not confirmed the root (a new thread's first message, still sending), and outside a room's
 * page (the search page). It renders again when the room shows another thread.
 */
export const useShownThread = (): string | undefined =>
  useContext(PluginPanelControlsContext)?.thread;

/**
 * Creates a sub-room of `parent` called `name`, as the room menu's New Sub-room does, and resolves
 * to its room ID: listed under `parent`, open only to its members, and encrypted and federated as
 * the deployment's config.json (`createRoom`) says when it is called. It refuses, creating nothing,
 * a blank name, a parent where the signed-in user may not list rooms, and a call while the app
 * provides no configuration. When the homeserver then refuses to list the new room under
 * `parent`, it leaves and forgets the room, if the homeserver lets it, and rejects with that
 * refusal. It takes spaces and direct chats too, where the room menu offers no New Sub-room
 * (`offersSubRooms`). It resolves once the server has created the room, before sync has it, and
 * does not open it; `useRoomNavigate` does.
 */
export const createSubRoom = async (parent: Room, { name }: { name: string }): Promise<string> => {
  const config = getClientConfig();
  if (!config) throw new Error('createSubRoom ran before the app provided its configuration');
  return createAppSubRoom(parent, name, config.createRoom);
};

/**
 * Opens the profile card of the person `userId` in the room `roomId`, floating at `anchor` (an
 * element's `getBoundingClientRect()`) on its `side`, below it unless given, as a mention pill opens
 * it. Escape or a click outside closes it. For a room the client does not have it opens nothing, not
 * even once sync brings the room, where the card would pop up at a stale anchor.
 */
export const useOpenUserProfile = () => {
  const client = useMatrixClient();
  const open = useOpenUserRoomProfile();
  return useCallback(
    (roomId: string, userId: string, anchor: RectCords, side?: Position) => {
      if (client.getRoom(roomId)) open(roomId, undefined, userId, anchor, side);
    },
    [client, open]
  );
};

/**
 * The floating profile card that is open, the one `useOpenUserProfile` opened or the app's own
 * mention pills, member rows and senders' names did: the room and the person it shows, or undefined
 * while none is open. It renders again when the card closes or shows another person or room. The
 * card closes on an Escape that reaches the document without `preventDefault`, so a plugin that
 * closes its own surface on Escape leaves it alone while a card is open.
 */
export const useShownUserProfile = (): { roomId: string; userId: string } | undefined => {
  const { roomId, userId } = useUserRoomProfileState() ?? {};
  return useMemo(
    () => (roomId !== undefined && userId !== undefined ? { roomId, userId } : undefined),
    [roomId, userId]
  );
};

/** Closes the floating profile card, if one is open; the function stays the same. */
export const useCloseUserProfile: () => () => void = useCloseUserRoomProfile;

/**
 * The profile card of the person `userId` in `room`, as the floating card shows it, for a plugin's
 * own surface; `onDone` runs when the card has done its job, such as before it opens the direct chat.
 * Like the floating card, it starts afresh for another room or person, so what one began there (a
 * ban and its reason) never goes to the next.
 */
export const UserProfileCard = (props: { room: Room; userId: string; onDone: () => void }) =>
  createElement(UserRoomProfile, { ...props, key: `${props.room.roomId}:${props.userId}` });

// Plugin entries load with the app, so the thread's timeline and composer load only once a
// `ThreadView` renders. A load that fails throws to the plugin's surface, as a side panel's own
// failure does.
const LazyThreadView = lazy(() =>
  import('../app/room/ThreadView').then((module) => ({ default: module.ThreadView }))
);

/**
 * The thread `threadId` (its root's event ID) of `room` as the room's page shows it, for a plugin's
 * own surface such as its side panel: the root and its replies with the app's message actions, the
 * thread's tool approvals under them, and the composer under those while the signed-in account may
 * post in the room. It fills its parent, a flex column, and scrolls inside it; it shows nothing
 * while its code loads. It may show a thread of the room whose page is open, also the one that page
 * shows: its composer has a reply and staged files of its own (which a reload does not keep),
 * shares the thread's unsent text with the page's, and records no voice messages, which are the
 * page's. Read receipts and notifications count the
 * thread as seen while the view shows it, also while the room's page is behind the panel. Its menus,
 * and the profile card its rows open, take their Escape at the document, after it bubbled through
 * the plugin's elements; so a plugin that closes its surface on Escape listens on the window, which
 * only an Escape nothing took reaches (one that is not `defaultPrevented`).
 */
export const ThreadView = (props: { room: Room; threadId: string }) =>
  createElement(Suspense, { fallback: null }, createElement(LazyThreadView, props));
