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
import * as paths from '../routes/pathUtils';
import {
  currentHistoryLocation,
  OPENED_FROM_OUTSIDE_STATE,
  previousHistoryPathname,
  useHistoryStackRecorder,
} from '../routes/historyStack';
import { registerNativeAppUrlCallbacks } from './nativeSso';
import {
  createRouterAppPathNavigator,
  getAppPathFromUniversalLink,
  moveWaitingUniversalLinkAfterHash,
  setNativeAppPathNavigator,
} from './nativeUniversalLinks';

vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn() } }));

type AasaComp = {
  '/'?: string;
  exclude?: boolean;
  caseSensitive?: boolean;
  percentEncoded?: boolean;
};
type AasaDoc = { applinks: { details: Array<{ appIDs: string[]; components: AasaComp[] }> } };
type TestRouter = ReturnType<typeof createBrowserRouter>;

const U = (path: string) => `https://chat.mindroom.chat${path}`;
const R = '!harbor:example.org';
const S = '!space:example.org';
const PUSH_OUTSIDE = { replace: false, state: OPENED_FROM_OUTSIDE_STATE };
const el = React.createElement;

const matchesAasa = (components: readonly AasaComp[], href: string): boolean => {
  const { pathname } = new URL(href);
  for (const c of components) {
    if (c['/'] === undefined) continue;
    let path = pathname;
    if (c.percentEncoded === false) {
      try {
        path = decodeURIComponent(pathname);
      } catch {
        continue;
      }
    }
    const pat = c['/']
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    if (new RegExp(`^${pat}$`, c.caseSensitive === false ? 'is' : 's').test(path))
      return !(c.exclude ?? false);
  }
  return false;
};

function Recorder() {
  useHistoryStackRecorder('@reader:example.org');
  return null;
}

