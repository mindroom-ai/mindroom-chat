import { generatePath } from 'react-router-dom';
import { getAppBasePath } from '../utils/basePath';
import {
  CANVASES_PATH,
  CONNECT_PATH,
  CREATE_PATH,
  DIRECT_CREATE_PATH,
  DIRECT_PATH,
  DIRECT_ROOM_PATH,
  EXPLORE_FEATURED_PATH,
  EXPLORE_PATH,
  EXPLORE_SERVER_PATH,
  HOME_CREATE_PATH,
  HOME_JOIN_PATH,
  HOME_PATH,
  HOME_ROOM_PATH,
  HOME_SEARCH_PATH,
  INBOX_INVITES_PATH,
  INBOX_NOTIFICATIONS_PATH,
  INBOX_PATH,
  LOGIN_PATH,
  REGISTER_PATH,
  RESET_PASSWORD_PATH,
  ROOT_PATH,
  SPACE_LOBBY_PATH,
  SPACE_PATH,
  SPACE_ROOM_PATH,
  SPACE_SEARCH_PATH,
  THREADS_PATH,
} from './paths';

/** Hash router settings from the client config; `true` means enabled without a basename. */
export type HashRouterOption = { enabled?: boolean; basename?: string } | boolean | undefined;

const encodeSegment = (value: string): string => encodeURIComponent(value);
const optionalSegment = (value: string | undefined): string | null =>
  value ? encodeSegment(value) : null;

const trimSlashes = (value: string): string => value.replace(/^\/+/, '').replace(/\/+$/, '');

/**
 * A route parameter built with `encodeURIComponent`, decoded. A value that is not valid
 * percent-encoding, such as a hand-typed `%`, stays as it is instead of throwing.
 */
export const decodeRouteParam = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Joins a stored `{ pathname, search, hash }` back into a single app path. */
export const joinPathComponent = (path: {
  pathname: string;
  search?: string;
  hash?: string;
}): string => `${path.pathname}${path.search ?? ''}${path.hash ?? ''}`;

/** Appends search parameters to a path, skipping undefined values. */
export const withSearchParam = <T extends Record<string, string | undefined>>(
  path: string,
  searchParam: T
): string => {
  const params = new URLSearchParams();
  Object.entries(searchParam).forEach(([key, value]) => {
    if (typeof value === 'string') params.set(key, value);
  });
  const search = params.toString();
  if (!search) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${search}`;
};

const hashRouterBasename = (hashRouter: HashRouterOption): string | undefined => {
  if (hashRouter === true) return '/';
  if (!hashRouter || typeof hashRouter !== 'object' || !hashRouter.enabled) return undefined;
  return hashRouter.basename ?? '/';
};

/**
 * Absolute URL prefix every app route lives under: the page origin, the
 * deployment base path, and with a hash router the `#basename` part.
 */
export const getOriginBaseUrl = (hashRouter?: HashRouterOption): string => {
  const origin = typeof window !== 'undefined' ? window.location?.origin ?? '' : '';
  const basePath = trimSlashes(getAppBasePath());
  const base = basePath ? `${origin}/${basePath}` : origin;
  const hashBasename = hashRouterBasename(hashRouter);
  if (hashBasename === undefined) return base;
  const hashPath = trimSlashes(hashBasename);
  return hashPath ? `${base}/#/${hashPath}` : `${base}/#`;
};

/**
 * Returns the app path (pathname, search, and hash) of `href` relative to
 * `baseUrl`, or an empty string when `href` lies outside of it.
 */
export const getAppPathFromHref = (baseUrl: string, href: string): string => {
  if (!href.startsWith(baseUrl)) return '';
  const rest = href.slice(baseUrl.length);
  if (rest === '') return '/';
  if (rest.startsWith('/')) return rest;
  if (rest.startsWith('?') || rest.startsWith('#')) return `/${rest}`;
  return '';
};

export const getRootPath = (): string => ROOT_PATH;

const getServerPath = (pattern: string, server?: string): string =>
  generatePath(pattern, { server: optionalSegment(server) });

export const getLoginPath = (server?: string): string => getServerPath(LOGIN_PATH, server);
export const getRegisterPath = (server?: string): string => getServerPath(REGISTER_PATH, server);
export const getResetPasswordPath = (server?: string): string =>
  getServerPath(RESET_PASSWORD_PATH, server);

/** The pairing page, with the pair code from a link in its `code` parameter when there is one. */
export const getConnectPath = (pairCode?: string): string => {
  const connectPath = `/${trimSlashes(CONNECT_PATH)}`;
  if (!pairCode) return connectPath;
  return withSearchParam(connectPath, { code: pairCode });
};

/** A room route under Home or Direct Messages, optionally focused on one event. */
const roomInSectionPath = (pattern: string, roomIdOrAlias: string, eventId?: string): string =>
  generatePath(pattern, {
    eventId: optionalSegment(eventId),
    roomIdOrAlias: encodeSegment(roomIdOrAlias),
  });





export const getHomeRoomPath = (roomIdOrAlias: string, eventId?: string): string =>







export const getThreadsPath = (): string => THREADS_PATH;
export const getCanvasesPath = (): string => CANVASES_PATH;
export const getCreatePath = (): string => CREATE_PATH;

export const getSpacePath = (spaceIdOrAlias: string): string =>
  generatePath(SPACE_PATH, { spaceIdOrAlias: encodeSegment(spaceIdOrAlias) });
export const getSpaceLobbyPath = (spaceIdOrAlias: string): string =>
  generatePath(SPACE_LOBBY_PATH, { spaceIdOrAlias: encodeSegment(spaceIdOrAlias) });
export const getSpaceSearchPath = (spaceIdOrAlias: string): string =>
  generatePath(SPACE_SEARCH_PATH, { spaceIdOrAlias: encodeSegment(spaceIdOrAlias) });




): string =>
  generatePath(SPACE_ROOM_PATH, {
    spaceIdOrAlias: encodeSegment(spaceIdOrAlias),
    roomIdOrAlias: encodeSegment(roomIdOrAlias),
    eventId: optionalSegment(eventId),










