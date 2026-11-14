import { Capacitor, registerPlugin } from '@capacitor/core';

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

export const isNativeQuickCaptureAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomQuickCapture');

export const hideQuickCapture = async (): Promise<void> => {
  if (!isNativeQuickCaptureAvailable()) return;
  await getQuickCapturePlugin().hide();
};

export const showMainWindow = async (): Promise<void> => {
  if (!isNativeQuickCaptureAvailable()) return;
  await getQuickCapturePlugin().showMainWindow();
};

export const openScreenRecordingSettings = async (): Promise<void> => {
  if (!isNativeQuickCaptureAvailable()) return;
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
  if (!isNativeQuickCaptureAvailable()) throw new ScreenshotError('UNSUPPORTED');
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
