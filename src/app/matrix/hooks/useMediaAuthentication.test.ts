import React from 'react';
import { act, create, type ReactTestRenderer, type TestRendererOptions } from 'react-test-renderer';
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
          setMediaSession: vi.fn(() => ({ ok: true, value: undefined })),
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

  const desktopHook = async () => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { protocol: 'capacitor:' },
        mindroomDesktop: {
          onShellEvent: vi.fn(() => vi.fn()),
          setMediaSession: vi.fn(() => ({ ok: true, value: undefined })),
        },
      },
    });
    const { desktopMediaAuthReady, startDesktopMediaAuth } =
      await import('../../native/desktopMediaAuth');
    const { useMediaAuthentication: useMediaAuth } = await import('./useMediaAuthentication');
    const store = {
      session: undefined as { baseUrl: string; userId: string; accessToken: string } | undefined,
      changed: (): void => undefined,
    };
    startDesktopMediaAuth(
      () => store.session,
      (listener) => {
        store.changed = listener;
        return () => undefined;
      }
    );
    const signIn = (accessToken: string): void => {
      store.session = { baseUrl: 'https://hs.example', userId: '@alice:hs', accessToken };
      store.changed();
    };
    const signOut = (): void => {
      store.session = undefined;
      store.changed();
    };
    return { desktopMediaAuthReady, useMediaAuth, signIn, signOut };
  };

  it('follows the desktop session: on at sign-in, unchanged by a token refresh, off at logout', async () => {
    const { useMediaAuth, signIn, signOut } = await desktopHook();
    const rendered: boolean[] = [];
    const Probe = () => {
      rendered.push(useMediaAuth());
      return null;
    };
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    expect(rendered.at(-1)).toBe(false);

    act(() => signIn('tok-1'));
    expect(rendered.at(-1)).toBe(true);

    const renders = rendered.length;
    act(() => signIn('tok-2'));
    expect(rendered).toHaveLength(renders);

    act(() => signOut());
    expect(rendered.at(-1)).toBe(false);
  });

  it('never commits a transport state older than the store when it changes during a paused render', async () => {
    const { desktopMediaAuthReady, useMediaAuth, signIn, signOut } = await desktopHook();
    signIn('tok-1');
    const commits: Array<{ hook: boolean; store: boolean }> = [];
    const Probe = () => {
      const hook = useMediaAuth();
      React.useLayoutEffect(() => {
        commits.push({ hook, store: desktopMediaAuthReady() });
      });
      return null;
    };
    // Stands in for a logout that lands while a concurrent render of Probe is paused.
    let interleave = true;
    const Interleaved = () => {
      if (interleave) {
        interleave = false;
        signOut();
      }
      return null;
    };
    let show!: () => void;
    const App = () => {
      const [shown, setShown] = React.useState(false);
      show = () => setShown(true);
      return shown
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement(Probe),
            React.createElement(Interleaved)
          )
        : null;
    };
    act(() => {
      // A concurrent root, so the transition below renders in a lane that may be interrupted.
      renderer = create(React.createElement(App), {
        createNodeMock: () => null,
        unstable_isConcurrent: true,
      } as TestRendererOptions);
    });
    act(() => React.startTransition(show));

    expect(commits.length).toBeGreaterThan(0);
    expect(commits.filter(({ hook, store }) => hook !== store)).toEqual([]);
    expect(commits.at(-1)).toEqual({ hook: false, store: false });
  });
});
