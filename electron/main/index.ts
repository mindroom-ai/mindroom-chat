import path from 'node:path';
import { app, session } from 'electron';
import { registerBundleScheme, serveBundle } from './bundleProtocol';
import { getMainWindow, showMainWindow } from './mainWindow';
import { guardSession, setBlockedUrlRecorder } from './security';

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
  serveBundle(distDir);
  guardSession(
    session.defaultSession,
    (wc) => wc === getMainWindow()?.webContents,
    telemetry ? (perm) => telemetry.networkPermissions.push(perm) : undefined
  );
  showMainWindow();
});

app.on('activate', () => showMainWindow());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
