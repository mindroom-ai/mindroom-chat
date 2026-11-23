import { Capacitor, registerPlugin } from '@capacitor/core';
import { desktopBridge } from '../lib/nativeShell';

/** Plugin `MindRoomQuickCapture`: hide(), showMainWindow(), openScreenRecordingSettings(),
 *  captureScreenshot({ target }) resolving { path, name }; rejections carry `code`. */
export type ScreenshotTarget = 'window' | 'screen';
export type ScreenshotErrorCode =
  | 'PERMISSION_DENIED'
  | 'NO_WINDOW'
  | 'UNSUPPORTED'
  | 'CAPTURE_FAILED';

const SCREENSHOT_ERROR_CODES: readonly ScreenshotErrorCode[] = [
  'PERMISSION_DENIED',
  'NO_WINDOW',
  'UNSUPPORTED',
  'CAPTURE_FAILED',
];

export class ScreenshotError extends Error {
  constructor(readonly code: ScreenshotErrorCode) {
    super(code);
    this.name = 'ScreenshotError';
  }
}

type MindRoomQuickCapturePlugin = {
  hide(): Promise<void>;
  showMainWindow(): Promise<void>;
  openScreenRecordingSettings(): Promise<void>;
  captureScreenshot(options: { target: ScreenshotTarget }): Promise<{ path: string; name: string }>;
};

let quickCapturePlugin: MindRoomQuickCapturePlugin | undefined;

const getQuickCapturePlugin = (): MindRoomQuickCapturePlugin => {
  if (!quickCapturePlugin) {
    quickCapturePlugin = registerPlugin<MindRoomQuickCapturePlugin>('MindRoomQuickCapture');
  }
  return quickCapturePlugin;
};

const hasCapacitorQuickCapturePlugin = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomQuickCapture');

export const isNativeQuickCaptureAvailable = (): boolean =>
  Boolean(desktopBridge()?.quickCapture) || hasCapacitorQuickCapturePlugin();

export const isNativeScreenshotAvailable = (): boolean =>
  Boolean(desktopBridge()?.quickCapture?.captureScreenshot) || hasCapacitorQuickCapturePlugin();

export const hideQuickCapture = async (): Promise<void> => {
  const desktop = desktopBridge()?.quickCapture;
  if (desktop) {
    await desktop.hide();
    return;
  }
  if (!hasCapacitorQuickCapturePlugin()) return;
  await getQuickCapturePlugin().hide();
};

export const showMainWindow = async (): Promise<void> => {
  const bridge = desktopBridge();
  if (bridge?.quickCapture) {
    const res = await bridge.showMainWindow();
    if (!res.ok) throw new Error(res.code);
    return;
  }
  if (!hasCapacitorQuickCapturePlugin()) return;
  await getQuickCapturePlugin().showMainWindow();
};

export const openScreenRecordingSettings = async (): Promise<void> => {
  const desktop = desktopBridge()?.quickCapture;
  if (desktop) {
    await desktop.openScreenRecordingSettings();
    return;
  }
  if (!hasCapacitorQuickCapturePlugin()) return;
  await getQuickCapturePlugin().openScreenRecordingSettings();
};

const toScreenshotError = (error: unknown): ScreenshotError => {
  if (error instanceof ScreenshotError) return error;
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const known = SCREENSHOT_ERROR_CODES.find((candidate) => candidate === code);
  return new ScreenshotError(known ?? 'CAPTURE_FAILED');
};

/** The capture as a PNG `File` named by the native side. */
export const captureScreenshot = async (target: ScreenshotTarget): Promise<File> => {
  const desktop = desktopBridge()?.quickCapture;
  if (desktop) {
    if (!desktop.captureScreenshot) throw new ScreenshotError('UNSUPPORTED');
    try {
      const { bytes, name } = await desktop.captureScreenshot(target);
      return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
    } catch (error) {
      throw toScreenshotError(error);
    }
  }
  if (!hasCapacitorQuickCapturePlugin()) throw new ScreenshotError('UNSUPPORTED');
  try {
    const { path, name } = await getQuickCapturePlugin().captureScreenshot({ target });
    const response = await fetch(Capacitor.convertFileSrc(path));
    if (!response.ok) throw new ScreenshotError('CAPTURE_FAILED');
    const blob = await response.blob();
    return new File([blob], name, { type: 'image/png' });
  } catch (error) {
    throw toScreenshotError(error);
  }
};
