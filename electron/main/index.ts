import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, globalShortcut, Menu, screen, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createAuthCallback, registerSignInHandlers } from './authCallback';
import { APP_ORIGIN, registerBundleScheme, serveBundle } from './bundleProtocol';
import {
  createDesktopAccess,
  registerDesktopAccessHandlers,
  type DesktopAccessHandle,
} from './desktopAccess';
import { resolveDesktopHelperBinary } from './desktopBridgeProcess';
import { createScreenshotHelper, resolveHelperPath, type ScreenshotTarget } from './helper';
import { handle } from './ipc';
import {
  configureMainWindow,
  flushMainWindowState,
  getMainWindow,
  isQuitting,
  markQuitting,
  showMainWindow,
} from './mainWindow';
import { installMediaAuth } from './mediaAuth';
import { buildMenuTemplate } from './menu';
import { createQuickCapture, type QuickCaptureHandle } from './quickCapture';
import {
  guardSession,
  registerExternalOpenHandler,
  setBlockedUrlRecorder,
  supportsQuickCaptureScreenshots,
  supportsSystemScreenShare,
} from './security';
import { startUpdater, type UpdaterHandle } from './updater';

const SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

// Prevent dedicated worker fetches from inheriting their creator's main frame in webRequest.
app.commandLine.appendSwitch(
  'disable-features',
  [app.commandLine.getSwitchValue('disable-features'), 'UseAncestorRenderFrameForWorker']
    .filter(Boolean)
    .join(',')
);

registerBundleScheme();

const unpackaged = !app.isPackaged;
const isTest = unpackaged && process.env.MINDROOM_DESKTOP_TEST === '1';
if (unpackaged && process.env.MINDROOM_DESKTOP_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.MINDROOM_DESKTOP_USER_DATA));
}
const distDir =
  unpackaged && process.env.MINDROOM_DESKTOP_DIST
    ? path.resolve(process.env.MINDROOM_DESKTOP_DIST)
    : app.isPackaged
      ? path.join(app.getAppPath(), 'dist')
      : path.resolve(__dirname, '../../dist');

const telemetry = isTest
  ? {
      blockedUrls: [] as string[],
      networkPermissions: [] as string[],
      externalOpens: [] as string[],
      badgeCounts: [] as number[],
    }
  : undefined;
if (telemetry) {
  Object.assign(globalThis, { __mindroomTestTelemetry: telemetry });
  setBlockedUrlRecorder((url) => telemetry.blockedUrls.push(url));
}

const focusMainWindow = (): void => {
  const win = showMainWindow();
  if (win.isMinimized()) win.restore();
  app.focus({ steal: true });
};

const setAppBadge = (count: number): void => {
  const n = Math.max(0, Math.floor(count));
  app.setBadgeCount(n);
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(n > 0 ? (n > 99 ? '99+' : String(n)) : '');
  }
  telemetry?.badgeCounts.push(n);
};

// Carries no URL: the page takes the return itself, once, through `desktop:take-app-url`.
const notifyAppUrl = (): void => getMainWindow()?.webContents.send('desktop:app-url');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const authCallback = createAuthCallback(notifyAppUrl, focusMainWindow);
let updater: UpdaterHandle | undefined;
let quickCapture: QuickCaptureHandle | undefined;
let desktopAccess: DesktopAccessHandle | undefined;

app.on('second-instance', () => {
  if (gotLock && app.isReady()) focusMainWindow();
});

app.on('before-quit', () => {
  markQuitting();
  flushMainWindowState();
  quickCapture?.flushState();
  void desktopAccess?.stop();
});

