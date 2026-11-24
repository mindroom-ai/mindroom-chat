import type { createBrowserRouter } from 'react-router-dom';
import { isEventId, isRoomAlias, isRoomId } from '../lib/matrixIds';
import { OPENED_FROM_OUTSIDE_STATE } from '../routes/historyStack';
import {
  getActivityRoomPath,
  getConnectPath,
  getDirectRoomPath,
  getHomeRoomPath,
  getSpaceLobbyPath,
  getSpacePath,
  getSpaceRoomPath,
  getThreadsRoomPath,
  withSearchParam,
} from '../routes/pathUtils';
import { NATIVE_APP_WEB_ORIGIN } from './nativeAppOrigin';

type NativeAppPathNavigator = (
  appPath: string,
  options: { state?: unknown; replace: boolean }
) => void;
type PendingUniversalLink = { appPath: string; state: unknown; addressBefore: string };
type AppRouter = ReturnType<typeof createBrowserRouter>;

let activeNativeAppNavigator: NativeAppPathNavigator | undefined;
let pendingUniversalLink: PendingUniversalLink | undefined;

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

/** Puts `appPath` in the address and notifies whichever router listens to it. */
export const writeAppPathToAddress = (appPath: string): void => {
  try {
    window.history.replaceState(null, '', appPath);
    const event =
      typeof PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate');
    window.dispatchEvent(event);
  } catch {
    window.location.replace(appPath);
  }
};

/** Drops any Universal Link waiting for a router (e.g. when a newer SSO callback arrives). */
export const clearPendingUniversalLink = (): void => {
  pendingUniversalLink = undefined;
};

/** Registers the mounted router's navigator and hands over any cold-launch Universal Link. */
export const setNativeAppPathNavigator = (
  navigator: NativeAppPathNavigator | undefined
): (() => void) => {
  activeNativeAppNavigator = navigator;
  const pending = pendingUniversalLink;
  pendingUniversalLink = undefined;
  if (navigator && pending) navigator(pending.appPath, { state: pending.state, replace: true });
  return () => {
    if (activeNativeAppNavigator === navigator) activeNativeAppNavigator = undefined;
  };
};

/** Moves a waiting cold-launch Universal Link after `#` so a hash router starts on it directly. */
export const moveWaitingUniversalLinkAfterHash = (basename = '/'): void => {
  const pending = pendingUniversalLink;
  if (!pending) return;
  const [documentAddress = ''] = pending.addressBefore.split('#');
  const hashPath = trimSlashes(basename);
  try {
    window.history.replaceState(
      null,
      '',
      `${documentAddress}#${hashPath ? `/${hashPath}` : ''}${pending.appPath}`
    );
    pendingUniversalLink = undefined;
  } catch {
    // Keep waiting for the mounted router's navigator.
  }
};

const shownAppPath = (router: Pick<AppRouter, 'state' | 'basename'>): string => {
  const { pathname, search } = router.state.location;
  const base = trimSlashes(router.basename ?? '/');
  const prefix = base ? `/${base}` : '';
  const inBase = prefix !== '' && (pathname === prefix || pathname.startsWith(`${prefix}/`));
  return `${inBase ? pathname.slice(prefix.length) || '/' : pathname}${search}`;
};

/** Warm links always push so phone overlays close; cold handovers skip if already shown. */
export const createRouterAppPathNavigator =
  (router: Pick<AppRouter, 'navigate' | 'state' | 'basename'>): NativeAppPathNavigator =>
  (appPath, { replace, state }) => {
    if (replace && shownAppPath(router) === appPath) return;
    void router.navigate(appPath, { replace, state });
  };

/** Opens a Universal Link's app path in the mounted router, or stores it in the address until mount. */
export const openUniversalLinkPath = (appPath: string): void => {
  if (activeNativeAppNavigator) {
    activeNativeAppNavigator(appPath, { state: OPENED_FROM_OUTSIDE_STATE, replace: false });
    return;
  }
  const { pathname, search, hash } = window.location;
  pendingUniversalLink = {
    appPath,
    state: OPENED_FROM_OUTSIDE_STATE,
    addressBefore: pendingUniversalLink?.addressBefore ?? `${pathname}${search}${hash}`,
  };
  writeAppPathToAddress(appPath);
};

// eslint-disable-next-line no-control-regex
const ASCII_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// Lazy thunks avoid eagerly evaluating route path helpers when nativeSso is imported.
const SECTION_ROOM_PATH_BUILDERS: Record<string, (id: string, eventId?: string) => string> = {
  home: (id, eventId) => getHomeRoomPath(id, eventId),
  direct: (id, eventId) => getDirectRoomPath(id, eventId),
  threads: (id, eventId) => getThreadsRoomPath(id, eventId),
  activity: (id, eventId) => getActivityRoomPath(id, eventId),
};

