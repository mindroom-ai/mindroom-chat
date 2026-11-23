import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

import { APP_ORIGIN } from './bundleProtocol';
import {
  guardSession,
  guardWebContents,
  isOpenable,
  openableHref,
  registerExternalOpenHandler,
  supportsSystemScreenShare,
} from './security';

const createFakeWebContents = (
  mainFrame: { url: string; origin: string } = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN }
) => {
  const emitter = new EventEmitter();
  let openHandler: ((details: { url: string }) => { action: string }) | undefined;
  return {
    emitter,
    contents: Object.assign(emitter, {
      mainFrame,
      setWindowOpenHandler: vi.fn((fn: (details: { url: string }) => { action: string }) => {
        openHandler = fn;
      }),
    }) as unknown as Electron.WebContents,
    invokeOpenHandler: (url: string) => openHandler?.({ url }),
  };
};

const createFakeSession = () => {
  let beforeRequest:
    | ((
        details: { url: string; resourceType: string },
        callback: (response: { cancel?: boolean }) => void
      ) => void)
    | undefined;
  let permissionCheck:
    | ((
        webContents: Electron.WebContents | null,
        permission: string,
        requestingOrigin: string,
        details: { isMainFrame: boolean; requestingUrl?: string }
      ) => boolean)
    | undefined;
  let displayMediaHandler:
    | ((request: unknown, callback: (streams: Record<string, unknown> | null) => void) => void)
    | undefined;
  let displayMediaOpts: { useSystemPicker: boolean } | undefined;
  let permissionRequest:
    | ((
        webContents: Electron.WebContents,
        permission: string,
        callback: (granted: boolean) => void,
        details: { isMainFrame: boolean; requestingUrl: string }
      ) => void)
    | undefined;

  const session = {
    webRequest: {
      onBeforeRequest: vi.fn((_filter: unknown, listener: typeof beforeRequest) => {
        beforeRequest = listener;
      }),
    },
    setPermissionCheckHandler: vi.fn((handler: typeof permissionCheck) => {
      permissionCheck = handler;
    }),
    setPermissionRequestHandler: vi.fn((handler: typeof permissionRequest) => {
      permissionRequest = handler;
    }),
    setDisplayMediaRequestHandler: vi.fn(
      (
        handler: (
          request: unknown,
          callback: (streams: Record<string, unknown> | null) => void
        ) => void,
        opts?: { useSystemPicker: boolean }
      ) => {
        displayMediaHandler = handler;
        displayMediaOpts = opts;
      }
    ),
  } as unknown as Electron.Session;

  return {
    session,
    runBeforeRequest: (url: string, resourceType: string) => {
      let result: { cancel?: boolean } = {};
      beforeRequest?.({ url, resourceType }, (res) => {
        result = res;
      });
      return result;
    },
    runPermissionCheck: (
      webContents: Electron.WebContents | null,
      permission: string,
      requestingOrigin: string,
      details: { isMainFrame: boolean; requestingUrl?: string }
    ) => permissionCheck?.(webContents, permission, requestingOrigin, details),
    runPermissionRequest: (
      webContents: Electron.WebContents,
      permission: string,
      details: { isMainFrame: boolean; requestingUrl: string }
    ) => {
      let granted: boolean | undefined;
      permissionRequest?.(
        webContents,
        permission,
        (value) => {
          granted = value;
        },
        details
      );
      return granted;
    },
    getDisplayMediaOpts: () => displayMediaOpts,
    runDisplayMediaRequest: () => {
      let answer: Record<string, unknown> | null | undefined;
      displayMediaHandler?.({}, (streams) => {
        answer = streams;
      });
      return answer;
    },
  };
};

