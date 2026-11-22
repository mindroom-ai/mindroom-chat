import path from 'node:path';
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { createAuthCallback } from './authCallback';
import { APP_ORIGIN, isAllowedAppPage, registerBundleScheme, serveBundle } from './bundleProtocol';
import { getMainWindow, showMainWindow } from './mainWindow';
import { installMediaAuth } from './mediaAuth';
import { guardSession, registerExternalOpenHandlers, setBlockedUrlRecorder } from './security';

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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const authCallback = createAuthCallback((nativeUrl) => {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  try {
    const frame = win.webContents.mainFrame;
    if (frame.origin === APP_ORIGIN && isAllowedAppPage(frame.url)) {
      win.webContents.send('desktop:app-url', nativeUrl);
    }
  } catch {
    // Window or main frame was disposed.
  }
}, focusMainWindow);

app.on('second-instance', () => {
  if (gotLock && app.isReady()) focusMainWindow();
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
  const mainOwners = (): readonly Electron.WebContents[] => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? [win.webContents] : [];
  };
  const appWindows = (): readonly Electron.WebContents[] =>
    (isTest ? BrowserWindow.getAllWindows() : [getMainWindow()]).flatMap((w) =>
      w && !w.isDestroyed() ? [w.webContents] : []
    );
  guardSession(
    session.defaultSession,
    (wc) => wc === getMainWindow()?.webContents,
    telemetry ? (perm) => telemetry.networkPermissions.push(perm) : undefined
  );
  registerExternalOpenHandlers({
    externalOwners: appWindows,
    signInOwners: mainOwners,
    authCallback,
    openUrl: async (url) => {
      if (telemetry) telemetry.externalOpens.push(url);
      else await shell.openExternal(url);
    },
  });
  const forgetMedia = installMediaAuth(session.defaultSession, appWindows);
  app.on('web-contents-created', (_e, wc) => {
    const forget = () => forgetMedia(wc.id);
    wc.once('destroyed', forget);
    wc.on('render-process-gone', forget);
  });
  showMainWindow();
});

app.on('will-quit', () => authCallback.close());
app.on('activate', () => {
  if (gotLock) showMainWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
