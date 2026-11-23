// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { createStore, Provider } from 'jotai';
import { createBrowserRouter, createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMatrixToRoom, getMatrixToRoomEvent } from '../matrix/matrix-to';
import { MembersOverlayFollowsNavigation, phoneDrawerOpenAtom } from '../members/useMembersDrawer';
import { nextPhoneNavDrawerOpen } from '../navigation/phoneNavDrawer';
import { resolveProtectedRouteRedirect } from '../navigation/routeSessionGuards';
import {
  getActivityRoomPath,
  getConnectPath,
  getDirectRoomPath,
  getHomeRoomPath,
  getLoginPath,
  getSpaceLobbyPath,
  getSpacePath,
  getSpaceRoomPath,
  getThreadsRoomPath,
  withSearchParam,
} from '../routes/pathUtils';
import {
  currentHistoryLocation,
  OPENED_FROM_OUTSIDE_STATE,
  previousHistoryPathname,
  useHistoryStackRecorder,
} from '../routes/historyStack';
import {
  createRouterAppPathNavigator,
  getAppPathFromUniversalLink,
  moveWaitingUniversalLinkAfterHash,
  registerNativeAppUrlCallbacks,
  setNativeAppPathNavigator,
} from './nativeSso';

vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn() } }));

type AasaComponent = {
  '/'?: string;
  exclude?: boolean;
  caseSensitive?: boolean;
  percentEncoded?: boolean;
  comment?: string;
};

type AasaDocument = {
  applinks: {
    details: Array<{
      appIDs: string[];
      components: AasaComponent[];
    }>;
  };
};

/** An AASA pattern as a whole-path match: `*` is any run of characters, `?` any one. */
const aasaWildcardToRegExp = (pattern: string, caseSensitive: boolean): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
  return new RegExp(regexSource, caseSensitive ? 's' : 'is');
};

const decodeAasaPath = (pathname: string): string | undefined => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
};

/**
 * Whether Apple opens `href` in the app: the first component whose path pattern matches decides,
 * and an `exclude` one keeps the link on the web. A component matches the path as the link has
 * it and with letter case (`percentEncoded` and `caseSensitive`, both true by default); with
 * `percentEncoded: false` it matches the path with its percent-encoding undone, and with
 * `caseSensitive: false` in any letter case.
 */
const matchesAasaComponents = (components: readonly AasaComponent[], href: string): boolean => {
  const { pathname } = new URL(href);
  for (const component of components) {
    const pattern = component['/'];
    if (pattern === undefined) continue;
    const percentEncoded = component.percentEncoded ?? true;
    const caseSensitive = component.caseSensitive ?? true;
    const candidatePath = percentEncoded ? pathname : decodeAasaPath(pathname);
    if (
      candidatePath !== undefined &&
      aasaWildcardToRegExp(pattern, caseSensitive).test(candidatePath)
    ) {
      return !(component.exclude ?? false);
    }
  }
  return false;
};

type TestRouter = ReturnType<typeof createBrowserRouter>;

/** A signed-in page, as far as these tests go: it records its history entry. */
function Recorder() {
  useHistoryStackRecorder('@reader:example.org');
  return null;
}

/** As `AppRouter` does: the router, and its way to open Universal Links while it is mounted. */
function RouterHarness({ router }: { router: TestRouter }) {
  React.useLayoutEffect(
    () => setNativeAppPathNavigator(createRouterAppPathNavigator(router)),
    [router]
  );
  return React.createElement(RouterProvider, { router });
}

/** As `createRouter` makes a hash router: started on a Universal Link that waits for one. */
const createStartedHashRouter = (
  routes: Parameters<typeof createHashRouter>[0],
  basename?: string
): TestRouter => {
  moveWaitingUniversalLinkAfterHash(basename);
  return createHashRouter(routes, basename === undefined ? {} : { basename });
};

const shownPath = (router: TestRouter): string =>
  `${router.state.location.pathname}${router.state.location.search}`;

