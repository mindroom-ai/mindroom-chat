// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  waitForServiceWorkerControl: vi.fn(),
  markServiceWorkerUnavailable: vi.fn(),
}));

vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: vi.fn() }) }));
vi.mock('@capacitor/app', () => ({ App: {} }));
vi.mock('./app/native/nativeSso', () => ({
  isNativeIOS: () => false,
  isNativeApp: () => false,
  registerNativeAppUrlCallbacks: vi.fn(),
}));
vi.mock('./app/diagnostics/flightRecorder', () => ({ installFlightRecorder: vi.fn() }));
vi.mock('./app/diagnostics/deepTrace', () => ({
  initializeDeepTraceRecorder: vi.fn(),
  recordDeepTraceEvent: vi.fn(),
}));
vi.mock('./app/account/lifecycle/indexedDbLossRecovery', () => ({
  installIndexedDbLossRecovery: vi.fn(),
  readRecoveryReloadAge: () => undefined,
}));
vi.mock('./app/theme/themeBootstrap', () => ({
  resolveInitialTheme: vi.fn(),
}));
vi.mock('./app/theme/appliedTheme', () => ({
  applyAppTheme: vi.fn(),
}));
vi.mock('./app/timeline/rideTraceRecorder', () => ({
  bootstrapRideTraceFlagFromUrl: vi.fn(),
}));
vi.mock('./app/event-store/engine/prefetchSettingsStorage', () => ({
  migratePrefetchSettingsStorage: vi.fn(),
}));
vi.mock('./app/notifications/push/iosPush', () => ({ migrateLegacyIOSPushEnabled: vi.fn() }));
vi.mock('./app/config/runtimeConfig', () => ({ isServiceWorkerEnabled: () => true }));
vi.mock('./app/matrix/session/sessions', () => ({
  getActiveSession: mocks.getActiveSession,
  subscribeToSessionStore: vi.fn(),
}));
vi.mock('./sw/swSession', () => ({
  answerServiceWorkerSessionRequests: vi.fn(),
  pushSessionToSW: vi.fn(),
  waitForServiceWorkerControl: mocks.waitForServiceWorkerControl,
}));
vi.mock('./app/config/appVersion', () => ({
  APP_BUILD_VERSION: 'test-build',
  startAppVersionMonitor: vi.fn(),
}));
vi.mock('./app/config/serviceWorkerRegistration', () => ({ createServiceWorkerUrl: vi.fn() }));
vi.mock('./app/shell/App', () => ({ default: () => null }));
vi.mock('./app/matrix/hooks/useMediaAuthentication', () => ({
  markServiceWorkerUnavailable: mocks.markServiceWorkerUnavailable,
}));
vi.mock('./app/i18n/i18n', () => ({}));
vi.mock('./app/theme/Typography.css', () => ({}));

