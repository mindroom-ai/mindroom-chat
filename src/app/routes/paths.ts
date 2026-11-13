// Route patterns for React Router. Room and space segments carry
// URI-encoded Matrix room IDs or aliases; the optional event segment
// focuses a timeline event.

// The signed-out screens take the homeserver as an optional first segment.
const signedOutPath = (screen: string): string => `/${screen}/:server?/`;

export const ROOT_PATH = '/';

export const LOGIN_PATH = signedOutPath('login');
export const REGISTER_PATH = signedOutPath('register');
export const RESET_PASSWORD_PATH = signedOutPath('reset-password');

export const CONNECT_PATH = '/connect/';
/** The quick capture widget (quick-capture/QuickCapturePage.tsx), served by the signed-in app. */
export const QUICK_CAPTURE_PATH = '/quick-capture/';
export const CONNECTIONS_PATH = '/connections/';

export const HOME_PATH = '/home/';
export const HOME_CREATE_PATH = '/home/create/';
export const HOME_JOIN_PATH = '/home/join/';
export const HOME_SEARCH_PATH = '/home/search/';
export const HOME_ROOM_PATH = '/home/:roomIdOrAlias/:eventId?/';

export const DIRECT_PATH = '/direct/';
export const DIRECT_CREATE_PATH = '/direct/create/';
export const DIRECT_ROOM_PATH = '/direct/:roomIdOrAlias/:eventId?/';

export const THREADS_PATH = '/threads/';
/** A room of the Threads section, which opens its thread beside the list (`?threadId=`). */
export const THREADS_ROOM_PATH = '/threads/:roomIdOrAlias/:eventId?/';

export const ACTIVITY_PATH = '/activity/';
export const ACTIVITY_INVITES_PATH = '/activity/invites/';
/** A room of the Activity section, which opens its thread beside the list (`?threadId=`). */
export const ACTIVITY_ROOM_PATH = '/activity/:roomIdOrAlias/:eventId?/';
/** Opens the Settings dialog on a page; settingsRegistry.ts lists the page ids. */
export const SETTINGS_PATH = '/settings/:page?/';
export const CANVASES_PATH = '/canvases/';
/** A client plugin's root, and its pages under it (src/app/plugins/pluginPages.tsx). */
export const PLUGIN_ROOT_PATH = '/p/:pluginId/';
export const PLUGIN_PAGE_PATH = `${PLUGIN_ROOT_PATH}*`;

export const EXPLORE_PATH = '/explore/';
export const EXPLORE_FEATURED_PATH = '/explore/featured/';
export const EXPLORE_SERVER_PATH = '/explore/:server/';

export const SPACE_PATH = '/:spaceIdOrAlias/';
export const SPACE_LOBBY_PATH = '/:spaceIdOrAlias/lobby/';
export const SPACE_SEARCH_PATH = '/:spaceIdOrAlias/search/';
export const SPACE_ROOM_PATH = '/:spaceIdOrAlias/:roomIdOrAlias/:eventId?/';
