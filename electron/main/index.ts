import path from 'node:path';
import { app, session } from 'electron';
import { registerBundleScheme, serveBundle } from './bundleProtocol';
import { getMainWindow, showMainWindow } from './mainWindow';
import { guardSession } from './security';

registerBundleScheme();

const unpackaged = !app.isPackaged;
const isTest = unpackaged && process.env.MINDROOM_E2E_TEST === '1';
if (unpackaged && process.env.MINDROOM_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.MINDROOM_USER_DATA_DIR));
}
const distDir =
  unpackaged && process.env.MINDROOM_DIST_DIR
    ? path.resolve(process.env.MINDROOM_DIST_DIR)
    : app.isPackaged
    ? path.join(app.getAppPath(), 'dist')
    : path.resolve(__dirname, '../../dist');

const telemetry = isTest
  ? {
      blockedUrls: [] as string[],
      permissions: [] as Array<{ kind: 'check' | 'request'; permission: string; granted: boolean }>,
    }
  : undefined;
if (telemetry) Object.assign(globalThis, { __mindroomTestTelemetry: telemetry });
const onBlockedUrl = telemetry ? (url: string) => telemetry.blockedUrls.push(url) : undefined;

void app.whenReady().then(() => {
  if (isTest && process.env.MINDROOM_E2E_OFFLINE === '1') {
    session.defaultSession.enableNetworkEmulation({ offline: true });
  }
  serveBundle(distDir);
  guardSession(
    session.defaultSession,
    (wc) => wc !== null && wc === getMainWindow()?.webContents,
    telemetry
      ? (k, p, g) => telemetry.permissions.push({ kind: k, permission: p, granted: g })
      : undefined
  );
  showMainWindow(onBlockedUrl);
});

app.on('activate', () => showMainWindow(onBlockedUrl));
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
