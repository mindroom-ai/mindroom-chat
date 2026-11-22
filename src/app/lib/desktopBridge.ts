/** Shell-level events pushed from the Electron main process to the page. */
export type DesktopShellEvent = { type: 'fullscreen'; value: boolean };
export type DesktopResult<T> = { ok: true; value: T } | { ok: false; code: string };
export type DesktopMediaSession = { baseUrl: string; accessToken: string };

/**
 * The preload bridge exposed on `window.mindroomDesktop` in the Electron desktop app.
 * Later phases extend this type alongside `electron/preload.ts`.
 */
export type DesktopBridge = {
  onShellEvent: (listener: (event: DesktopShellEvent) => void) => () => void;
  setMediaSession: (session: DesktopMediaSession | null) => Promise<DesktopResult<void>>;
};

declare global {
  interface Window {
    mindroomDesktop?: DesktopBridge;
  }
}
