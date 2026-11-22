import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    vi.resetModules();
    let resolveAck!: (result: { ok: true; value: undefined }) => void;
    const setMediaSession = vi.fn(
      () =>
        new Promise<{ ok: true; value: undefined }>((resolve) => {
          resolveAck = resolve;
        })
    );
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { protocol: 'capacitor:' },
        mindroomDesktop: { onShellEvent: vi.fn(() => vi.fn()), setMediaSession },
      },
    });
    const { startDesktopMediaAuth } = await import('../../native/desktopMediaAuth');
    const { useMediaAuthentication: useMediaAuth } = await import('./useMediaAuthentication');
    startDesktopMediaAuth(
      () => ({ baseUrl: 'https://hs.example', accessToken: 'tok-1' }),
      () => () => undefined
    );
    let mediaAuthentication = true;
    const Probe = () => {
      mediaAuthentication = useMediaAuth();
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
  });
});
