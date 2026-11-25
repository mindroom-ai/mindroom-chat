import path from 'node:path';
import { app, BrowserWindow, clipboard, Menu, screen } from 'electron';
import { APP_ORIGIN } from './bundleProtocol';
import { buildContextMenu } from './menu';
import { guardWebContents } from './security';
import { attachTrackpadSwipe } from './trackpadSwipe';
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  fitToDisplays,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from './windowState';

const CRASH_RESET_MS = 60_000;
const SAVE_DEBOUNCE_MS = 250;

let mainWindow: BrowserWindow | undefined;
let screenShareEnabled = false;
let updaterEnabled = false;
let desktopAccessEnabled = false;
let quitting = false;
let hideAfterFullScreen = false;
let activeFlushWindowState: (() => void) | undefined;

export const configureMainWindow = (options: {
  screenShare: boolean;
  updater?: boolean;
  desktopAccess?: boolean;
}): void => {
  screenShareEnabled = options.screenShare;
  updaterEnabled = Boolean(options.updater);
  desktopAccessEnabled = Boolean(options.desktopAccess);
};

export const markQuitting = (): void => {
  quitting = true;
};

export const isQuitting = (): boolean => quitting;

export const flushMainWindowState = (): void => {
  activeFlushWindowState?.();
};

export const attachContextMenu = (win: BrowserWindow): void => {
  win.webContents.on('context-menu', (_event, params) => {
    const items = buildContextMenu(params, {
      replaceMisspelling: (suggestion) => {
        if (!win.isDestroyed()) win.webContents.replaceMisspelling(suggestion);
      },
      addToDictionary: (word) => {
        if (!win.isDestroyed()) win.webContents.session.addWordToSpellCheckerDictionary(word);
      },
      writeClipboardText: (text) => {
        void clipboard.writeText(text).catch(() => undefined);
      },
    });
    if (items.length > 0 && !win.isDestroyed()) {
      Menu.buildFromTemplate(items).popup({ window: win });
    }
  });
};

export const getMainWindow = (): BrowserWindow | undefined =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

export const showMainWindow = (): BrowserWindow => {
  const existing = getMainWindow();
  if (existing) {
    hideAfterFullScreen = false;
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }

  const userData = app.getPath('userData');
  const restored = fitToDisplays(
    loadWindowState(userData),
    screen.getAllDisplays().map((display) => display.workArea)
  );

  const win = new BrowserWindow({
    ...(restored
      ? { x: restored.x, y: restored.y, width: restored.width, height: restored.height }
      : { width: 1200, height: 800 }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 8 },
    backgroundColor: '#1A1A1A',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [
        screenShareEnabled ? '--mindroom-screen-share=1' : '--mindroom-screen-share=0',
        ...(updaterEnabled ? ['--mindroom-updater=1'] : []),
        ...(desktopAccessEnabled ? ['--mindroom-desktop-access=1'] : []),
      ],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  guardWebContents(win.webContents);

  let normalBounds: Electron.Rectangle = restored
    ? { x: restored.x, y: restored.y, width: restored.width, height: restored.height }
    : win.getBounds();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const readNormalBounds = (): Electron.Rectangle => {
    if (!win.isDestroyed() && !win.isFullScreen() && !win.isMinimized()) {
      normalBounds =
        typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : win.getBounds();
    }
    return normalBounds;
  };

  const flush = (): void => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (win.isDestroyed()) return;
    const bounds = readNormalBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fullScreen: win.isFullScreen(),
    };
    saveWindowState(userData, state);
  };

  const scheduleSave = (): void => {
    readNormalBounds();
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  activeFlushWindowState = flush;

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    if (restored?.fullScreen) win.setFullScreen(true);
  });

  const sendFullscreen = (value: boolean): void => {
    if (!win.isDestroyed()) {
      win.webContents.send('desktop:shell-event', { type: 'fullscreen', value });
    }
  };

  const sendWindowFocus = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send('desktop:shell-event', {
        type: 'window-focus',
        focused: win.isVisible() && !win.isMinimized() && win.isFocused(),
      });
    }
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('show', sendWindowFocus);
  win.on('hide', () => {
    flush();
    sendWindowFocus();
  });
  win.on('minimize', sendWindowFocus);
  win.on('restore', sendWindowFocus);
  win.on('focus', sendWindowFocus);
  win.on('blur', sendWindowFocus);
  win.on('enter-full-screen', () => {
    sendFullscreen(true);
    flush();
  });
  win.on('leave-full-screen', () => {
    sendFullscreen(false);
    if (hideAfterFullScreen && !quitting && !win.isDestroyed()) {
      hideAfterFullScreen = false;
      win.hide();
    }
    flush();
  });
  win.webContents.on('did-finish-load', () => {
    sendFullscreen(win.isFullScreen());
    sendWindowFocus();
  });

  attachContextMenu(win);
  attachTrackpadSwipe(win);

  win.webContents.on('will-prevent-unload', () => {
    quitting = false;
    hideAfterFullScreen = false;
  });

  win.on('close', (event) => {
    flush();
    if (process.platform !== 'darwin' || quitting) return;
    event.preventDefault();
    if (win.isDestroyed()) return;
    win.webContents.send('desktop:shell-event', { type: 'window-hidden' });
    if (win.isFullScreen()) {
      hideAfterFullScreen = true;
      win.setFullScreen(false);
    } else {
      win.hide();
    }
  });

  let lastCrashReloadAt = 0;
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now();
    if (now - lastCrashReloadAt <= CRASH_RESET_MS) return;
    lastCrashReloadAt = now;
    win.webContents.reload();
  });

  win.on('closed', () => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (activeFlushWindowState === flush) activeFlushWindowState = undefined;
    hideAfterFullScreen = false;
    if (mainWindow === win) mainWindow = undefined;
  });

  void win.loadURL(`${APP_ORIGIN}/`);
  return win;
};
