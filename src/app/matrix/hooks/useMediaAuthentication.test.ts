import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDesktopMediaAuth } from '../../native/desktopMediaAuth';
import { MINDROOM_SESSION_STORE_KEY } from '../../lib/sessionStoreConfig';
import {
  hasMediaAuthTransportSupport,
  shouldUseMediaAuthentication,
  useMediaAuthentication,
} from './useMediaAuthentication';

vi.mock('./useSpecVersions', () => ({
  useSpecVersions: () => ({ versions: ['v1.11'] }),
}));

vi.mock('../../config/runtimeConfig', () => ({
  isServiceWorkerEnabled: () => true,
}));

type MockServiceWorkerContainer = EventTarget & { controller: object | null };

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, 'window');
  } else {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
  startDesktopMediaAuth();
  vi.restoreAllMocks();
});

describe('shouldUseMediaAuthentication', () => {
  it('returns false when spec supports authenticated media but service worker is disabled', () => {
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        false
      )
    ).toBe(false);
  });

  it('returns true when spec supports authenticated media and service worker is enabled', () => {
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        true
      )
    ).toBe(true);
  });

  it('returns true when service worker is unavailable but Capacitor transport fallback is available', () => {
    expect(hasMediaAuthTransportSupport(false, true)).toBe(true);
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        true
      )
    ).toBe(true);
  });

  it('reactively enables authenticated media after service worker takeover', () => {
    const serviceWorker = new EventTarget() as MockServiceWorkerContainer;
    serviceWorker.controller = null;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serviceWorker },
    });
    let mediaAuthentication = true;
    const Probe = () => {
      mediaAuthentication = useMediaAuthentication();
      return null;
    };

    act(() => {
      renderer = create(React.createElement(Probe));
    });
    expect(mediaAuthentication).toBe(false);

    act(() => {
      serviceWorker.controller = {};
      serviceWorker.dispatchEvent(new Event('controllerchange'));
    });
    expect(mediaAuthentication).toBe(true);
  });

  it('disables native URL media transport in the desktop app on capacitor://localhost', () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { protocol: 'capacitor:' },
        mindroomDesktop: {
          onShellEvent: vi.fn(() => vi.fn()),
          setMediaSession: vi.fn(async () => ({ ok: true, value: undefined })),
        },
      },
    });
    let mediaAuthentication = true;
    const Probe = () => {
      mediaAuthentication = useMediaAuthentication();
      return null;
    };

    act(() => {
      renderer = create(React.createElement(Probe));
    });
    expect(mediaAuthentication).toBe(false);
  });

  it('keeps native URL media transport on capacitor://localhost without the desktop bridge', () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { protocol: 'capacitor:' } },
    });
    let mediaAuthentication = false;
    const Probe = () => {
      mediaAuthentication = useMediaAuthentication();
      return null;
    };

    act(() => {
      renderer = create(React.createElement(Probe));
    });
    expect(mediaAuthentication).toBe(true);
  });

  it('reactively enables authenticated media in the desktop app once main acknowledges the session', async () => {
    let resolveAck!: (result: { ok: true; value: undefined }) => void;
    const setMediaSession = vi.fn(
      () =>
        new Promise<{ ok: true; value: undefined }>((resolve) => {
          resolveAck = resolve;
        })
    );
    const store = new Map<string, string>([
      [
        MINDROOM_SESSION_STORE_KEY,
        JSON.stringify({
          version: 1,
          activeSessionId: 's1',
          sessions: [
            {
              sessionId: 's1',
              baseUrl: 'https://hs.example',
              userId: '@u:example',
              deviceId: 'D1',
              accessToken: 'tok-1',
              lastUsedAt: 1,
            },
          ],
        }),
      ],
    ]);
    const localStorageStub = {
      getItem: (key: string) => store.get(key) ?? null,
    };
    const eventTarget = new EventTarget();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorageStub,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: Object.assign(eventTarget, {
        location: { protocol: 'capacitor:' },
        mindroomDesktop: { onShellEvent: vi.fn(() => vi.fn()), setMediaSession },
      }),
    });
    try {
      startDesktopMediaAuth();
      let mediaAuthentication = true;
      const Probe = () => {
        mediaAuthentication = useMediaAuthentication();
        return null;
      };
      act(() => {
        renderer = create(React.createElement(Probe));
      });
      expect(mediaAuthentication).toBe(false);

      await act(async () => {
        resolveAck({ ok: true, value: undefined });
        await Promise.resolve();
      });
      expect(mediaAuthentication).toBe(true);
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
