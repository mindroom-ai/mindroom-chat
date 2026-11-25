// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopQuickCaptureBridge } from '../lib/desktopBridge';
import {
  ScreenshotError,
  captureScreenshot,
  hasQuickCaptureVibrancy,
  hideQuickCapture,
  isNativeQuickCaptureAvailable,
  isNativeScreenshotAvailable,
  openScreenRecordingSettings,
  showMainWindow,
} from './nativeQuickCapture';

describe('native quick capture bridge', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'mindroomDesktop');
  });

  it('resolves void functions and rejects UNSUPPORTED when unavailable', async () => {
    expect(isNativeQuickCaptureAvailable()).toBe(false);
    expect(hasQuickCaptureVibrancy()).toBe(false);
    expect(isNativeScreenshotAvailable()).toBe(false);
    await expect(hideQuickCapture()).resolves.toBeUndefined();
    await expect(showMainWindow()).resolves.toBeUndefined();
    await expect(openScreenRecordingSettings()).resolves.toBeUndefined();
    await expect(captureScreenshot('window')).rejects.toMatchObject({
      name: 'ScreenshotError',
      code: 'UNSUPPORTED',
    });
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
    expect(hasQuickCaptureVibrancy()).toBe(false);
    expect(isNativeScreenshotAvailable()).toBe(false);

    await hideQuickCapture();
    await showMainWindow();
    await openScreenRecordingSettings();

    expect(desktopQuickCapture.hide).toHaveBeenCalledOnce();
    expect(showMainWindowMock).toHaveBeenCalledOnce();
    expect(desktopQuickCapture.openScreenRecordingSettings).toHaveBeenCalledOnce();

    await expect(captureScreenshot('window')).rejects.toMatchObject({
      name: 'ScreenshotError',
      code: 'UNSUPPORTED',
    });

    showMainWindowMock.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    await expect(showMainWindow()).rejects.toThrow('FORBIDDEN');
  });

  it('enables desktop screenshots and maps DesktopResult success and error codes', async () => {
    const captureMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      value: {
        bytes: new Uint8Array([137, 80, 78, 71]),
        name: 'Screenshot 2026-11-22 10.00.00.png',
      },
    });
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: {
        quickCapture: {
          hide: vi.fn().mockResolvedValue(undefined),
          openScreenRecordingSettings: vi.fn().mockResolvedValue(undefined),
          vibrancy: true,
          captureScreenshot: captureMock,
        },
        showMainWindow: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      },
    });

    expect(isNativeQuickCaptureAvailable()).toBe(true);
    expect(hasQuickCaptureVibrancy()).toBe(true);
    expect(isNativeScreenshotAvailable()).toBe(true);

    const file = await captureScreenshot('window');
    expect(captureMock).toHaveBeenCalledWith('window');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('Screenshot 2026-11-22 10.00.00.png');
    expect(file.type).toBe('image/png');
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
    expect(bytes).toEqual(new Uint8Array([137, 80, 78, 71]));

    for (const code of [
      'PERMISSION_DENIED',
      'NO_WINDOW',
      'UNSUPPORTED',
      'CAPTURE_FAILED',
    ] as const) {
      captureMock.mockResolvedValueOnce({ ok: false, code });
      const err: unknown = await captureScreenshot('screen').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ScreenshotError);
      expect((err as ScreenshotError).code).toBe(code);
    }

    captureMock.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    await expect(captureScreenshot('window')).rejects.toMatchObject({
      name: 'ScreenshotError',
      code: 'CAPTURE_FAILED',
    });

    captureMock.mockRejectedValueOnce(new Error('ipc failed'));
    await expect(captureScreenshot('window')).rejects.toMatchObject({
      name: 'ScreenshotError',
      code: 'CAPTURE_FAILED',
    });
  });
});
