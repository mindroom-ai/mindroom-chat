import { desktopBridge } from '../lib/nativeShell';

/** Desktop Quick Capture bridge helpers: hide, showMainWindow, openScreenRecordingSettings,
 *  and screenshot capture; rejections carry `ScreenshotError.code`. */
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

export const isNativeQuickCaptureAvailable = (): boolean => Boolean(desktopBridge()?.quickCapture);

export const isNativeScreenshotAvailable = (): boolean =>
  Boolean(desktopBridge()?.quickCapture?.captureScreenshot);

export const hideQuickCapture = async (): Promise<void> => {
  await desktopBridge()?.quickCapture?.hide();
};

export const showMainWindow = async (): Promise<void> => {
  const bridge = desktopBridge();
  if (!bridge?.quickCapture) return;
  const res = await bridge.showMainWindow();
  if (!res.ok) throw new Error(res.code);
};

export const openScreenRecordingSettings = async (): Promise<void> => {
  await desktopBridge()?.quickCapture?.openScreenRecordingSettings();
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
  if (!desktop?.captureScreenshot) throw new ScreenshotError('UNSUPPORTED');
  try {
    const res = await desktop.captureScreenshot(target);
    if (!res.ok) throw toScreenshotError({ code: res.code });
    return new File([new Uint8Array(res.value.bytes)], res.value.name, { type: 'image/png' });
  } catch (error) {
    throw toScreenshotError(error);
  }
};