/** A first-install worker that is still activating, which the test finishes by hand. */
const makeActivatingWorker = () => {
  const listeners = new Set<() => void>();
  const worker = {
    state: 'activating' as ServiceWorkerState,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const finish = (state: ServiceWorkerState) => {
    worker.state = state;
    listeners.forEach((listener) => listener());
  };
  return { worker, finish, listening: () => listeners.size > 0 };
};

describe('service worker control recovery at startup', () => {
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  let reloads: number;
  let container: { controller: object | null };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    reloads = 0;
    const browserWindow = window;
    vi.stubGlobal(
      'window',
      new Proxy(browserWindow, {
        get(target, property) {
          if (property === 'location') {
            return {
              get href() {
                return target.location.href;
              },
              reload: () => {
                reloads += 1;
              },
            };
          }
          return Reflect.get(target, property);
        },
      })
    );
    mocks.getActiveSession.mockReturnValue({ baseUrl: 'https://matrix.example.com' });
    // The real helper resolves at once when a controller exists, else after its timeout.
    mocks.waitForServiceWorkerControl.mockImplementation(async () => !!container.controller);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });

  const installServiceWorker = (active: object) => {
    container = { controller: null };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: Object.assign(container, {
        addEventListener: vi.fn(),
        ready: new Promise(() => undefined),
        register: vi.fn().mockResolvedValue({ active }),
        getRegistration: vi.fn().mockResolvedValue({ active }),
      }),
    });
  };

  it('asks an active worker to claim the page instead of reloading it', async () => {
    const worker = {
      state: 'activated' as ServiceWorkerState,
      postMessage: vi.fn((message: unknown) => {
        if ((message as { type?: unknown }).type === 'claim') container.controller = worker;
      }),
    };
    installServiceWorker(worker);

    await import('./index');

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith({ type: 'claim' }));
    await vi.waitFor(() => expect(mocks.waitForServiceWorkerControl).toHaveBeenCalled());
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(reloads).toBe(0);
    expect(window.sessionStorage.getItem('mindroom_sw_control_reloaded')).toBeNull();
  });

  it('asks for the claim on a signed-out page too, which stays put', async () => {
    mocks.getActiveSession.mockReturnValue(undefined);
    const worker = { state: 'activated' as ServiceWorkerState, postMessage: vi.fn() };
    installServiceWorker(worker);

    await import('./index');

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith({ type: 'claim' }));
    expect(reloads).toBe(0);
  });

  it('reloads once, and only once per tab, when an older worker ignores the claim', async () => {
    const worker = { state: 'activated' as ServiceWorkerState, postMessage: vi.fn() };
    installServiceWorker(worker);

    await import('./index');
    await vi.waitFor(() => expect(reloads).toBe(1));

    vi.resetModules();
    await import('./index');
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(reloads).toBe(1);
  });

  it('asks nothing of a page that a worker already controls', async () => {
    const worker = { state: 'activated' as ServiceWorkerState, postMessage: vi.fn() };
    installServiceWorker(worker);
    container.controller = worker;

    await import('./index');
    await vi.waitFor(() => expect(mocks.waitForServiceWorkerControl).toHaveBeenCalled());

    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reloads).toBe(0);
  });

  it('keeps the page when the worker claims it as it finishes activating', async () => {
    const { worker, finish, listening } = makeActivatingWorker();
    installServiceWorker(worker);

    await import('./index');
    await vi.waitFor(() => expect(listening()).toBe(true));
    container.controller = worker;
    finish('activated');

    await vi.waitFor(() => expect(mocks.waitForServiceWorkerControl).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(reloads).toBe(0);
    expect(window.sessionStorage.getItem('mindroom_sw_control_reloaded')).toBeNull();
  });

  it('reloads once when the worker finishes activating without taking the page', async () => {
    const { worker, finish, listening } = makeActivatingWorker();
    installServiceWorker(worker);

    await import('./index');
    await vi.waitFor(() => expect(listening()).toBe(true));
    expect(reloads).toBe(0);
    finish('activated');

    await vi.waitFor(() => expect(reloads).toBe(1));
    expect(window.sessionStorage.getItem('mindroom_sw_control_reloaded')).toBe('1');
  });

  it('stays on the page when the activating worker is replaced', async () => {
    const { worker, finish, listening } = makeActivatingWorker();
    installServiceWorker(worker);

    await import('./index');
    await vi.waitFor(() => expect(listening()).toBe(true));
    finish('redundant');

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(listening()).toBe(false);
    expect(reloads).toBe(0);
  });

  it('reports that no worker can exist where the browser has none, and stays put', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect('serviceWorker' in navigator).toBe(false);

    await import('./index');

    expect(mocks.markServiceWorkerUnavailable).toHaveBeenCalledOnce();
    expect(reloads).toBe(0);
  });

  it.each([
    ['refused', () => Promise.reject(new DOMException('Blocked', 'SecurityError'))],
    ['answered without one', () => Promise.resolve(undefined)],
  ])('reports that no worker can exist when registration is %s', async (_name, register) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installServiceWorker({ state: 'activated', postMessage: vi.fn() });
    Object.assign(navigator.serviceWorker, {
      register: vi.fn(register),
      getRegistration: vi.fn().mockResolvedValue(undefined),
    });

    await import('./index');

    await vi.waitFor(() => expect(mocks.markServiceWorkerUnavailable).toHaveBeenCalledOnce());
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(reloads).toBe(0);
  });

  it('reports nothing while the worker registers', async () => {
    installServiceWorker({ state: 'activated', postMessage: vi.fn() });

    await import('./index');
    await vi.waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled());
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(mocks.markServiceWorkerUnavailable).not.toHaveBeenCalled();
  });
});