describe('native Universal Links', () => {
  let openUrl: (event: { url?: string }) => void;
  let warn: ReturnType<typeof vi.spyOn>;

  const register = async (launchUrl?: string) => {
    registerNativeAppUrlCallbacks({
      getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : undefined),
      addListener: async (_name, listener) => {
        openUrl = listener;
      },
    });
    await Promise.resolve();
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setNativeAppPathNavigator(undefined);
    vi.restoreAllMocks();
  });

  it('routes cold launches for room, alias, and message Universal Links', async () => {
    const origin = window.location.origin;

    await register('https://chat.mindroom.chat/!harbor:example.org?via=example.org');
    expect(window.location.origin).toBe(origin);
    expect(window.location.pathname + window.location.search).toBe(
      withSearchParam(getSpacePath('!harbor:example.org'), { viaServers: 'example.org' })
    );
    expect(Browser.close).not.toHaveBeenCalled();

    await register('https://chat.mindroom.chat/%23field-notes:remote.example.org');
    expect(window.location.pathname + window.location.search).toBe(
      getSpacePath('#field-notes:remote.example.org')
    );

    await register(
      'https://chat.mindroom.chat/!harbor:example.org/$entry-1?via=example.org&focusEvent=1'
    );
    expect(window.location.pathname + window.location.search).toBe(
      withSearchParam(getSpaceRoomPath('!harbor:example.org', '$entry-1'), {
        viaServers: 'example.org',
        focusEvent: '1',
      })
    );
  });

  it('routes warm launches for encoded IDs, section routes, space routes, and allowlisted query params', async () => {
    await register();
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);

    const cases: Array<[string, string]> = [
      [
        'https://chat.mindroom.chat/%21harbor%2Fdesk:example.org/%24entry%2F1?via=example.org&viaServers=relay.example.org,example.org&threadId=$root-1&focusEvent=1&utm=drop#frag',
        withSearchParam(getSpaceRoomPath('!harbor/desk:example.org', '$entry/1'), {
          viaServers: 'example.org,relay.example.org',
          threadId: '$root-1',
          focusEvent: '1',
        }),
      ],
      [
        'https://chat.mindroom.chat/%23field%2Fnotes:remote.example.org/',
        getSpacePath('#field/notes:remote.example.org'),
      ],
      [
        'https://chat.mindroom.chat/home/!harbor:example.org',
        getHomeRoomPath('!harbor:example.org'),
      ],
      [
        'https://chat.mindroom.chat/home/%21harbor:example.org/$entry-1?threadId=$root-1',
        withSearchParam(getHomeRoomPath('!harbor:example.org', '$entry-1'), {
          threadId: '$root-1',
        }),
      ],
      [
        'https://chat.mindroom.chat/direct/%23dm-room:remote.example.org/$entry-2',
        getDirectRoomPath('#dm-room:remote.example.org', '$entry-2'),
      ],
      [
        'https://chat.mindroom.chat/threads/!harbor:example.org?threadId=$root-2&focusEvent=1',
        withSearchParam(getThreadsRoomPath('!harbor:example.org'), {
          threadId: '$root-2',
          focusEvent: '1',
        }),
      ],
      [
        'https://chat.mindroom.chat/activity/!harbor:example.org/$entry-3',
        getActivityRoomPath('!harbor:example.org', '$entry-3'),
      ],
      [
        'https://chat.mindroom.chat/!space:example.org/lobby?via=example.org&threadId=$root-1&focusEvent=1&extra=1#hash',
        withSearchParam(getSpaceLobbyPath('!space:example.org'), { viaServers: 'example.org' }),
      ],
      [
        'https://chat.mindroom.chat/%21space:example.org/Lobby/',
        getSpaceLobbyPath('!space:example.org'),
      ],
      [
        'https://chat.mindroom.chat/!space:example.org/!harbor:example.org?via=example.org',
        withSearchParam(getSpaceRoomPath('!space:example.org', '!harbor:example.org'), {
          viaServers: 'example.org',
        }),
      ],
      [
        'https://chat.mindroom.chat/!space:example.org/%23field-notes:remote.example.org/$entry-4?via=remote.example.org',
        withSearchParam(
          getSpaceRoomPath('!space:example.org', '#field-notes:remote.example.org', '$entry-4'),
          { viaServers: 'remote.example.org' }
        ),
      ],
    ];

    try {
      for (const [incomingUrl, expectedAppPath] of cases) {
        openUrl({ url: incomingUrl });
        expect(
          window.location.pathname + window.location.search + window.location.hash,
          incomingUrl
        ).toBe(expectedAppPath);
      }
      expect(onPopState).toHaveBeenCalledTimes(cases.length);
      expect(Browser.close).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', onPopState);
    }
  });

  describe('with a mounted router', () => {
    let renderer: ReactTestRenderer | undefined;

    const mount = async (element: React.ReactElement) => {
      await act(async () => {
        renderer = create(element);
      });
    };
    const harness = (router: TestRouter) => React.createElement(RouterHarness, { router });
    const open = async (url: string) => {
      await act(async () => {
        openUrl({ url });
      });
    };

    afterEach(() => {
      act(() => renderer?.unmount());
      renderer = undefined;
    });

    it('pushes successive warm Universal Links, closing phone overlays and starting historyStack over', async () => {
      window.history.replaceState(null, '', '/home/');
      const store = createStore();
      const membersOut = { '@reader:example.org': true };
      store.set(phoneDrawerOpenAtom, membersOut);
      function Page() {
        useHistoryStackRecorder('@reader:example.org');
        return React.createElement(MembersOverlayFollowsNavigation);
      }
      const router = createBrowserRouter([{ path: '*', element: React.createElement(Page) }]);
      await mount(React.createElement(Provider, { store }, harness(router)));
      await register();

      await open('https://chat.mindroom.chat/home/!alpha:example.org');
      // A push: the drawer's rule and the members' both keep an overlay out through a replace.
      expect(router.state.historyAction).toBe('PUSH');
      expect(router.state.location.state).toEqual(OPENED_FROM_OUTSIDE_STATE);
      expect(nextPhoneNavDrawerOpen(true, false, router.state.historyAction, false)).toBe(false);
      expect(store.get(phoneDrawerOpenAtom)).toEqual({});
      expect(currentHistoryLocation()?.pathname).toBe(getHomeRoomPath('!alpha:example.org'));
      expect(previousHistoryPathname()).toBeUndefined();

      store.set(phoneDrawerOpenAtom, membersOut);
      await open('https://chat.mindroom.chat/activity/!beta:example.org?threadId=$root');
      expect(router.state.historyAction).toBe('PUSH');
      expect(nextPhoneNavDrawerOpen(true, false, router.state.historyAction, false)).toBe(false);
      expect(store.get(phoneDrawerOpenAtom)).toEqual({});
      expect(currentHistoryLocation()?.pathname).toBe(getActivityRoomPath('!beta:example.org'));
      expect(currentHistoryLocation()?.search).toBe('?threadId=%24root');
      expect(previousHistoryPathname()).toBeUndefined();

      await act(async () => {
        await router.navigate(getHomeRoomPath('!gamma:example.org'));
      });
      expect(currentHistoryLocation()?.pathname).toBe(getHomeRoomPath('!gamma:example.org'));
      expect(previousHistoryPathname()).toBe(getActivityRoomPath('!beta:example.org'));
    });

    it('starts a browser router on a cold Universal Link without navigating again', async () => {
      await register('https://chat.mindroom.chat/home/!alpha:example.org?via=example.org');
      const appPath = withSearchParam(getHomeRoomPath('!alpha:example.org'), {
        viaServers: 'example.org',
      });
      expect(window.location.pathname + window.location.search).toBe(appPath);

      const router = createBrowserRouter([{ path: '*', element: React.createElement(Recorder) }]);
      const navigate = vi.spyOn(router, 'navigate');
      await mount(harness(router));

      expect(navigate).not.toHaveBeenCalled();
      expect(shownPath(router)).toBe(appPath);
    });

    it.each([
      [undefined, ''],
      ['/', ''],
      ['/app/', '/app'],
      ['/app', '/app'],
      ['app', '/app'],
    ])('starts a hash router (basename %s) on a cold Universal Link', async (basename, prefix) => {
      window.history.replaceState(null, '', '/');
      await register(
        'https://chat.mindroom.chat/!harbor:example.org/$entry-1?via=example.org&focusEvent=1'
      );
      const roomPath = getSpaceRoomPath('!harbor:example.org', '$entry-1');
      const appPath = withSearchParam(roomPath, { viaServers: 'example.org', focusEvent: '1' });
      // Until a router is mounted the link stands in the address, where a browser router starts.
      expect(window.location.pathname + window.location.search).toBe(appPath);

      // `/` redirects as the app's root route does: where a hash router would start without the
      // link, and from where that redirect would win over a navigation to the link.
      const router = createStartedHashRouter(
        [
          { path: '/', element: React.createElement(Navigate, { to: '/home/', replace: true }) },
          { path: '*', element: React.createElement(Recorder) },
        ],
        basename
      );
      const navigate = vi.spyOn(router, 'navigate');
      await mount(harness(router));

      expect(navigate).not.toHaveBeenCalled();
      expect(shownPath(router)).toBe(`${prefix}${appPath}`);
      // The route is after `#` alone: the document's own path is the one the app was loaded at.
      expect(window.location.pathname + window.location.search).toBe('/');
      expect(window.location.hash).toBe(`#${prefix}${appPath}`);
      // Signed out, the page sends to login and remembers the link: the address is one the app
      // reads its own paths from, whichever way the configuration writes the basename.
      const hashRouter = basename === undefined ? { enabled: true } : { enabled: true, basename };
      expect(resolveProtectedRouteRedirect(window.location.href, hashRouter, false)).toEqual({
        redirectTo: getLoginPath(),
        afterLoginPath: appPath,
      });

      // A link that arrives now is a push, inside the router's basename.
      await register();
      await open('https://chat.mindroom.chat/home/!alpha:example.org');
      expect(router.state.historyAction).toBe('PUSH');
      expect(window.location.pathname + window.location.search).toBe('/');
      expect(window.location.hash).toBe(`#${prefix}${getHomeRoomPath('!alpha:example.org')}`);
      expect(currentHistoryLocation()?.pathname).toBe(getHomeRoomPath('!alpha:example.org'));
      expect(previousHistoryPathname()).toBeUndefined();
    });

    it('replaces the first page of a router that did not start on the waiting link', async () => {
      window.history.replaceState(null, '', '/#/home/');
      const router = createHashRouter([{ path: '*', element: React.createElement(Recorder) }]);
      await mount(React.createElement(RouterProvider, { router }));
      // The link is written to the document's path, which this router does not route by.
      await act(async () => {
        await register('https://chat.mindroom.chat/home/!alpha:example.org');
      });
      expect(shownPath(router)).not.toBe(getHomeRoomPath('!alpha:example.org'));

      await act(async () => {
        setNativeAppPathNavigator(createRouterAppPathNavigator(router));
      });

      expect(router.state.historyAction).toBe('REPLACE');
      expect(router.state.location.state).toEqual(OPENED_FROM_OUTSIDE_STATE);
      expect(shownPath(router)).toBe(getHomeRoomPath('!alpha:example.org'));
      expect(currentHistoryLocation()?.pathname).toBe(getHomeRoomPath('!alpha:example.org'));
      expect(previousHistoryPathname()).toBeUndefined();
    });

    it('routes a warm SSO callback under a hash router without doubling the hash', async () => {
      window.history.replaceState(null, '', '/#/home/');
      const router = createStartedHashRouter([
        { path: '*', element: React.createElement(Recorder) },
      ]);
      const navigate = vi.spyOn(router, 'navigate');
      await mount(harness(router));
      await register();
      expect(shownPath(router)).toBe('/home/');

      await open('mindroom://auth/#/login/mindroom.chat?loginToken=abc123');

      // Through the address, which the router reads after `#`; its own navigate would add a `#`.
      expect(navigate).not.toHaveBeenCalled();
      expect(window.location.pathname + window.location.search).toBe('/');
      expect(window.location.hash).toBe('#/login/mindroom.chat?loginToken=abc123');
      expect(window.location.href).not.toContain('#/#');
      expect(router.state.location.pathname).toBe('/login/mindroom.chat');
      expect(router.state.location.search).toBe('?loginToken=abc123');
      expect(Browser.close).toHaveBeenCalledTimes(1);
    });
  });

  it('hands a waiting cold link to the next navigator once, and to none after a reset or an SSO callback', async () => {
    const navigator = vi.fn();
    const alpha = 'https://chat.mindroom.chat/home/!alpha:example.org';
    await register(alpha);
    // A newer link takes the place of the one that waits.
    openUrl({ url: 'https://chat.mindroom.chat/home/!beta:example.org' });
    setNativeAppPathNavigator(navigator);
    expect(navigator).toHaveBeenCalledTimes(1);
    expect(navigator).toHaveBeenCalledWith(getHomeRoomPath('!beta:example.org'), {
      state: OPENED_FROM_OUTSIDE_STATE,
      replace: true,
    });

    // Handed over once: a navigator named later gets nothing, and a link that arrives is a push.
    setNativeAppPathNavigator(undefined);
    setNativeAppPathNavigator(navigator);
    expect(navigator).toHaveBeenCalledTimes(1);
    openUrl({ url: 'https://chat.mindroom.chat/home/!gamma:example.org' });
    expect(navigator).toHaveBeenLastCalledWith(getHomeRoomPath('!gamma:example.org'), {
      state: OPENED_FROM_OUTSIDE_STATE,
      replace: false,
    });

    navigator.mockClear();
    setNativeAppPathNavigator(undefined);
    openUrl({ url: alpha });
    setNativeAppPathNavigator(undefined);
    setNativeAppPathNavigator(navigator);
    expect(navigator).not.toHaveBeenCalled();

    setNativeAppPathNavigator(undefined);
    openUrl({ url: alpha });
    openUrl({ url: 'mindroom://auth/login/example.org?loginToken=abc123' });
    setNativeAppPathNavigator(navigator);
    expect(navigator).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe(
      '/login/example.org?loginToken=abc123'
    );
  });

  it('sanitizes via, viaServers, threadId, and focusEvent query parameters', () => {
    expect(
      getAppPathFromUniversalLink(
        'https://chat.mindroom.chat/!harbor:example.org?via=example.org&via=bad%20server&via=has,comma&via=bad%00.org&viaServers=relay.example.org,,example.org,remote.example.org&threadId=not-event&focusEvent=2&unknown=secret#frag'
      )
    ).toBe(
      withSearchParam(getSpacePath('!harbor:example.org'), {
        viaServers: 'example.org,relay.example.org,remote.example.org',
      })
    );

    expect(
      getAppPathFromUniversalLink(
        'https://chat.mindroom.chat/connect?code=ABCD-EFGH&via=example.org#frag'
      )
    ).toBe(getConnectPath('ABCD-EFGH'));
  });

  it.each([
    'not a url',
    'http://chat.mindroom.chat/!harbor:example.org',
    'https://other.example/!harbor:example.org',
    'https://chat.mindroom.chat.example/!harbor:example.org',
    'https://chat.mindroom.chat:8443/!harbor:example.org',
    'https://user:pass@chat.mindroom.chat/!harbor:example.org',
    'https://chat.mindroom.chat/',
    'https://chat.mindroom.chat/login/example.org',
    'https://chat.mindroom.chat/connections',
    'https://chat.mindroom.chat/quick-capture',
    'https://chat.mindroom.chat/home',
    'https://chat.mindroom.chat/home/create',
    'https://chat.mindroom.chat/home/search',
    'https://chat.mindroom.chat/rooms',
    'https://chat.mindroom.chat//!harbor:example.org',
    'https://chat.mindroom.chat/home//!harbor:example.org',
    'https://chat.mindroom.chat/!harbor:example.org//',
    'https://chat.mindroom.chat/home\\!harbor:example.org',
    'https://chat.mindroom.chat/%ZZ',
    'https://chat.mindroom.chat/!harbor%E0%A4%A:example.org',
    'https://chat.mindroom.chat/!harbor%00:example.org',
    'https://chat.mindroom.chat/!harbor%0a:example.org',
    'https://chat.mindroom.chat/!harbor%7f:example.org',
    'https://chat.mindroom.chat/@reader:example.org',
    'https://chat.mindroom.chat/%23missing-server',
    'https://chat.mindroom.chat/!',
    'https://chat.mindroom.chat/home/!harbor:example.org/not-an-event',
    'https://chat.mindroom.chat/!space:example.org/search',
    'https://chat.mindroom.chat/!space:example.org/Search/',
    'https://chat.mindroom.chat/%23space:example.org/se%61rch',
    'https://chat.mindroom.chat/!space:example.org/lobby/$entry-1',
    'https://chat.mindroom.chat/!space:example.org/Lobby/$entry-1',
    'https://chat.mindroom.chat/!space:example.org/!harbor:example.org/$entry-1/extra',
    'https://chat.mindroom.chat/home/!harbor:example.org/$entry-1/extra',
  ])(
    'rejects unsafe or unsupported Universal Link without logging URL contents: %s',
    async (url) => {
      expect(getAppPathFromUniversalLink(url)).toBeUndefined();
      await register();
      openUrl({ url });
      expect(window.location.pathname).toBe('/home');
      expect(warn).toHaveBeenCalledWith('[MindRoom] Ignored unsupported app URL');
      expect(Browser.close).not.toHaveBeenCalled();
    }
  );

  it('keeps public/.well-known/apple-app-site-association consistent with supported and excluded routes', () => {
    const aasaPath = resolve(process.cwd(), 'public/.well-known/apple-app-site-association');
    const aasa = JSON.parse(readFileSync(aasaPath, 'utf8')) as AasaDocument;

    const detail = aasa.applinks.details.find((entry) =>
      entry.appIDs.includes('DNA6966LGZ.chat.mindroom.app')
    );
    expect(detail).toBeDefined();
    const components = detail!.components;

    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const generatedNativeLinks = [
      getMatrixToRoom('!harbor:example.org', ['example.org', 'relay.example.org']),
      getMatrixToRoom('#field-notes:remote.example.org'),
      getMatrixToRoom('#field/notes?north:remote.example.org', ['remote.example.org']),
      getMatrixToRoomEvent('!harbor:example.org', '$entry-1', ['example.org']),
      getMatrixToRoomEvent('!harbor/desk:example.org', '$entry/1?rev#2', ['example.org']),
      getMatrixToRoomEvent('#field-notes:remote.example.org', '$entry-2'),
    ];

    const supportedLinks = [
      'https://chat.mindroom.chat/connect?code=ABCD-EFGH',
      'https://chat.mindroom.chat/connect/?code=ABCD-EFGH',
      'https://chat.mindroom.chat/!harbor:example.org',
      'https://chat.mindroom.chat/%21harbor:example.org',
      'https://chat.mindroom.chat/%23field-notes:remote.example.org',
      'https://chat.mindroom.chat/!harbor:example.org/$entry-1?via=example.org',
      'https://chat.mindroom.chat/!space:example.org/lobby',
      'https://chat.mindroom.chat/!space:example.org/Lobby',
      'https://chat.mindroom.chat/%21space:example.org/LOBBY/',
      'https://chat.mindroom.chat/!space:example.org/!harbor:example.org',
      // A room whose address only holds the word is no search page.
      'https://chat.mindroom.chat/!space:example.org/%23search:example.org',
      'https://chat.mindroom.chat/%23search:example.org',
      'https://chat.mindroom.chat/!space:example.org/!harbor:example.org/$entry-1',
      'https://chat.mindroom.chat/home/!harbor:example.org',
      'https://chat.mindroom.chat/home/%21harbor:example.org/$entry-1',
      'https://chat.mindroom.chat/home/%23field-notes:remote.example.org',
      'https://chat.mindroom.chat/direct/!dm:example.org',
      'https://chat.mindroom.chat/direct/%21dm:example.org/$entry-1',
      'https://chat.mindroom.chat/direct/%23dm:remote.example.org',
      'https://chat.mindroom.chat/threads/!harbor:example.org?threadId=$root-1',
      'https://chat.mindroom.chat/threads/%21harbor:example.org/$entry-1',
      'https://chat.mindroom.chat/threads/%23field-notes:remote.example.org',
      'https://chat.mindroom.chat/activity/!harbor:example.org',
      'https://chat.mindroom.chat/activity/%21harbor:example.org/$entry-1',
      'https://chat.mindroom.chat/activity/%23field-notes:remote.example.org',
      ...generatedNativeLinks,
    ];

    for (const url of supportedLinks) {
      expect(matchesAasaComponents(components, url), `AASA should match ${url}`).toBe(true);
      expect(getAppPathFromUniversalLink(url), `Router should accept ${url}`).toBeDefined();
    }

    const excludedPaths = [
      '/',
      '/login/example.org',
      '/register',
      '/reset-password',
      '/connections',
      '/quick-capture',
      '/invite',
      '/home/create',
      '/home/join',
      '/home/search',
      '/assets/main.js',
      '/public/icon.png',
      '/config.json',
      '/rooms',
      '/connect/child',
      '/CONNECT',
      '/HOME/!harbor:example.org',
      // A space's search page, in any letter case and percent-encoding of the path.
      '/!space:example.org/search',
      '/!space:example.org/search/',
      '/!space:example.org/Search/',
      '/!space:example.org/SEARCH',
      '/!space:example.org/%73earch/',
      '/%21space:example.org/search/',
      '/%21space:example.org/Search/',
      '/%23space:example.org/search/',
      '/%23space:example.org/se%61rch/',
    ];

    for (const path of excludedPaths) {
      const url = `https://chat.mindroom.chat${path}`;
      expect(matchesAasaComponents(components, url), `AASA must exclude ${path}`).toBe(false);
      expect(getAppPathFromUniversalLink(url), `Router must reject ${path}`).toBeUndefined();
    }
  });
});
