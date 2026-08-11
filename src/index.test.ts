// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(),
  installFlightRecorder: vi.fn(),
  initializeDeepTraceRecorder: vi.fn(),
  isServiceWorkerEnabled: vi.fn(),
  render: vi.fn(),
  createRoot: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  createRoot: mocks.createRoot,
}));

vi.mock('@capacitor/app', () => ({
  App: {},
}));

vi.mock('./app/mindroom/native/nativeSso', () => ({
  isNativeIOS: mocks.isNativeIOS,
  isNativeApp: () => false,
  registerNativeSsoCallbacks: vi.fn(),
}));

vi.mock('./app/mindroom/diagnostics/flightRecorder', () => ({
  installFlightRecorder: mocks.installFlightRecorder,
}));

vi.mock('./app/mindroom/diagnostics/deepTrace', () => ({
  initializeDeepTraceRecorder: mocks.initializeDeepTraceRecorder,
}));

vi.mock('./app/theme/themeBootstrap', () => ({
  applyThemeToDom: vi.fn(),
  resolveInitialTheme: vi.fn(),
}));

vi.mock('./app/mindroom/threads/rideTraceRecorder', () => ({
  bootstrapRideTraceFlagFromUrl: vi.fn(),
}));

vi.mock('./app/mindroom/settings/mindroomSettingsStorage', () => ({
  migrateMindroomSettingsStorage: vi.fn(),
}));

vi.mock('./app/mindroom/native/iosPush', () => ({
  migrateLegacyIOSPushEnabled: vi.fn(),
}));

vi.mock('./app/utils/runtimeConfig', () => ({
  isServiceWorkerEnabled: mocks.isServiceWorkerEnabled,
}));

vi.mock('./app/state/sessions', () => ({
  getActiveSession: () => undefined,
  subscribeToSessionStore: vi.fn(),
}));

vi.mock('./sw-session', () => ({
  pushSessionToSW: vi.fn(),
  waitForServiceWorkerControl: vi.fn(),
}));

vi.mock('./appVersion', () => ({
  APP_BUILD_VERSION: 'test-build',
  fetchPublishedAppVersion: vi.fn(),
  startAppVersionMonitor: vi.fn(),
}));

vi.mock('./serviceWorkerRegistration', () => ({
  createServiceWorkerUrl: vi.fn(),
}));

vi.mock('./app/pages/App', () => ({
  default: () => null,
}));

vi.mock('./app/i18n', () => ({}));

describe('application bootstrap', () => {
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
    mocks.isNativeIOS.mockReturnValue(false);
    mocks.isServiceWorkerEnabled.mockReturnValue(false);
    mocks.createRoot.mockReturnValue({ render: mocks.render });
  });

  afterEach(() => {
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });

  it.each([
    ['native iOS', true, 1],
    ['another platform', false, 0],
  ])('installs the flight recorder on %s', async (_platform, nativeIOS, installs) => {
    mocks.isNativeIOS.mockReturnValue(nativeIOS);

    await import('./index');

    expect(mocks.installFlightRecorder).toHaveBeenCalledTimes(installs);
    expect(mocks.initializeDeepTraceRecorder).toHaveBeenCalledTimes(installs);
    expect(mocks.createRoot).toHaveBeenCalledOnce();
  });

  it('continues boot when recorder route classification throws', async () => {
    mocks.isNativeIOS.mockReturnValue(true);
    mocks.installFlightRecorder.mockImplementationOnce(() => {
      throw new TypeError('route classification failed');
    });

    await expect(import('./index')).resolves.toBeDefined();

    expect(mocks.installFlightRecorder).toHaveBeenCalledOnce();
    expect(mocks.initializeDeepTraceRecorder).toHaveBeenCalledOnce();
    expect(mocks.createRoot).toHaveBeenCalledOnce();
  });

  it('continues boot when opt-in tracing setup throws', async () => {
    mocks.isNativeIOS.mockReturnValue(true);
    mocks.initializeDeepTraceRecorder.mockImplementationOnce(() => {
      throw new TypeError('indexeddb setup failed');
    });

    await expect(import('./index')).resolves.toBeDefined();

    expect(mocks.installFlightRecorder).toHaveBeenCalledOnce();
    expect(mocks.initializeDeepTraceRecorder).toHaveBeenCalledOnce();
    expect(mocks.createRoot).toHaveBeenCalledOnce();
  });

  it('mounts the app while service worker registration is pending', async () => {
    const never = new Promise<never>(() => {
      // Intentionally pending.
    });
    const serviceWorker = {
      addEventListener: vi.fn(),
      ready: never,
      register: vi.fn(() => never),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });
    mocks.isServiceWorkerEnabled.mockReturnValue(true);

    await import('./index');

    await vi.waitFor(() => expect(mocks.createRoot).toHaveBeenCalledOnce());
    expect(serviceWorker.register).toHaveBeenCalledOnce();
  });
});