describe('security', () => {
  describe('guardWebContents', () => {
    it('denies every popup', () => {
      const { contents, invokeOpenHandler } = createFakeWebContents();
      guardWebContents(contents);
      expect(invokeOpenHandler('https://example.org')).toEqual({ action: 'deny' });
      expect(invokeOpenHandler(`${APP_ORIGIN}/home`)).toEqual({ action: 'deny' });
    });

    it('cancels top-level navigation away from the app origin or to a frame page', () => {
      const { emitter, contents } = createFakeWebContents();
      guardWebContents(contents);

      for (const blocked of [
        'https://example.org',
        'file:///etc/passwd',
        'capacitor://evil.com/home',
        `${APP_ORIGIN}/pdf-frame.html`,
        `${APP_ORIGIN}/%70df-frame%2ehtml`,
      ]) {
        const event = { preventDefault: vi.fn() };
        emitter.emit('will-navigate', event, blocked);
        expect(event.preventDefault, blocked).toHaveBeenCalledOnce();
      }

      const allowed = { preventDefault: vi.fn() };
      emitter.emit('will-navigate', allowed, `${APP_ORIGIN}/home`);
      expect(allowed.preventDefault).not.toHaveBeenCalled();
    });

    it('leaves subframe navigation alone', () => {
      const { emitter, contents } = createFakeWebContents();
      guardWebContents(contents);

      const subframeEvent = {
        preventDefault: vi.fn(),
        isMainFrame: false,
        url: 'https://example.org',
      };
      emitter.emit('will-frame-navigate', subframeEvent);
      expect(subframeEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('guardSession', () => {
    it('cancels non-subFrame requests for frame pages in every spelling', () => {
      const mainContents = createFakeWebContents().contents;
      const { session, runBeforeRequest } = createFakeSession();
      guardSession(session, (wc) => wc === mainContents);

      for (const url of [
        `${APP_ORIGIN}/pdf-frame.html`,
        `${APP_ORIGIN}/%70df-frame.html`,
        `${APP_ORIGIN}/pdf-frame%2ehtml`,
        `${APP_ORIGIN}//pdf-frame.html?a=1`,
      ]) {
        expect(runBeforeRequest(url, 'mainFrame'), url).toEqual({ cancel: true });
        expect(runBeforeRequest(url, 'xhr'), url).toEqual({ cancel: true });
        expect(runBeforeRequest(url, 'subFrame'), url).toEqual({ cancel: false });
      }

      expect(runBeforeRequest(`${APP_ORIGIN}/`, 'mainFrame')).toEqual({ cancel: false });
      expect(runBeforeRequest(`${APP_ORIGIN}/home`, 'mainFrame')).toEqual({ cancel: false });
    });

    it('grants only allowed permissions to the main window main frame with APP_ORIGIN', () => {
      const mainContents = createFakeWebContents().contents;
      const otherContents = createFakeWebContents().contents;
      const opaqueContents = createFakeWebContents({
        url: `${APP_ORIGIN}/home`,
        origin: 'null',
      }).contents;
      const framePageContents = createFakeWebContents({
        url: `${APP_ORIGIN}/pdf-frame.html`,
        origin: APP_ORIGIN,
      }).contents;
      const queriedNetwork: string[] = [];
      const { session, runPermissionCheck, runPermissionRequest } = createFakeSession();
      guardSession(
        session,
        (wc) => wc === mainContents || wc === opaqueContents || wc === framePageContents,
        (perm) => queriedNetwork.push(perm)
      );

      const allowed = [
        'media',
        'notifications',
        'clipboard-sanitized-write',
        'fullscreen',
        'persistent-storage',
        'local-network',
        'local-network-access',
        'loopback-network',
      ];
      for (const permission of allowed) {
        expect(
          runPermissionCheck(mainContents, permission, APP_ORIGIN, {
            isMainFrame: true,
            requestingUrl: `${APP_ORIGIN}/home`,
          }),
          `check ${permission}`
        ).toBe(true);
        expect(
          runPermissionRequest(mainContents, permission, {
            isMainFrame: true,
            requestingUrl: `${APP_ORIGIN}/home`,
          }),
          `request ${permission}`
        ).toBe(true);
      }
      expect(queriedNetwork).toEqual([
        'local-network',
        'local-network',
        'local-network-access',
        'local-network-access',
        'loopback-network',
        'loopback-network',
      ]);

      // Denied: other permissions, subframes, other origins, opaque origin, frame pages, other windows.
      for (const permission of ['geolocation', 'display-capture', 'openExternal', 'usb']) {
        expect(
          runPermissionCheck(mainContents, permission, APP_ORIGIN, {
            isMainFrame: true,
            requestingUrl: `${APP_ORIGIN}/home`,
          }),
          `check denied ${permission}`
        ).toBe(false);
        expect(
          runPermissionRequest(mainContents, permission, {
            isMainFrame: true,
            requestingUrl: `${APP_ORIGIN}/home`,
          }),
          `request denied ${permission}`
        ).toBe(false);
      }

      // Same app URL, but opaque mainFrame origin ("null") must be denied on both handlers.
      expect(
        runPermissionCheck(opaqueContents, 'media', APP_ORIGIN, {
          isMainFrame: true,
          requestingUrl: `${APP_ORIGIN}/home`,
        })
      ).toBe(false);
      expect(
        runPermissionRequest(opaqueContents, 'media', {
          isMainFrame: true,
          requestingUrl: `${APP_ORIGIN}/home`,
        })
      ).toBe(false);

      expect(
        runPermissionCheck(framePageContents, 'media', APP_ORIGIN, {
          isMainFrame: true,
          requestingUrl: `${APP_ORIGIN}/home`,
        })
      ).toBe(false);
      expect(
        runPermissionCheck(mainContents, 'media', APP_ORIGIN, {
          isMainFrame: false,
          requestingUrl: `${APP_ORIGIN}/home`,
        })
      ).toBe(false);
      expect(
        runPermissionRequest(mainContents, 'media', {
          isMainFrame: false,
          requestingUrl: `${APP_ORIGIN}/home`,
        })
      ).toBe(false);
      expect(
        runPermissionCheck(mainContents, 'media', 'https://example.org', {
          isMainFrame: true,
          requestingUrl: 'https://example.org/',
        })
      ).toBe(false);
      expect(
        runPermissionRequest(mainContents, 'media', {
          isMainFrame: true,
          requestingUrl: `${APP_ORIGIN}/pdf-frame.html`,
        })
      ).toBe(false);
      expect(
        runPermissionCheck(otherContents, 'media', APP_ORIGIN, {
          isMainFrame: true,
          requestingUrl: `${APP_ORIGIN}/home`,
        })
      ).toBe(false);
      expect(
        runPermissionRequest(otherContents, 'media', {
          isMainFrame: true,
          requestingUrl: `${APP_ORIGIN}/home`,
        })
      ).toBe(false);
    });
  });
});

describe('isOpenable', () => {
  const HS = 'https://hs.example';
  const nested = encodeURIComponent('https://b.example/cb?access_token=syt_placeholder');
  const cases: Array<[why: string, url: string, href?: string]> = [
    // Opens, as its canonical form.
    ['https link', 'https://example.org/path?q=1#frag', 'https://example.org/path?q=1#frag'],
    ['host is lowercased', 'https://EXAMPLE.org', 'https://example.org/'],
    ['http on loopback', 'http://127.0.0.1:8000/docs', 'http://127.0.0.1:8000/docs'],
    ['IDN host', 'https://bücher.example/a', 'https://xn--bcher-kva.example/a'],
    ['mailto', 'mailto:a@b.example', 'mailto:a@b.example'],
    ['mailto subject', 'mailto:a@b.example?subject=Hi', 'mailto:a@b.example?subject=Hi'],
    [
      'mailto, attach as a value',
      'mailto:a@b.example?subject=attach',
      'mailto:a@b.example?subject=attach',
    ],
    [
      'token only in text',
      'https://example.org/docs/access_token',
      'https://example.org/docs/access_token',
    ],
    [
      'media outside _matrix',
      'https://example.org/media/_matrix/x',
      'https://example.org/media/_matrix/x',
    ],
    [
      'at the length cap',
      `https://example.org/${'a'.repeat(8172)}`,
      `https://example.org/${'a'.repeat(8172)}`,
    ],
    // Shape and scheme.
    ['empty', ''],
    ['not a URL', 'not-a-url'],
    ['over the length cap', `https://example.org/${'a'.repeat(8173)}`],
    ['over the length cap once canonical', `https://example.org/${'é'.repeat(2000)}`],
    ['newline', 'https://example.org/a\nb'],
    ['tab', 'https://example.org/acc\tess_token=1'],
    ['NUL', 'https://example.org/\0'],
    ['DEL', 'https://example.org/\x7f'],
    ['javascript:', 'javascript:alert(1)'],
    ['file:', 'file:///etc/passwd'],
    ['data:', 'data:text/html,hi'],
    ['blob:', 'blob:https://example.org/123'],
    ['app scheme', 'capacitor://localhost/home'],
    ['custom scheme', 'mindroom://auth/login'],
    // Credentials, for every scheme.
    ['user and password', 'https://user:pass@example.org/'],
    ['user', 'https://user@example.org/'],
    ['password', 'https://:pass@example.org/'],
    ['mailto authority with credentials', 'mailto://user:pass@host.example/x'],
    ['mailto authority', 'mailto://host.example/x'],
    ['mailto empty authority', 'mailto:///x'],
    ['mailto nobody', 'mailto:'],
    ['mailto encoded blank', 'mailto:%20'],
    ['mailto twice encoded blank', 'mailto:%2520?subject=Hi'],
    // access_token as a parameter name or `access_token=` anywhere, however encoded.
    ['query', 'https://example.org/page?access_token=syt_placeholder'],
    ['query, upper case', 'https://example.org/page?a=1&ACCESS_TOKEN=syt_placeholder'],
    ['query, no value', 'https://example.org/page?access_token'],
    ['query, encoded key', 'https://example.org/page?%61ccess_token=syt_placeholder'],
    ['query, twice encoded key', 'https://example.org/page?%2561ccess%255Ftoken=syt_placeholder'],
    ['query, encoded equals', 'https://example.org/page?access_token%3Dsyt_placeholder'],
    [
      'query, bad escape beside it',
      'https://example.org/page?b=%zz&%61ccess_token=syt_placeholder',
    ],
    ['fragment', 'https://example.org/page#access_token=syt_placeholder'],
    ['fragment, encoded key', 'https://example.org/page#%61ccess_token=syt_placeholder'],
    ['hash route query', 'https://example.org/#/route?access_token=syt_placeholder'],
    ['hash route query, encoded', 'https://example.org/#/route?%61ccess_token=syt_placeholder'],
    ['hash route query, encoded upper', 'https://example.org/#/route?a=1&%41CCESS_TOKEN=x'],
    ['nested redirect', `https://a.example/go?next=${nested}`],
    ['nested redirect, twice encoded', `https://a.example/go?next=${encodeURIComponent(nested)}`],
    ['nested redirect in fragment', `https://a.example/#/go?next=${nested}`],
    ['mailto token', 'mailto:a@b.example?access_token=syt_placeholder'],
    // mailto attachments.
    ['attach', 'mailto:a@b.example?attach=/etc/passwd'],
    ['ATTACH', 'mailto:a@b.example?subject=x&ATTACH=/etc/passwd'],
    ['attachment', 'mailto:a@b.example?attachment=/etc/passwd'],
    ['encoded attach', 'mailto:a@b.example?%61ttach=/etc/passwd'],
    ['twice encoded attach', 'mailto:a@b.example?%2561ttach=/etc/passwd'],
    ['attach then encoded NUL', 'mailto:a@b.example?attach%00=/etc/passwd'],
    ['attach, no value', 'mailto:a@b.example?subject=x&attachment'],
    // Matrix media, every route family and spelling.
    ['media v3 download', `${HS}/_matrix/media/v3/download/hs.example/abc`],
    ['media r0 thumbnail', `${HS}/_matrix/media/r0/thumbnail/hs.example/abc`],
    ['client v1 download', `${HS}/_matrix/client/v1/media/download/hs.example/abc`],
    ['client v1 thumbnail', `${HS}/_matrix/client/v1/media/thumbnail/hs.example/abc?width=64`],
    ['MSC3916 unstable', `${HS}/_matrix/client/unstable/org.matrix.msc3916/media/download/a/b`],
    ['federation download', `${HS}/_matrix/federation/v1/media/download/abc`],
    ['federation thumbnail', `${HS}/_matrix/federation/v1/media/thumbnail/abc`],
    ['under a base path', `${HS}/sub/_matrix/client/v1/media/download/hs.example/abc`],
    ['doubled slash', `${HS}/_matrix//media/v3/download/hs.example/abc`],
    ['doubled slashes throughout', `${HS}//_matrix//client//v1//media//download/a/b`],
    ['upper case', `${HS}/_MATRIX/Media/v3/download/hs.example/abc`],
    ['encoded underscore', `${HS}/%5fmatrix/client/v1/media/download/hs.example/abc`],
    ['encoded slash', `${HS}/_matrix/client/v1%2fmedia%2fdownload/hs.example/abc`],
    ['twice encoded slash', `${HS}/_matrix/client/v1%252Fmedia%252Fdownload/hs.example/abc`],
    ['encoded backslash', `${HS}/_matrix%5Cmedia%5Cv3/download/hs.example/abc`],
    ['encoded letters', `${HS}/_m%61trix/m%2565dia/v3/download/hs.example/abc`],
    ['media as the last segment', `${HS}/_matrix/client/v1/media`],
    ['after many _matrix segments', `${HS}/${'_matrix/'.repeat(1000)}media/x`],
  ];

  it.each(cases)('%s', (_why, url, href) => {
    expect(openableHref(url)).toBe(href);
    expect(isOpenable(url)).toBe(href !== undefined);
  });
});

describe('external open IPC channel', () => {
  it('validates sender and openable URLs', async () => {
    ipcHandlers.clear();
    const opened: string[] = [];
    const mainFrame = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN };
    const owner = {
      isDestroyed: () => false,
      mainFrame,
    } as unknown as Electron.WebContents;
    registerExternalOpenHandler(
      () => [owner],
      async (url) => {
        opened.push(url);
      }
    );

    const event = { sender: owner, senderFrame: mainFrame };
    const badEvent = {
      sender: owner,
      senderFrame: { url: `${APP_ORIGIN}/canvas-frame.html`, origin: APP_ORIGIN },
    };

    const openExternal = ipcHandlers.get('desktop:open-external')!;
    expect(await openExternal(badEvent, 'https://example.org')).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await openExternal(event, 'javascript:alert(1)')).toEqual({
      ok: false,
      code: 'BAD_ARGUMENTS',
    });
    expect(await openExternal(event, 'https://example.org/?access_token=syt_placeholder')).toEqual({
      ok: false,
      code: 'BAD_ARGUMENTS',
    });
    expect(await openExternal(event)).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(await openExternal(event, 'https://a.example', 'https://b.example')).toEqual({
      ok: false,
      code: 'BAD_ARGUMENTS',
    });
    expect(await openExternal(event, 123)).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(await openExternal(event, null)).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(await openExternal(event, 'https://EXAMPLE.ORG')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(opened).toEqual(['https://example.org/']);
  });
});

describe('supportsSystemScreenShare', () => {
  it('enables system screen share on macOS 15+ and refuses older macOS or other platforms', () => {
    expect(supportsSystemScreenShare('darwin', '15.0')).toBe(true);
    expect(supportsSystemScreenShare('darwin', '15.3.1')).toBe(true);
    expect(supportsSystemScreenShare('darwin', '26.0')).toBe(true);
    expect(supportsSystemScreenShare('darwin', '14.7.1')).toBe(false);
    expect(supportsSystemScreenShare('darwin', '14.0')).toBe(false);
    expect(supportsSystemScreenShare('darwin', '')).toBe(false);
    expect(supportsSystemScreenShare('darwin', '15abc')).toBe(false);
    expect(supportsSystemScreenShare('linux', '15.0')).toBe(false);
    expect(supportsSystemScreenShare('win32', '26.0')).toBe(false);
  });

  it('honors explicit test overrides 1 and 0 and ignores other values', () => {
    expect(supportsSystemScreenShare('linux', '6.1', '1')).toBe(true);
    expect(supportsSystemScreenShare('darwin', '14.7.1', '1')).toBe(true);
    expect(supportsSystemScreenShare('darwin', '15.3.1', '0')).toBe(false);
    expect(supportsSystemScreenShare('darwin', '15.3.1', '')).toBe(true);
    expect(supportsSystemScreenShare('darwin', '14.7.1', 'other')).toBe(false);
  });
});

describe('guardSession screenShare', () => {
  it('refuses display-capture and disables system picker when screenShare is false', () => {
    const fake = createFakeSession();
    const main = createFakeWebContents();
    guardSession(fake.session, (wc) => wc === main.contents, undefined, { screenShare: false });

    expect(fake.getDisplayMediaOpts()).toEqual({ useSystemPicker: false });
    expect(fake.runDisplayMediaRequest()).toEqual({});
    expect(
      fake.runPermissionCheck(main.contents, 'display-capture', APP_ORIGIN, {
        isMainFrame: true,
        requestingUrl: `${APP_ORIGIN}/home`,
      })
    ).toBe(false);
    expect(
      fake.runPermissionRequest(main.contents, 'display-capture', {
        isMainFrame: true,
        requestingUrl: `${APP_ORIGIN}/home`,
      })
    ).toBe(false);
  });

  it('grants display-capture only to the main window main frame and keeps fallback refusing when screenShare is true', () => {
    const fake = createFakeSession();
    const main = createFakeWebContents();
    const other = createFakeWebContents();
    guardSession(fake.session, (wc) => wc === main.contents, undefined, { screenShare: true });

    expect(fake.getDisplayMediaOpts()).toEqual({ useSystemPicker: true });
    expect(fake.runDisplayMediaRequest()).toEqual({});

    expect(
      fake.runPermissionCheck(main.contents, 'display-capture', APP_ORIGIN, {
        isMainFrame: true,
        requestingUrl: `${APP_ORIGIN}/home`,
      })
    ).toBe(true);
    expect(
      fake.runPermissionRequest(main.contents, 'display-capture', {
        isMainFrame: true,
        requestingUrl: `${APP_ORIGIN}/home`,
      })
    ).toBe(true);

    // Denied for subframes and non-main windows.
    expect(
      fake.runPermissionCheck(main.contents, 'display-capture', APP_ORIGIN, {
        isMainFrame: false,
        requestingUrl: `${APP_ORIGIN}/home`,
      })
    ).toBe(false);
    expect(
      fake.runPermissionRequest(main.contents, 'display-capture', {
        isMainFrame: false,
        requestingUrl: `${APP_ORIGIN}/canvas-frame.html`,
      })
    ).toBe(false);
    expect(
      fake.runPermissionRequest(other.contents, 'display-capture', {
        isMainFrame: true,
        requestingUrl: `${APP_ORIGIN}/home`,
      })
    ).toBe(false);
  });
});
