import { APP_ORIGIN, isFramePage, parseAppUrl } from './bundleProtocol';

const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
  'persistent-storage',
  'local-network',
  'local-network-access',
  'loopback-network',
]);

const isAllowedAppPage = (rawUrl: string): boolean => {
  const parsed = parseAppUrl(rawUrl);
  return parsed !== undefined && !isFramePage(parsed.pathname);
};

export const guardWebContents = (
  contents: Electron.WebContents,
  onBlockedUrl?: (url: string) => void
): void => {
  contents.setWindowOpenHandler(({ url }) => {
    onBlockedUrl?.(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAllowedAppPage(url)) return;
    event.preventDefault();
    onBlockedUrl?.(url);
  });
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || isAllowedAppPage(event.url)) return;
    event.preventDefault();
    onBlockedUrl?.(event.url);
  });
};

export const guardSession = (
  session: Electron.Session,
  isMainWindow?: (contents: Electron.WebContents | null) => boolean,
  onPermission?: (kind: 'check' | 'request', permission: string, granted: boolean) => void
): void => {
  session.webRequest.onBeforeRequest({ urls: [`${APP_ORIGIN}/*`] }, (details, callback) => {
    const parsed = parseAppUrl(details.url);
    const cancel =
      parsed !== undefined && isFramePage(parsed.pathname) && details.resourceType !== 'subFrame';
    callback({ cancel });
  });

  const canGrant = (
    webContents: Electron.WebContents | null,
    permission: string,
    isMainFrame: boolean,
    origin: string | undefined,
    requestingUrl: string | undefined
  ): boolean => {
    if (!isMainFrame || !ALLOWED_PERMISSIONS.has(permission)) return false;
    if (isMainWindow ? !isMainWindow(webContents) : webContents === null) return false;
    if (origin !== undefined && parseAppUrl(origin) === undefined) return false;
    if (requestingUrl !== undefined && !isAllowedAppPage(requestingUrl)) return false;
    return origin !== undefined || requestingUrl !== undefined;
  };

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const granted = canGrant(
      webContents,
      permission,
      details.isMainFrame,
      requestingOrigin,
      details.requestingUrl
    );
    onPermission?.('check', permission, granted);
    return granted;
  });

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const granted = canGrant(
      webContents,
      permission,
      details.isMainFrame,
      undefined,
      details.requestingUrl
    );
    onPermission?.('request', permission, granted);
    callback(granted);
  });
};
