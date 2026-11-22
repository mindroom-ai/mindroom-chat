import { Capacitor } from '@capacitor/core';
import type { DesktopBridge } from './desktopBridge';

/** The Electron preload bridge on `window.mindroomDesktop`, if running in the desktop app. */
export const desktopBridge = (): DesktopBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.mindroomDesktop;

/** Whether the page runs inside the Electron desktop shell. */
export const isDesktopApp = (): boolean => desktopBridge() !== undefined;

/** Whether the page runs inside a Capacitor native shell (iOS, Android, or Mac Catalyst). */
export const isCapacitorApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** Whether the page runs inside any bundled app shell (Capacitor or Electron). */
export const isBundledApp = (): boolean => isDesktopApp() || isCapacitorApp();

/**
 * Marks `<html>` with `data-shell="desktop"` and toggles `data-fullscreen` from shell events.
 * No-op outside the Electron desktop app.
 */
export const markDesktopShell = (): void => {
  const bridge = desktopBridge();
  if (!bridge || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.shell = 'desktop';
  bridge.onShellEvent((event) => {
    if (event.type !== 'fullscreen') return;
    if (event.value) root.setAttribute('data-fullscreen', '');
    else root.removeAttribute('data-fullscreen');
  });
};
