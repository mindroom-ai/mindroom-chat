import path from 'node:path';
import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createAuthCallback, registerSignInHandlers } from './authCallback';
import { registerBundleScheme, serveBundle } from './bundleProtocol';
import { handle } from './ipc';
import {
  configureMainWindow,
  flushMainWindowState,
  getMainWindow,
  markQuitting,
  showMainWindow,
} from './mainWindow';
import { installMediaAuth } from './mediaAuth';
import { buildMenuTemplate } from './menu';
import {
  guardSession,
  registerExternalOpenHandler,
  setBlockedUrlRecorder,
  supportsSystemScreenShare,
} from './security';
import { startUpdater, type UpdaterHandle } from './updater';

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

// Carries no URL: the page takes the return itself, once, through `desktop:take-app-url`.
const notifyAppUrl = (): void => getMainWindow()?.webContents.send('desktop:app-url');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const authCallback = createAuthCallback(notifyAppUrl, focusMainWindow);
let updater: UpdaterHandle | undefined;

app.on('second-instance', () => {
  if (gotLock && app.isReady()) focusMainWindow();
});

app.on('before-quit', () => {
  markQuitting();
  flushMainWindowState();
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

  const screenShare = supportsSystemScreenShare(
    process.platform,
    typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '',
    isTest ? process.env.MINDROOM_DESKTOP_SCREEN_SHARE : undefined
  );
  configureMainWindow({ screenShare, updater: app.isPackaged });

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
        quickCapture: false,
      },
      {
        onZoom: (action) => {
          const win = getMainWindow();
          if (win) win.webContents.send('desktop:shell-event', { type: 'zoom', action });
        },
        onCheckForUpdates,
        onRestartToUpdate: () => updater?.install(),
      }
    );
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  };

  if (app.isPackaged) {
    updater = startUpdater(autoUpdater, rebuildMenu, {
      onBeforeInstall: () => {
        markQuitting();
        flushMainWindowState();
      },
    });
  }
  rebuildMenu();

  const mainOwners = (): readonly Electron.WebContents[] => {
    const win = getMainWindow();
    return win ? [win.webContents] : [];
  };
  const appWindows = isTest
    ? (): readonly Electron.WebContents[] =>
        BrowserWindow.getAllWindows().flatMap((w) => (w.isDestroyed() ? [] : [w.webContents]))
    : mainOwners;
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
    'desktop:update-status',
    mainOwners,
    (args) => (args.length === 0 ? true : undefined),
    async () => ({ ok: true, value: { version: updater?.readyVersion() } })
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
    wc.once('destroyed', forget);
    wc.on('render-process-gone', forget);
    // A sign-in starts only after a click or key press that main itself saw in the main window.
    wc.on('input-event', (_event, { type }) => {
      const gesture = type === 'mouseUp' || type === 'keyDown' || type === 'rawKeyDown';
      if (gesture && wc === getMainWindow()?.webContents) authCallback.noteGesture();
    });
  });
  showMainWindow();
});

app.on('will-quit', () => {
  updater?.stop();
  authCallback.close();
});
app.on('activate', () => {
  if (gotLock) showMainWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
