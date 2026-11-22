import path from 'node:path';
import { app, BrowserWindow, dialog, session } from 'electron';
import { registerBundleScheme, serveBundle } from './bundleProtocol';
import { getMainWindow, showMainWindow } from './mainWindow';
import { installMediaAuth } from './mediaAuth';
import { guardSession, setBlockedUrlRecorder } from './security';

// Prevent dedicated worker fetches from inheriting their creator's main frame in webRequest.
const disabledFeatures = app.commandLine
  .getSwitchValue('disable-features')
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean);
if (!disabledFeatures.includes('UseAncestorRenderFrameForWorker')) {
  disabledFeatures.push('UseAncestorRenderFrameForWorker');
}
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));

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
  ? { blockedUrls: [] as string[], networkPermissions: [] as string[] }
  : undefined;
if (telemetry) {
  Object.assign(globalThis, { __mindroomTestTelemetry: telemetry });
  setBlockedUrlRecorder((url) => telemetry.blockedUrls.push(url));
}

void app.whenReady().then(() => {
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
  const appWindows = (): readonly Electron.WebContents[] =>
    (isTest ? BrowserWindow.getAllWindows() : [getMainWindow()]).flatMap((w) =>
      w && !w.isDestroyed() ? [w.webContents] : []
    );
  guardSession(
    session.defaultSession,
    (wc) => wc === getMainWindow()?.webContents,
    telemetry ? (perm) => telemetry.networkPermissions.push(perm) : undefined
  );
  const forgetMedia = installMediaAuth(session.defaultSession, appWindows);
  app.on('web-contents-created', (_e, wc) => {
    const forget = () => forgetMedia(wc.id);
    wc.once('destroyed', forget);
    wc.on('render-process-gone', forget);
  });
  showMainWindow();
});

app.on('activate', () => showMainWindow());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
