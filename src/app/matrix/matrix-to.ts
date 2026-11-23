import { Capacitor } from '@capacitor/core';
import { appUrl, getAppBasePath } from '../lib/basePath';
import { NATIVE_APP_WEB_ORIGIN } from '../native/nativeAppOrigin';

export { NATIVE_APP_WEB_ORIGIN };

declare global {
  /** The path the app is served under, set by the bootstrap script (`src/boot/runtimeConfig.ts`). */
  // eslint-disable-next-line no-var
  var __APP_BASE_PATH__: string | undefined;
}

// Links to users go to matrix.to, which every Matrix client understands. Links to rooms and
// events open this app on the current web origin (`<origin><base>/<room>/<event>?via=...`), so a
// copied link brings the reader straight back to the message; on native Capacitor shells (iOS,
// Mac Catalyst, Android) they use `NATIVE_APP_WEB_ORIGIN` so Universal Links open the native app
// and fall back to the web app when it is not installed; without an `http:`/`https:` page origin
// (such as `file:`, non-native `capacitor:`, or no `location`), they fall back to matrix.to so
// the link stays portable.

const MATRIX_TO_ORIGIN = 'https://matrix.to';

/** An ID as a path segment: only characters that would end the segment are escaped. */
const encodeId = (id: string): string =>
  encodeURI(id).replace(/[/?#]/g, (character) => encodeURIComponent(character));

const viaQuery = (viaServers?: string[]): string =>
  viaServers && viaServers.length > 0
    ? `?${viaServers.map((server) => `via=${encodeURIComponent(server)}`).join('&')}`
    : '';

const appLink = (path: string): string => {
  if (Capacitor.isNativePlatform()) return `${NATIVE_APP_WEB_ORIGIN}/${path}`;
  const location = globalThis.location;
  const origin =
    (location?.protocol === 'http:' || location?.protocol === 'https:') &&
    location.origin &&
    location.origin !== 'null'
      ? location.origin
      : undefined;
  return origin ? `${origin}${appUrl(path)}` : `${MATRIX_TO_ORIGIN}/#/${path}`;
};

/** A matrix.to link to a user, as mentions use. */
export const getMatrixToUser = (userId: string): string =>
  `${MATRIX_TO_ORIGIN}/#/${encodeId(userId)}`;

/** A link that opens the room in this app. */
export const getMatrixToRoom = (roomIdOrAlias: string, viaServers?: string[]): string =>
  `${appLink(encodeId(roomIdOrAlias))}${viaQuery(viaServers)}`;

/** A link that opens the event in this app. */
export const getMatrixToRoomEvent = (room: string, event: string, viaServers?: string[]): string =>
  `${appLink([room, event].map(encodeId).join('/'))}${viaQuery(viaServers)}`;

/** A parsed room link: the room ID or alias, and the servers to join it through. */
type MatrixToRoom = {
  viaServers?: string[];
  roomIdOrAlias: string;
};

/** A parsed event link; `roomIdOrAlias` is the room that holds the event. */
type MatrixToRoomEvent = MatrixToRoom & { eventId: string };

/** What any supported permalink form names, before it is sorted into user, room, or event. */
type Permalink = {
  identifier: string;
  eventId?: string;
  viaServers: string[];
};

const safeDecode = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

const fromPathAndQuery = (path: string, query: string): Permalink | undefined => {
  const segments = path.split('/').filter((segment) => segment !== '');
  if (segments.length === 0 || segments.length > 2) return undefined;
  const [identifier, eventId] = segments.map(safeDecode);
  if (!identifier || (segments.length === 2 && !eventId)) return undefined;
  const viaServers = new URLSearchParams(query).getAll('via').filter((server) => server !== '');
  return { identifier, eventId, viaServers };
};

// `matrix:` URIs (Matrix specification, "Matrix URI scheme"): matrix:u/alice:example.org,
// matrix:r/alias:example.org, matrix:roomid/abc:example.org/e/event.
const MATRIX_URI_SIGILS: Record<string, string> = { u: '@', r: '#', roomid: '!', e: '$' };

const fromMatrixUri = (href: string): Permalink | undefined => {
  const [path = '', query = ''] = href.slice('matrix:'.length).split('?');
  const parts = path.split('/').map(safeDecode);
  if (parts.some((part) => !part)) return undefined;
  const [kind, id, eventKind, eventId] = parts;
  const sigil =
    kind !== undefined && Object.hasOwn(MATRIX_URI_SIGILS, kind)
      ? MATRIX_URI_SIGILS[kind]
      : undefined;
  if (!sigil || sigil === '$' || !id) return undefined;
  if (eventKind !== undefined && (eventKind !== 'e' || !eventId || sigil === '@')) return undefined;
  const viaServers = new URLSearchParams(query).getAll('via').filter((server) => server !== '');
  return {
    identifier: `${sigil}${id}`,
    eventId: eventId ? `$${eventId}` : undefined,
    viaServers,
  };
};

const parsePermalink = (href: string): Permalink | undefined => {
  if (href.startsWith('matrix:')) return fromMatrixUri(href);
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.origin === MATRIX_TO_ORIGIN) {
    const fragment = url.hash.replace(/^#\/?/, '');
    const queryStart = fragment.indexOf('?');
    return queryStart < 0
      ? fromPathAndQuery(fragment, '')
      : fromPathAndQuery(fragment.slice(0, queryStart), fragment.slice(queryStart + 1));
  }
  if (url.username || url.password) return undefined;
  const isCurrentOrigin = typeof window !== 'undefined' && url.origin === window.location.origin;
  const isNativeWebOrigin = url.origin === NATIVE_APP_WEB_ORIGIN;
  if (!isCurrentOrigin && !isNativeWebOrigin) return undefined;

  let relativePath: string | undefined;
  if (isCurrentOrigin) {
    const base = getAppBasePath();
    const prefix = base === '/' ? '/' : `${base}/`;
    if (url.pathname.startsWith(prefix)) {
      relativePath = url.pathname.slice(prefix.length);
    }
  }
  if (relativePath === undefined && isNativeWebOrigin && url.pathname.startsWith('/')) {
    relativePath = url.pathname.slice(1);
  }
  if (relativePath === undefined) return undefined;

  const permalink = fromPathAndQuery(relativePath, url.search.slice(1));
  // App links name a room or a user first, and any second segment must be an event ID so space
  // sub-routes such as `/!space:example.org/lobby` are not misread as event permalinks.
  if (!permalink || !/^[!#@]/.test(permalink.identifier)) return undefined;
  if (permalink.eventId && !permalink.eventId.startsWith('$')) return undefined;
  return permalink;
};

/** Whether `href` is a Matrix permalink: matrix.to, a `matrix:` URI or a link into this app. */
export const testMatrixTo = (href: string): boolean => parsePermalink(href) !== undefined;

/** The user a permalink points at. */
export const parseMatrixToUser = (href: string): string | undefined => {
  const permalink = parsePermalink(href);
  return permalink?.identifier.startsWith('@') && !permalink.eventId
    ? permalink.identifier
    : undefined;
};

/** The room a permalink points at, when it does not point at an event in it. */
export const parseMatrixToRoom = (href: string): MatrixToRoom | undefined => {
  const permalink = parsePermalink(href);
  if (!permalink || !/^[!#]/.test(permalink.identifier) || permalink.eventId) return undefined;
  return { roomIdOrAlias: permalink.identifier, viaServers: permalink.viaServers };
};

/** The event a permalink points at. */
export const parseMatrixToRoomEvent = (href: string): MatrixToRoomEvent | undefined => {
  const permalink = parsePermalink(href);
  if (!permalink?.eventId || !/^[!#]/.test(permalink.identifier)) return undefined;
  return {
    roomIdOrAlias: permalink.identifier,
    eventId: permalink.eventId,
    viaServers: permalink.viaServers,
  };
};