void app.whenReady().then(() => {
  if (!gotLock) return;
  if (isTest && process.env.MINDROOM_DESKTOP_OFFLINE === '1') {
    session.defaultSession.enableNetworkEmulation({ offline: true });
  }
  try {
    serveBundle(distDir);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (isTest) console.error(message);
    else dialog.showErrorBox('MindRoom', message);
    app.exit(1);
    return;
  }

  const systemVersion =
    typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '';
  const screenShare = supportsSystemScreenShare(
    process.platform,
    systemVersion,
    isTest ? process.env.MINDROOM_DESKTOP_SCREEN_SHARE : undefined
  );

  const desktopHelperOverride = unpackaged ? process.env.MINDROOM_DESKTOP_HELPER_BIN : undefined;
  const desktopHelperResolution = resolveDesktopHelperBinary({
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    unpackagedRoot: path.resolve(__dirname, '../..'),
    envOverride: desktopHelperOverride,
  });
  desktopAccess = createDesktopAccess({
    platform: process.platform,
    arch: process.arch,
    userDataDir: app.getPath('userData'),
    configPath:
      unpackaged && process.env.MINDROOM_DESKTOP_CONFIG_PATH
        ? path.resolve(process.env.MINDROOM_DESKTOP_CONFIG_PATH)
        : undefined,
    storagePath:
      unpackaged && process.env.MINDROOM_DESKTOP_STORAGE_PATH
        ? path.resolve(process.env.MINDROOM_DESKTOP_STORAGE_PATH)
        : undefined,
    preload: path.join(__dirname, 'preload.cjs'),
    isQuitting,
    getMainWindow,
    resolution: desktopHelperResolution,
    isTestHelper: Boolean(desktopHelperOverride),
    enableLoginItem: app.isPackaged && process.platform === 'darwin',
    onStatusChange: () => {
      getMainWindow()?.webContents.send('desktop:shell-event', { type: 'desktop-access-status' });
    },
    onOpenMainWindow: focusMainWindow,
    onOpenSettings: () => {
      focusMainWindow();
      const win = getMainWindow();
      if (!win) return;
      const send = (): void => {
        if (!win.isDestroyed()) {
          win.webContents.send('desktop:shell-event', { type: 'open-desktop-access-settings' });
        }
      };
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
      else send();
    },
  });
  const activeDesktopAccess = desktopAccess;

  configureMainWindow({
    screenShare,
    updater: app.isPackaged,
    desktopAccess: activeDesktopAccess.isAvailable(),
  });

  const helperPath = resolveHelperPath({
    isPackaged: app.isPackaged,
    isTest,
    resourcesPath: process.resourcesPath,
    unpackagedDir: path.resolve(__dirname),
    testOverride: unpackaged ? process.env.MINDROOM_DESKTOP_HELPER : undefined,
  });
  const helperAvailable =
    helperPath !== undefined &&
    (isTest || supportsQuickCaptureScreenshots(process.platform, systemVersion)) &&
    fs.existsSync(helperPath);
  const screenshotHelper = helperAvailable ? createScreenshotHelper(helperPath) : undefined;

  quickCapture = createQuickCapture({
    url: `${APP_ORIGIN}/quick-capture/`,
    preload: path.join(__dirname, 'preload.cjs'),
    userDataDir: app.getPath('userData'),
    isQuitting,
    isMainWindowVisible: () => Boolean(getMainWindow()?.isVisible()),
    screenshotHelper: screenshotHelper
      ? { available: true, readFrontTarget: () => screenshotHelper.readFrontTarget() }
      : undefined,
  });
  const activeQuickCapture = quickCapture;

  try {
    if (!globalShortcut.register('Control+Alt+Space', () => activeQuickCapture.toggle())) {
      console.warn('Could not register Quick Capture global shortcut (Control+Alt+Space)');
    }
  } catch (error) {
    console.warn('Failed to register Quick Capture global shortcut:', error);
  }

  if (isTest) {
    Object.assign(globalThis, {
      __mindroomTestQuickCapture: {
        toggle: () => activeQuickCapture.toggle(),
        hide: () => activeQuickCapture.hide(),
      },
    });
  }

  const showUpdateDialog = (
    options: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> => {
    const win = getMainWindow();
    return win && win.isVisible()
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options);
  };

  const onCheckForUpdates = (): void => {
    const active = updater;
    if (!active) return;
    void (async () => {
      const outcome = await active.check();
      if (active.readyVersion()) {
        const { response } = await showUpdateDialog({
          type: 'info',
          buttons: ['Restart Now', 'Later'],
          defaultId: 0,
          cancelId: 1,
          message: 'An update is ready to install.',
        });
        if (response === 0) active.install();
        return;
      }
      const message =
        outcome === 'none'
          ? 'MindRoom Chat is up to date.'
          : outcome === 'found'
            ? 'An update is available and downloading in the background. You can restart from the menu once it is ready.'
            : 'Could not check for updates right now.';
      await showUpdateDialog({ type: outcome === 'error' ? 'error' : 'info', message });
    })().catch(() => undefined);
  };

  const rebuildMenu = (): void => {
    const menuTemplate = buildMenuTemplate(
      {
        updateReady: Boolean(updater?.readyVersion()),
        canCheck: Boolean(updater),
        quickCapture: true,
      },
      {
        onZoom: (action) => {
          const win = getMainWindow();
          if (win && BrowserWindow.getFocusedWindow() === win) {
            win.webContents.send('desktop:shell-event', { type: 'zoom', action });
          }
        },
        onCheckForUpdates,
        onRestartToUpdate: () => updater?.install(),
        onQuickCapture: () => activeQuickCapture.toggle(),
      }
    );
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  };

  if (app.isPackaged) {
    updater = startUpdater(
      autoUpdater,
      () => {
        rebuildMenu();
        getMainWindow()?.webContents.send('desktop:shell-event', { type: 'update-status' });
      },
      {
        onBeforeInstall: () => {
          markQuitting();
          flushMainWindowState();
          activeQuickCapture.flushState();
          void activeDesktopAccess.stop();
        },
      }
    );
  }
  rebuildMenu();

  const mainOwners = (): readonly Electron.WebContents[] => {
    const win = getMainWindow();
    return win ? [win.webContents] : [];
  };
  const quickCaptureOwners = (): readonly Electron.WebContents[] => {
    const wc = activeQuickCapture.contents();
    return wc && !wc.isDestroyed() ? [wc] : [];
  };
  const shellApprovalOwners = (): readonly Electron.WebContents[] => {
    const wc = activeDesktopAccess.shellApprovalContents();
    return wc && !wc.isDestroyed() ? [wc] : [];
  };
  const appWindows = isTest
    ? (): readonly Electron.WebContents[] =>
        BrowserWindow.getAllWindows().flatMap((w) => (w.isDestroyed() ? [] : [w.webContents]))
    : (): readonly Electron.WebContents[] => [...mainOwners(), ...quickCaptureOwners()];
  guardSession(
    session.defaultSession,
    (wc) => wc === getMainWindow()?.webContents,
    telemetry ? (perm) => telemetry.networkPermissions.push(perm) : undefined,
    { screenShare }
  );
  const openUrl = async (url: string): Promise<void> => {
    if (telemetry) telemetry.externalOpens.push(url);
    else await shell.openExternal(url);
  };
  registerExternalOpenHandler(appWindows, openUrl);
  registerSignInHandlers(mainOwners, authCallback, openUrl);
  registerDesktopAccessHandlers(mainOwners, shellApprovalOwners, activeDesktopAccess);
  handle(
    'desktop:show-main-window',
    appWindows,
    (args) => (args.length === 0 ? true : undefined),
    async () => {
      focusMainWindow();
      return { ok: true, value: undefined };
    }
  );
  handle(
    'desktop:set-badge',
    mainOwners,
    (args): number | undefined =>
      args.length === 1 && typeof args[0] === 'number' && Number.isFinite(args[0]) && args[0] >= 0
        ? args[0]
        : undefined,
    async (count) => {
      setAppBadge(count);
      return { ok: true, value: undefined };
    }
  );
  handle(
    'desktop:quick-capture-hide',
    quickCaptureOwners,
    (args) => (args.length === 0 ? true : undefined),
    async () => {
      activeQuickCapture.hide();
      return { ok: true, value: undefined };
    }
  );
  handle(
    'desktop:open-screen-recording-settings',
    quickCaptureOwners,
    (args) => (args.length === 0 ? true : undefined),
    async () => {
      if (process.platform === 'darwin' || telemetry) {
        await openUrl(SCREEN_RECORDING_SETTINGS_URL);
      }
      return { ok: true, value: undefined };
    }
  );
  handle(
    'desktop:quick-capture-screenshot',
    quickCaptureOwners,
    (args): ScreenshotTarget | undefined =>
      args.length === 1 && (args[0] === 'window' || args[0] === 'screen') ? args[0] : undefined,
    async (target) => {
      if (!screenshotHelper) return { ok: false, code: 'UNSUPPORTED' };
      if (target === 'window') {
        return screenshotHelper.captureWindow(activeQuickCapture.frontTarget());
      }
      const displayId = activeQuickCapture.displayId() ?? screen.getPrimaryDisplay().id;
      return screenshotHelper.captureScreen(displayId, process.pid);
    }
  );
  handle(
    'desktop:update-status',
    mainOwners,
    (args) => (args.length === 0 ? true : undefined),
    async () => ({ ok: true, value: { version: updater?.readyVersion() } })
  );
  handle(
    'desktop:update-check',
    mainOwners,
    (args) => (args.length === 0 ? true : undefined),
    async () => {
      if (!updater) return { ok: false, code: 'UNSUPPORTED' };
      const outcome = await updater.check();
      return { ok: true, value: { outcome, version: updater.readyVersion() } };
    }
  );
  handle(
    'desktop:update-install',
    mainOwners,
    (args) => (args.length === 0 ? true : undefined),
    async () => {
      if (!updater?.readyVersion()) return { ok: false, code: 'NOT_READY' };
      updater.install();
      return { ok: true, value: undefined };
    }
  );
  const forgetMedia = installMediaAuth(session.defaultSession, appWindows);
  app.on('web-contents-created', (_e, wc) => {
    const forget = () => forgetMedia(wc.id);
    const clearMainBadge = () => {
      if (wc === getMainWindow()?.webContents) setAppBadge(0);
    };
    wc.once('destroyed', forget);
    wc.on('did-navigate', clearMainBadge);
    wc.on('render-process-gone', () => {
      forget();
      clearMainBadge();
    });
    // Sensitive desktop actions start only after a click or key press in an authorized window.
    wc.on('input-event', (_event, { type }) => {
      const gesture = type === 'mouseUp' || type === 'keyDown' || type === 'rawKeyDown';
      if (!gesture) return;
      if (wc === getMainWindow()?.webContents) {
        authCallback.noteGesture();
        activeDesktopAccess.noteGesture();
      } else if (wc === activeDesktopAccess.shellApprovalContents()) {
        activeDesktopAccess.noteShellApprovalGesture();
      }
    });
  });
  showMainWindow();
  void activeDesktopAccess.start();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  updater?.stop();
  authCallback.close();
  void desktopAccess?.stop();
});
app.on('activate', () => {
  if (gotLock) showMainWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
