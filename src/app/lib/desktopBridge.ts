/** Shell-level events pushed from the Electron main process to the page. */
export type DesktopShellEvent =
  | { type: 'fullscreen'; value: boolean }
  | { type: 'zoom'; action: 'in' | 'out' | 'reset' }
  | { type: 'window-hidden' }
  | { type: 'window-focus'; focused: boolean }
  | { type: 'update-status' }
  | { type: 'swipe-tracking'; enabled: boolean }
  | { type: 'scroll-gesture'; phase: 'begin' | 'fling' | 'end' | 'cancel' }
  | { type: 'swipe'; direction: 'left' | 'right' };
export type DesktopResult<T> = { ok: true; value: T } | { ok: false; code: string };
export type DesktopMediaSession = { baseUrl: string; userId: string; accessToken: string };
export type DesktopSignInRequest = { homeserver: string; callback: string };
export type DesktopUpdateCheckOutcome = 'none' | 'found' | 'error';
export type DesktopUpdateCheckResult = { outcome: DesktopUpdateCheckOutcome; version?: string };
export type DesktopUpdateBridge = {
  status: () => Promise<{ version?: string }>;
  check: () => Promise<DesktopUpdateCheckResult>;
  install: () => Promise<void>;
};
export type DesktopQuickCaptureBridge = {
  hide: () => Promise<void>;
  openScreenRecordingSettings: () => Promise<void>;
  captureScreenshot?: (
    target: 'window' | 'screen'
  ) => Promise<DesktopResult<{ bytes: Uint8Array; name: string }>>;
};
/** What hands the page a URL the system opened: Capacitor's App plugin, or the desktop bridge. */
export type AppUrlPlugin = {
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url?: string }) => void
  ): Promise<unknown>;
  getLaunchUrl(): Promise<{ url?: string } | undefined>;
};

/**
 * The preload bridge exposed on `window.mindroomDesktop` in the Electron desktop app.
 * Later phases extend this type alongside `electron/preload.ts`.
 */
export type DesktopBridge = {
  onShellEvent: (listener: (event: DesktopShellEvent) => void) => () => void;
  /** Synchronous: main holds the session when this returns. */
  setMediaSession: (session: DesktopMediaSession | null) => DesktopResult<void>;
  startSignIn: (request: DesktopSignInRequest) => Promise<DesktopResult<string>>;
  openSignIn: (url: string) => Promise<DesktopResult<void>>;
  showMainWindow: () => Promise<DesktopResult<void>>;
  setBadge: (count: number) => void;
  isWindowFocused: () => boolean;
  screenShare: boolean;
  appUrl: AppUrlPlugin;
  update?: DesktopUpdateBridge;
  quickCapture?: DesktopQuickCaptureBridge;
};

declare global {
  interface Window {
    mindroomDesktop?: DesktopBridge;
  }
}