const decodeSegment = (segment: string): string | undefined => {
  if (!segment) return undefined;
  try {
    const decoded = decodeURIComponent(segment);
    return decoded && !ASCII_CONTROL_CHARS.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const isRoomOrAlias = (value: string): boolean => isRoomId(value) || isRoomAlias(value);

const readSafeViaServers = (params: URLSearchParams): string[] => {
  const raw = [
    ...params.getAll('via'),
    ...params.getAll('viaServers').flatMap((v) => v.split(',')),
  ];
  return Array.from(
    new Set(raw.filter((v) => v && !/[\s,]/.test(v) && !ASCII_CONTROL_CHARS.test(v)))
  );
};

const resolveUniversalLinkBaseRoute = (
  segments: readonly string[]
): { basePath: string; isLobby?: boolean } | undefined => {
  const [first, second, third] = segments;
  if (!first) return undefined;

  if (Object.hasOwn(SECTION_ROOM_PATH_BUILDERS, first)) {
    const build = SECTION_ROOM_PATH_BUILDERS[first];
    if (!build || !second || !isRoomOrAlias(second)) return undefined;
    if (segments.length === 2) return { basePath: build(second) };
    if (segments.length === 3 && third && isEventId(third))
      return { basePath: build(second, third) };
    return undefined;
  }

  if (!isRoomOrAlias(first)) return undefined;
  if (segments.length === 1) return { basePath: getSpacePath(first) };
  if (segments.length === 2 && second) {
    if (second.toLowerCase() === 'lobby')
      return { basePath: getSpaceLobbyPath(first), isLobby: true };
    if (isEventId(second) || isRoomOrAlias(second))
      return { basePath: getSpaceRoomPath(first, second) };
    return undefined;
  }
  if (segments.length === 3 && second && third && isRoomOrAlias(second) && isEventId(third)) {
    return { basePath: getSpaceRoomPath(first, second, third) };
  }
  return undefined;
};

export const getAppPathFromUniversalLink = (incomingUrl: string): string | undefined => {
  if (incomingUrl.split(/[?#]/, 1)[0]?.includes('\\')) return undefined;
  let url: URL;
  try {
    url = new URL(incomingUrl);
  } catch {
    return undefined;
  }
  if (
    url.origin !== NATIVE_APP_WEB_ORIGIN ||
    url.username ||
    url.password ||
    url.pathname.includes('//') ||
    url.pathname.includes('\\')
  ) {
    return undefined;
  }
  if (url.pathname === '/connect' || url.pathname === '/connect/') {
    return getConnectPath(url.searchParams.get('code') ?? undefined);
  }

  const rawSegments = url.pathname.replace(/\/$/, '').slice(1).split('/');
  if (rawSegments.length < 1 || rawSegments.length > 3) return undefined;
  const segments = rawSegments.map(decodeSegment);
  if (segments.some((segment) => !segment)) return undefined;
  const route = resolveUniversalLinkBaseRoute(segments as string[]);
  if (!route) return undefined;

  const viaServers = readSafeViaServers(url.searchParams);
  const hasThreadId = url.searchParams.has('threadId');
  const rawThreadId = url.searchParams.get('threadId');
  const threadId = !route.isLobby && isEventId(rawThreadId) ? rawThreadId : undefined;
  const hasForkRoom = url.searchParams.has('forkRoom');
  const hasForkThread = url.searchParams.has('forkThread');
  const rawForkRoom = url.searchParams.get('forkRoom');
  const rawForkThread = url.searchParams.get('forkThread');
  const rawForkAt = url.searchParams.get('forkAt');
  const crossRoomFork =
    !route.isLobby &&
    !hasThreadId &&
    rawForkRoom &&
    !ASCII_CONTROL_CHARS.test(rawForkRoom) &&
    isRoomId(rawForkRoom) &&
    isEventId(rawForkThread) &&
    isEventId(rawForkAt)
      ? { forkRoom: rawForkRoom, forkThread: rawForkThread, forkAt: rawForkAt }
      : undefined;
  const forkAt = crossRoomFork
    ? crossRoomFork.forkAt
    : threadId && !hasForkRoom && !hasForkThread && isEventId(rawForkAt)
    ? rawForkAt
    : undefined;
  return withSearchParam(route.basePath, {
    viaServers: viaServers.length > 0 ? viaServers.join(',') : undefined,
    threadId,
    forkRoom: crossRoomFork?.forkRoom,
    forkThread: crossRoomFork?.forkThread,
    forkAt,
    focusEvent: !route.isLobby && url.searchParams.get('focusEvent') === '1' ? '1' : undefined,
  });
};
