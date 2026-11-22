/** Shell-level events pushed from the Electron main process to the page. */
export type DesktopShellEvent = { type: 'fullscreen'; value: boolean };
export type DesktopResult<T> = { ok: true; value: T } | { ok: false; code: string };
export type DesktopMediaSession = { baseUrl: string; userId: string; accessToken: string };
export type DesktopSignInRequest = { homeserver: string; callback: string };
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
  appUrl: AppUrlPlugin;
};

declare global {
  interface Window {
    mindroomDesktop?: DesktopBridge;
  }
}
