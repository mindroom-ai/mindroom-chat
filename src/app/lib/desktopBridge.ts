/** Shell-level events pushed from the Electron main process to the page. */
export type DesktopShellEvent = { type: 'fullscreen'; value: boolean };

/**
 * The preload bridge exposed on `window.mindroomDesktop` in the Electron desktop app.
 * Later phases extend this type alongside `electron/preload.ts`.
 */
export type DesktopBridge = {
  onShellEvent: (listener: (event: DesktopShellEvent) => void) => () => void;
};

declare global {
  interface Window {
    mindroomDesktop?: DesktopBridge;
  }
}
