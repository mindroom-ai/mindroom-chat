import path from 'node:path';
import { BrowserWindow } from 'electron';
import { APP_ORIGIN } from './bundleProtocol';
import { guardWebContents } from './security';

const CRASH_RESET_MS = 60_000;
let mainWindow: BrowserWindow | undefined;

export const getMainWindow = (): BrowserWindow | undefined =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

export const showMainWindow = (): BrowserWindow => {
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
  guardWebContents(win.webContents);
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
  win.webContents.on('did-finish-load', () => sendFullscreen(win.isFullScreen()));

  let lastCrashReloadAt = 0;
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now();
    if (now - lastCrashReloadAt <= CRASH_RESET_MS) return;
    lastCrashReloadAt = now;
    win.webContents.reload();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  void win.loadURL(`${APP_ORIGIN}/`);
  return win;
};