function RouterHarness({ router }: { router: TestRouter }) {
  React.useLayoutEffect(
    () => setNativeAppPathNavigator(createRouterAppPathNavigator(router)),
    [router]
  );
  return el(RouterProvider, { router });
}

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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('parses, sanitizes, and routes cold and warm Universal Links', async () => {
    const q = paths.withSearchParam;
    const cases: Array<[string, string]> = [
      [
        `/${R}?via=example.org&threadId=bad&focusEvent=2`,
        q(paths.getSpacePath(R), { viaServers: 'example.org' }),
      ],
      ['/%23a%2Fb:remote.example.org/', paths.getSpacePath('#a/b:remote.example.org')],
      [
        '/%21h%2Fd:example.org/%24e%2F1?via=example.org&via=bad%20h&via=a,b&via=bad%00.o&viaServers=relay.example.org,,example.org&threadId=$r1&focusEvent=1&utm=drop#f',
        q(paths.getSpaceRoomPath('!h/d:example.org', '$e/1'), {
          viaServers: 'example.org,relay.example.org',
          threadId: '$r1',
          focusEvent: '1',
        }),
      ],
      [`/home/${R}/$e1?threadId=$r1`, q(paths.getHomeRoomPath(R, '$e1'), { threadId: '$r1' })],
      [
        `/home/${R}?threadId=$root&forkAt=$point`,
        q(paths.getHomeRoomPath(R), { threadId: '$root', forkAt: '$point' }),
      ],
      [`/home/${R}?forkAt=$point`, paths.getHomeRoomPath(R)],
      [`/home/${R}?threadId=bad&forkAt=$point`, paths.getHomeRoomPath(R)],
      [`/home/${R}?threadId=$root&forkAt=bad`, q(paths.getHomeRoomPath(R), { threadId: '$root' })],
      [
        `/home/${R}?forkRoom=%21alpha%3Aexample.org&forkThread=$root&forkAt=$point`,
        q(paths.getHomeRoomPath(R), {
          forkRoom: '!alpha:example.org',
          forkThread: '$root',
          forkAt: '$point',
        }),
      ],
      [
        `/home/${R}?forkRoom=%21v12opaque&forkThread=$root&forkAt=$point`,
        q(paths.getHomeRoomPath(R), {
          forkRoom: '!v12opaque',
          forkThread: '$root',
          forkAt: '$point',
        }),
      ],
      [`/home/${R}?forkRoom=%21alpha%3Aexample.org&forkAt=$point`, paths.getHomeRoomPath(R)],
      [`/home/${R}?forkRoom=bad&forkThread=$root&forkAt=$point`, paths.getHomeRoomPath(R)],
      [
        `/home/${R}?threadId=$t&forkRoom=%21alpha%3Aexample.org&forkThread=$root&forkAt=$point`,
        q(paths.getHomeRoomPath(R), { threadId: '$t' }),
      ],
      ['/direct/%23dm:example.org/$e2', paths.getDirectRoomPath('#dm:example.org', '$e2')],
      [
        `/threads/${R}?threadId=$r2&focusEvent=1`,
        q(paths.getThreadsRoomPath(R), { threadId: '$r2', focusEvent: '1' }),
      ],
      [`/activity/${R}/$e3`, paths.getActivityRoomPath(R, '$e3')],
      [
        `/${S}/Lobby/?via=example.org&threadId=$r1&forkAt=$point&focusEvent=1#h`,
        q(paths.getSpaceLobbyPath(S), { viaServers: 'example.org' }),
      ],
      [`/${S}/%23n:example.org/$e4`, paths.getSpaceRoomPath(S, '#n:example.org', '$e4')],
      ['/connect?code=ABCD-EFGH&via=example.org#frag', paths.getConnectPath('ABCD-EFGH')],
    ];
    const origin = window.location.origin;
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);
    try {
      await register(U(cases[0]![0]));
      expect(window.location.origin).toBe(origin);
      expect(window.location.pathname + window.location.search).toBe(cases[0]![1]);
      for (const [path, expected] of cases.slice(1)) {
        const url = U(path);
        expect(getAppPathFromUniversalLink(url)).toBe(expected);
        openUrl({ url });
        expect(window.location.pathname + window.location.search + window.location.hash, path).toBe(
          expected
        );
      }
      expect(onPopState).toHaveBeenCalledTimes(cases.length);
      expect(Browser.close).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', onPopState);
    }
  });

  it('rejects unsafe or unsupported Universal Links without logging URL contents', async () => {
    const rejected = [
      'not a url',
      `http://chat.mindroom.chat/${R}`,
      `https://other.example/${R}`,
      `https://user:pass@chat.mindroom.chat/${R}`,
      U(`//${R}`),
      U(`/home\\${R}`),
      U('/%ZZ'),
      U('/!harbor%00:example.org'),
      U('/@reader:example.org'),
      U('/%23missing-server'),
      U(`/home/${R}/not-an-event`),
      U(`/${S}/lobby/$e1`),
      U(`/${S}/${R}/$e1/extra`),
    ];
    await register();
    for (const url of rejected) {
      expect(getAppPathFromUniversalLink(url), url).toBeUndefined();
      openUrl({ url });
    }
    expect(window.location.pathname).toBe('/home');
    expect(warn).toHaveBeenCalledTimes(rejected.length);
    expect(warn).toHaveBeenCalledWith('[MindRoom] Ignored unsupported app URL');
    expect(Browser.close).not.toHaveBeenCalled();
  });

  describe('with a mounted router', () => {
    let renderer: ReactTestRenderer | undefined;
    const mount = (el: React.ReactElement) => act(async () => void (renderer = create(el)));
    const harness = (router: TestRouter) => el(RouterHarness, { router });
    const open = (url: string) => act(async () => openUrl({ url }));

    afterEach(() => {
      act(() => renderer?.unmount());
      renderer = undefined;
    });

    it('pushes warm links, closes phone overlays, and resets historyStack', async () => {
      window.history.replaceState(null, '', '/home/');
      const store = createStore();
      const membersOut = { '@reader:example.org': true };
      store.set(phoneDrawerOpenAtom, membersOut);
      function Page() {
        useHistoryStackRecorder('@reader:example.org');
        return el(MembersOverlayFollowsNavigation);
      }
      const router = createBrowserRouter([{ path: '*', element: el(Page) }]);
      await mount(el(Provider, { store }, harness(router)));
      await register();

      await open(U('/home/!alpha:example.org'));
      expect(router.state.historyAction).toBe('PUSH');
      expect(router.state.location.state).toEqual(OPENED_FROM_OUTSIDE_STATE);
      expect(nextPhoneNavDrawerOpen(true, false, router.state.historyAction, false)).toBe(false);
      expect(store.get(phoneDrawerOpenAtom)).toEqual({});
      expect(currentHistoryLocation()?.pathname).toBe(paths.getHomeRoomPath('!alpha:example.org'));
      expect(previousHistoryPathname()).toBeUndefined();

      store.set(phoneDrawerOpenAtom, membersOut);
      await open(U('/activity/!beta:example.org?threadId=$root'));
      expect(store.get(phoneDrawerOpenAtom)).toEqual({});
      expect(currentHistoryLocation()?.search).toBe('?threadId=%24root');
      expect(previousHistoryPathname()).toBeUndefined();

      await act(
        async () => void (await router.navigate(paths.getHomeRoomPath('!gamma:example.org')))
      );
      expect(previousHistoryPathname()).toBe(paths.getActivityRoomPath('!beta:example.org'));
    });

    it('skips cold replace if browser router already started on link, else replaces', async () => {
      await register(U(`/home/${R}?via=example.org`));
      const browser = createBrowserRouter([{ path: '*', element: el(Recorder) }]);
      const navigate = vi.spyOn(browser, 'navigate');
      await mount(harness(browser));
      expect(navigate).not.toHaveBeenCalled();
      expect(shownPath(browser)).toBe(
        paths.withSearchParam(paths.getHomeRoomPath(R), { viaServers: 'example.org' })
      );

      act(() => renderer?.unmount());
      window.history.replaceState(null, '', '/#/home/');
      const hash = createHashRouter([{ path: '*', element: el(Recorder) }]);
      await mount(el(RouterProvider, { router: hash }));
      await act(async () => register(U(`/home/${S}`)));
      await act(() => void setNativeAppPathNavigator(createRouterAppPathNavigator(hash)));
      expect(hash.state.historyAction).toBe('REPLACE');
      expect(hash.state.location.state).toEqual(OPENED_FROM_OUTSIDE_STATE);
      expect(shownPath(hash)).toBe(paths.getHomeRoomPath(S));
    });

    it.each([undefined, '/', '/app/', 'app'])(
      'starts hash router (basename %s) on cold link',
      async (basename) => {
        window.history.replaceState(null, '', '/');
        const base = basename?.replace(/^\/+|\/+$/g, '');
        const prefix = base ? `/${base}` : '';
        const launchUrl = U(`/${R}/$e1?via=example.org&focusEvent=1`);
        await register(launchUrl);
        const appPath = paths.withSearchParam(paths.getSpaceRoomPath(R, '$e1'), {
          viaServers: 'example.org',
          focusEvent: '1',
        });
        moveWaitingUniversalLinkAfterHash(basename);
        const router = createHashRouter(
          [
            { path: '/', element: el(Navigate, { to: '/home/', replace: true }) },
            { path: '*', element: el(Recorder) },
          ],
          basename === undefined ? {} : { basename }
        );
        const navigate = vi.spyOn(router, 'navigate');
        await mount(harness(router));

        expect(navigate).not.toHaveBeenCalled();
        expect(shownPath(router)).toBe(`${prefix}${appPath}`);
        expect(window.location.pathname + window.location.search).toBe('/');
        expect(window.location.hash).toBe(`#${prefix}${appPath}`);
        const hashCfg = basename === undefined ? { enabled: true } : { enabled: true, basename };
        expect(resolveProtectedRouteRedirect(window.location.href, hashCfg, false)).toEqual({
          redirectTo: paths.getLoginPath(),
          afterLoginPath: appPath,
        });

        await open(launchUrl);
        expect(navigate).not.toHaveBeenCalled();
        await open(U('/home/!alpha:example.org'));
        expect(router.state.historyAction).toBe('PUSH');
        expect(window.location.hash).toBe(
          `#${prefix}${paths.getHomeRoomPath('!alpha:example.org')}`
        );

        if (basename === undefined) {
          navigate.mockClear();
          await open('mindroom://auth/#/login/example.org?loginToken=abc123');
          expect(navigate).not.toHaveBeenCalled();
          expect(window.location.hash).toBe('#/login/example.org?loginToken=abc123');
          expect(Browser.close).toHaveBeenCalledTimes(1);
        }
      }
    );

    it('dedupes launch replay across redirects, expires after 2000ms, and clears on another URL', async () => {
      vi.useFakeTimers();
      window.history.replaceState(null, '', '/home/');
      const launchUrl = U(`/${R}`);
      const launchPath = paths.getSpacePath(R);

      // Redirect `/!harbor:example.org/` -> `/home/!harbor:example.org/` like SpaceRouteProvider.
      await register(launchUrl);
      const router = createBrowserRouter([
        { path: `/${R}/*`, element: el(Navigate, { to: paths.getHomeRoomPath(R), replace: true }) },
        { path: '*', element: el(Recorder) },
      ]);
      await mount(harness(router));
      expect(shownPath(router)).toBe(paths.getHomeRoomPath(R));
      const navigate = vi.spyOn(router, 'navigate');

      // Replayed launch URL within 2000ms is ignored even after redirect; second tap pushes.
      await open(launchUrl);
      expect(navigate).not.toHaveBeenCalled();
      await open(launchUrl);
      expect(navigate).toHaveBeenCalledWith(launchPath, PUSH_OUTSIDE);

      // Guard expires after 2000ms without replay.
      await act(async () => register(launchUrl));
      navigate.mockClear();
      vi.advanceTimersByTime(2000);
      await open(launchUrl);
      expect(navigate).toHaveBeenCalledWith(launchPath, PUSH_OUTSIDE);

      // A different URL clears the repeat guard for the launch URL.
      await act(async () => register(launchUrl));
      navigate.mockClear();
      await open(U('/home/!other:example.org'));
      await open(launchUrl);
      expect(navigate).toHaveBeenCalledWith(
        paths.getHomeRoomPath('!other:example.org'),
        PUSH_OUTSIDE
      );
      expect(navigate).toHaveBeenCalledWith(launchPath, PUSH_OUTSIDE);
    });
  });

  it('hands waiting cold link once, and clears it on reset or SSO callback', async () => {
    const nav = vi.fn();
    await register(U(`/home/${R}`));
    openUrl({ url: U(`/home/${S}`) });
    setNativeAppPathNavigator(nav);
    expect(nav).toHaveBeenCalledWith(paths.getHomeRoomPath(S), { ...PUSH_OUTSIDE, replace: true });
    setNativeAppPathNavigator(undefined);
    setNativeAppPathNavigator(nav);
    expect(nav).toHaveBeenCalledTimes(1);
    openUrl({ url: U(`/home/${R}`) });
    expect(nav).toHaveBeenLastCalledWith(paths.getHomeRoomPath(R), PUSH_OUTSIDE);

    nav.mockClear();
    setNativeAppPathNavigator(undefined);
    openUrl({ url: U(`/home/${R}`) });
    openUrl({ url: 'mindroom://auth/login/example.org?loginToken=abc123' });
    setNativeAppPathNavigator(nav);
    expect(nav).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe(
      '/login/example.org?loginToken=abc123'
    );
  });

  it('keeps AASA consistent with supported and excluded routes', () => {
    const aasa = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/.well-known/apple-app-site-association'), 'utf8')
    ) as AasaDoc;
    const components = aasa.applinks.details.find((e) =>
      e.appIDs.includes('DNA6966LGZ.chat.mindroom.app')
    )?.components;
    expect(components).toBeDefined();

    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const supported = [
      ...[
        '/connect?code=ABCD-EFGH',
        `/${R}`,
        '/%23notes:remote.example.org',
        `/${S}/Lobby`,
        `/${S}/%23search:example.org`,
        `/home/${R}/$e1`,
        '/direct/!dm:example.org/$e1',
        `/threads/${R}?threadId=$r1`,
        `/activity/${R}/$e1`,
      ].map(U),
      getMatrixToRoom(R, ['example.org', 'relay.example.org']),
      getMatrixToRoom('#field/notes?north:remote.example.org', ['remote.example.org']),
      getMatrixToRoomEvent('!harbor/desk:example.org', '$e/1?rev#2', ['example.org']),
    ];
    for (const url of supported) {
      expect(matchesAasa(components!, url), url).toBe(true);
      expect(getAppPathFromUniversalLink(url), url).toBeDefined();
    }

    for (const path of [
      '/',
      '/login/example.org',
      '/home/create',
      '/assets/main.js',
      '/CONNECT',
      `/HOME/${R}`,
      `/${S}/search`,
      `/${S}/Search/`,
      `/${S}/%73earch/`,
      '/%23space:example.org/se%61rch/',
    ]) {
      expect(matchesAasa(components!, U(path)), path).toBe(false);
      expect(getAppPathFromUniversalLink(U(path)), path).toBeUndefined();
    }
  });
});
