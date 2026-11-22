import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));

import { APP_ORIGIN } from './bundleProtocol';
import { guardSession, guardWebContents } from './security';

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
