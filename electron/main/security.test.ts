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
  registerExternalOpenHandler,
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
  it('allows http, https, and mailto URLs without media paths or access tokens', () => {
    for (const url of [
      'https://example.org/path?q=1',
      'http://127.0.0.1:8000/docs',
      'mailto:alice@example.org',
      'mailto:alice@example.org?subject=Hello',
    ]) {
      expect(isOpenable(url), url).toBe(true);
    }
  });

  it('refuses non-web schemes, Matrix media paths, and URLs carrying access_token', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,hi',
      'blob:https://example.org/123',
      'capacitor://localhost/home',
      'mindroom://auth/login',
      'mailto:',
      'https://example.org/page?access_token=syt_secret',
      'https://example.org/page?a=1&ACCESS_TOKEN=syt_secret',
      'https://example.org/page?%61ccess_token=syt_secret',
      'https://example.org/page#access_token=syt_secret',
      'https://example.org/page#%61ccess_token=syt_secret',
      'https://example.org/#/route?access_token=syt_secret',
      'https://example.org/#/route?%61ccess_token=syt_secret',
      'https://example.org/#/route?a=1&%41CCESS_TOKEN=syt_secret',
      'mailto:alice@example.org?access_token=syt_secret',
      'mailto:alice@example.org?attach=/etc/passwd',
      'mailto:alice@example.org?ATTACH=/etc/passwd',
      'mailto:alice@example.org?attachment=/etc/passwd',
      'mailto:alice@example.org?%61ttach=/etc/passwd',
      'https://user:pass@example.org/',
      'https://user@example.org/',
      'https://:pass@example.org/',
      'https://hs.example/_matrix/client/v1/media/download/hs.example/abc',
      'https://hs.example/_matrix/client/v1/media/thumbnail/hs.example/abc?width=64',
      'https://hs.example/_matrix/media/v3/download/hs.example/abc',
      'https://hs.example/_matrix/media/r0/thumbnail/hs.example/abc',
      'https://hs.example/sub/_matrix/client/v1/media/download/hs.example/abc',
      'https://hs.example/%5fmatrix/client/v1/media/download/hs.example/abc',
      'https://hs.example/_matrix/client/v1/media%2fdownload/hs.example/abc',
      'https://hs.example/_matrix/client/unstable/org.matrix.msc3916/media/download/hs.example/abc',
      'https://hs.example/_matrix/federation/v1/media/download/abc',
      'https://hs.example/_matrix/federation/v1/media/thumbnail/abc',
      'https://hs.example/_matrix//media/v3/download/hs.example/abc',
      'https://example.org/a\nb',
      'not-a-url',
    ]) {
      expect(isOpenable(url), url).toBe(false);
    }
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
    expect(await openExternal(event, 'https://example.org/?access_token=1')).toEqual({
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
