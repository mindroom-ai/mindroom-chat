import { Capacitor } from '@capacitor/core';
import type { DesktopBridge } from './desktopBridge';

/** The Electron preload bridge on `window.mindroomDesktop`, if running in the desktop app. */
export const desktopBridge = (): DesktopBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.mindroomDesktop;

/** Whether the page runs inside the Electron desktop shell. */
export const isDesktopApp = (): boolean => desktopBridge() !== undefined;

/** Whether the page runs inside a Capacitor native shell (iOS, Android, or Mac Catalyst). */
export const isCapacitorApp = (): boolean => Capacitor.isNativePlatform();

/** Whether the page runs inside any bundled app shell (Capacitor or Electron). */
export const isBundledApp = (): boolean => isDesktopApp() || isCapacitorApp();

/** Whether the app window is both visible in the DOM and focused by the desktop shell. */
export const isAppWindowFocused = (): boolean =>
  typeof document !== 'undefined' &&
  document.visibilityState !== 'hidden' &&
  document.hasFocus() &&
  (desktopBridge()?.isWindowFocused() ?? true);

/** Props that mark a button for the Electron preload's trusted-click external opener. */
export const externalOpenProps = (url: string): { 'data-open-external'?: string } =>
  isDesktopApp() ? { 'data-open-external': url } : {};

let subscribedBridge: DesktopBridge | undefined;
let stopShellEvents: (() => void) | undefined;

/**
 * Marks `<html>` with `data-shell="desktop"` and toggles `data-fullscreen` from shell events.
 * Idempotent for the active bridge; no-op outside the Electron desktop app.
 */
export const markDesktopShell = (): void => {
  const bridge = desktopBridge();
  if (!bridge || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.shell = 'desktop';
  if (subscribedBridge === bridge) return;
  stopShellEvents?.();
  subscribedBridge = bridge;
  stopShellEvents = bridge.onShellEvent((event) => {
    if (event.type !== 'fullscreen') return;
    if (event.value) root.setAttribute('data-fullscreen', '');
    else root.removeAttribute('data-fullscreen');
  });
};
