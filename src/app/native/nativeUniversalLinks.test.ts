// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMatrixToRoom, getMatrixToRoomEvent } from '../matrix/matrix-to';
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
import { getAppPathFromUniversalLink, registerNativeAppUrlCallbacks } from './nativeSso';

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

const aasaWildcardToRegExp = (pattern: string, caseSensitive: boolean): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
  return new RegExp(regexSource, caseSensitive ? '' : 'i');
};

/**
 * Evaluates Apple AASA component matching rules for path patterns.
 * Apple defaults `percentEncoded: true` and `caseSensitive: true`, and stops on the first match.
 */
const matchesAasaComponents = (components: readonly AasaComponent[], href: string): boolean => {
  const parsed = new URL(href);
  for (const component of components) {
    const pattern = component['/'];
    if (pattern === undefined) continue;
    const percentEncoded = component.percentEncoded ?? true;
    const caseSensitive = component.caseSensitive ?? true;
    const candidatePath = percentEncoded ? parsed.pathname : decodeURIComponent(parsed.pathname);
    if (aasaWildcardToRegExp(pattern, caseSensitive).test(candidatePath)) {
      return !(component.exclude ?? false);
    }
  }
  return false;
};

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

  afterEach(() => vi.restoreAllMocks());

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
    'https://chat.mindroom.chat/!space:example.org/lobby/$entry-1',
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
      'https://chat.mindroom.chat/!space:example.org/!harbor:example.org',
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
    ];

    for (const path of excludedPaths) {
      const url = `https://chat.mindroom.chat${path}`;
      expect(matchesAasaComponents(components, url), `AASA must exclude ${path}`).toBe(false);
    }
  });
});
