// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopQuickCaptureBridge } from '../lib/desktopBridge';
import {
  ScreenshotError,
  captureScreenshot,
  hideQuickCapture,
  isNativeQuickCaptureAvailable,
  isNativeScreenshotAvailable,
  openScreenRecordingSettings,
  showMainWindow,
} from './nativeQuickCapture';

const plugin = vi.hoisted(() => ({
  hide: vi.fn(),
  showMainWindow: vi.fn(),
  openScreenRecordingSettings: vi.fn(),
  captureScreenshot: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
    convertFileSrc: vi.fn((path: string) => `capacitor://localhost/_capacitor_file_${path}`),
  },
  registerPlugin: vi.fn(() => plugin),
}));

const setAvailable = (available: boolean) => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(available);
  vi.mocked(Capacitor.getPlatform).mockReturnValue(available ? 'ios' : 'web');
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(available);
};

const stubFetch = (response: Partial<Response> | Error) => {
  const fetchMock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response as Response)
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('native quick capture plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    for (const method of Object.values(plugin)) method.mockResolvedValue(undefined);
    setAvailable(false);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'mindroomDesktop');
  });

  it('is available only on a native iOS platform with the plugin', () => {
    expect(isNativeQuickCaptureAvailable()).toBe(false);
    expect(isNativeScreenshotAvailable()).toBe(false);
    setAvailable(true);
    expect(isNativeQuickCaptureAvailable()).toBe(true);
    expect(isNativeScreenshotAvailable()).toBe(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    expect(isNativeQuickCaptureAvailable()).toBe(false);
    expect(isNativeScreenshotAvailable()).toBe(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    expect(isNativeQuickCaptureAvailable()).toBe(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    expect(isNativeQuickCaptureAvailable()).toBe(false);
  });

  it('calls each plugin method once', async () => {
    setAvailable(true);
    await hideQuickCapture();
    await showMainWindow();
    await openScreenRecordingSettings();
    expect(plugin.hide).toHaveBeenCalledTimes(1);
    expect(plugin.showMainWindow).toHaveBeenCalledTimes(1);
    expect(plugin.openScreenRecordingSettings).toHaveBeenCalledTimes(1);
  });

  it('resolves the void functions without calling anything when unavailable', async () => {
    await expect(hideQuickCapture()).resolves.toBeUndefined();
    await expect(showMainWindow()).resolves.toBeUndefined();
    await expect(openScreenRecordingSettings()).resolves.toBeUndefined();
    expect(plugin.hide).not.toHaveBeenCalled();
    expect(plugin.showMainWindow).not.toHaveBeenCalled();
    expect(plugin.openScreenRecordingSettings).not.toHaveBeenCalled();
  });

  it('captures a screenshot as a PNG file named by the native side', async () => {
    setAvailable(true);
    plugin.captureScreenshot.mockResolvedValue({ path: '/tmp/shot.png', name: 'Screenshot 1.png' });
    const fetchMock = stubFetch({ ok: true, blob: () => Promise.resolve(new Blob(['png'])) });

    const file = await captureScreenshot('window');

    expect(plugin.captureScreenshot).toHaveBeenCalledWith({ target: 'window' });
    expect(fetchMock).toHaveBeenCalledWith(Capacitor.convertFileSrc('/tmp/shot.png'));
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('Screenshot 1.png');
    expect(file.type).toBe('image/png');
  });

  it('keeps the code of a plugin rejection', async () => {
    setAvailable(true);
    plugin.captureScreenshot.mockRejectedValue({ code: 'PERMISSION_DENIED', message: 'no' });
    const error: unknown = await captureScreenshot('screen').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScreenshotError);
    expect((error as ScreenshotError).code).toBe('PERMISSION_DENIED');
  });

  it('turns an unknown code into CAPTURE_FAILED', async () => {
    setAvailable(true);
    plugin.captureScreenshot.mockRejectedValue({ code: 'WEIRD', message: 'x' });
    await expect(captureScreenshot('screen')).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
  });

  it('rejects CAPTURE_FAILED when the file cannot be fetched', async () => {
    setAvailable(true);
    plugin.captureScreenshot.mockResolvedValue({ path: '/tmp/shot.png', name: 'a.png' });
    stubFetch(new Error('network'));
    await expect(captureScreenshot('window')).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
    stubFetch({ ok: false });
    await expect(captureScreenshot('window')).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
  });

  it('rejects UNSUPPORTED when unavailable', async () => {
    await expect(captureScreenshot('window')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(plugin.captureScreenshot).not.toHaveBeenCalled();
  });

  it('uses the Electron desktop quickCapture bridge when exposed', async () => {
    // Main window exposes mindroomDesktop without quickCapture.
    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: {} });
    expect(isNativeQuickCaptureAvailable()).toBe(false);
    expect(isNativeScreenshotAvailable()).toBe(false);

    const desktopQuickCapture: DesktopQuickCaptureBridge = {
      hide: vi.fn().mockResolvedValue(undefined),
      openScreenRecordingSettings: vi.fn().mockResolvedValue(undefined),
    };
    const showMainWindowMock = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: {
        quickCapture: desktopQuickCapture,
        showMainWindow: showMainWindowMock,
      },
    });

    expect(isNativeQuickCaptureAvailable()).toBe(true);
    expect(isNativeScreenshotAvailable()).toBe(false);

    await hideQuickCapture();
    await showMainWindow();
    await openScreenRecordingSettings();

    expect(desktopQuickCapture.hide).toHaveBeenCalledOnce();
    expect(showMainWindowMock).toHaveBeenCalledOnce();
    expect(desktopQuickCapture.openScreenRecordingSettings).toHaveBeenCalledOnce();
    expect(plugin.hide).not.toHaveBeenCalled();
    expect(plugin.showMainWindow).not.toHaveBeenCalled();
    expect(plugin.openScreenRecordingSettings).not.toHaveBeenCalled();

    await expect(captureScreenshot('window')).rejects.toMatchObject({ code: 'UNSUPPORTED' });

    showMainWindowMock.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    await expect(showMainWindow()).rejects.toThrow('FORBIDDEN');
  });

  it('enables desktop screenshots when captureScreenshot is provided on the bridge', async () => {
    const captureMock = vi
      .fn()
      .mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]), name: 'Window.png' });
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: {
        quickCapture: {
          hide: vi.fn().mockResolvedValue(undefined),
          openScreenRecordingSettings: vi.fn().mockResolvedValue(undefined),
          captureScreenshot: captureMock,
        },
        showMainWindow: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      },
    });

    expect(isNativeQuickCaptureAvailable()).toBe(true);
    expect(isNativeScreenshotAvailable()).toBe(true);

    const file = await captureScreenshot('window');
    expect(captureMock).toHaveBeenCalledWith('window');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('Window.png');
    expect(file.type).toBe('image/png');
  });
});
