/** Shell-level events pushed from the Electron main process to the page. */
export type DesktopShellEvent = { type: 'fullscreen'; value: boolean };
export type DesktopResult<T> = { ok: true; value: T } | { ok: false; code: string };
export type DesktopMediaSession = { baseUrl: string; userId: string; accessToken: string };
export type DesktopSignInRequest = { homeserver: string; callback: string };
export type DesktopAppUrlPlugin = {
  addListener: (
    eventName: 'appUrlOpen',
    listener: (event: { url?: string }) => void
  ) => Promise<{ remove: () => void }>;
  getLaunchUrl: () => Promise<{ url?: string } | undefined>;
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
  appUrl: DesktopAppUrlPlugin;
};

declare global {
  interface Window {
    mindroomDesktop?: DesktopBridge;
  }
}
