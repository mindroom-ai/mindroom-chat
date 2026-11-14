import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ScreenshotError,
  captureScreenshot,
  hideQuickCapture,
  isNativeQuickCaptureAvailable,
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

  it('is available only on a native iOS platform with the plugin', () => {
    expect(isNativeQuickCaptureAvailable()).toBe(false);
    setAvailable(true);
    expect(isNativeQuickCaptureAvailable()).toBe(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    expect(isNativeQuickCaptureAvailable()).toBe(false);
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
});
