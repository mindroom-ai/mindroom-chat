import path from 'node:path';
import { BrowserWindow } from 'electron';
import { APP_ORIGIN } from './bundleProtocol';
import { guardWebContents } from './security';

const CRASH_RESET_MS = 60_000;
let mainWindow: BrowserWindow | undefined;

export const getMainWindow = (): BrowserWindow | undefined =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

export const showMainWindow = (onBlockedUrl?: (url: string) => void): BrowserWindow => {
  const existing = getMainWindow();
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 8 },
    backgroundColor: '#1A1A1A',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  guardWebContents(win.webContents, onBlockedUrl);
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  const sendFullscreen = (value: boolean): void => {
    if (!win.isDestroyed()) {
      win.webContents.send('desktop:shell-event', { type: 'fullscreen', value });
    }
  };
  win.on('enter-full-screen', () => sendFullscreen(true));
  win.on('leave-full-screen', () => sendFullscreen(false));

  let reloadedAfterCrash = false;
  let crashResetTimer: ReturnType<typeof setTimeout> | undefined;
  win.webContents.on('did-finish-load', () => {
    sendFullscreen(win.isFullScreen());
    clearTimeout(crashResetTimer);
    if (reloadedAfterCrash) {
      crashResetTimer = setTimeout(() => {
        reloadedAfterCrash = false;
      }, CRASH_RESET_MS);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    clearTimeout(crashResetTimer);
    if (details.reason === 'clean-exit' || reloadedAfterCrash || win.isDestroyed()) return;
    reloadedAfterCrash = true;
    win.webContents.reload();
  });
  win.on('closed', () => {
    clearTimeout(crashResetTimer);
    if (mainWindow === win) mainWindow = undefined;
  });
  void win.loadURL(`${APP_ORIGIN}/`);
  return win;
};
