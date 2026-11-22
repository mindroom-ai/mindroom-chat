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
};

export const guardSession = (
  session: Electron.Session,
  isMainWindow?: (contents: Electron.WebContents | null) => boolean,
  onPermission?: (kind: 'check' | 'request', permission: string, granted: boolean) => void
): void => {
  session.webRequest.onBeforeRequest({ urls: [`${APP_ORIGIN}/*`] }, (details, callback) => {
    const parsed = parseAppUrl(details.url);
    callback({
      cancel:
        parsed !== undefined && isFramePage(parsed.pathname) && details.resourceType !== 'subFrame',
    });
  });

  const canGrant = (
    wc: Electron.WebContents | null,
    perm: string,
    isMainFrame: boolean,
    origin?: string,
    url?: string
  ): boolean =>
    isMainFrame &&
    ALLOWED_PERMISSIONS.has(perm) &&
    (isMainWindow ? isMainWindow(wc) : wc !== null) &&
    (origin === undefined || parseAppUrl(origin) !== undefined) &&
    (url === undefined || isAllowedAppPage(url)) &&
    (origin !== undefined || url !== undefined);

  session.setPermissionCheckHandler((wc, perm, origin, d) => {
    const ok = canGrant(wc, perm, d.isMainFrame, origin, d.requestingUrl);
    onPermission?.('check', perm, ok);
    return ok;
  });
  session.setPermissionRequestHandler((wc, perm, cb, d) => {
    const ok = canGrant(wc, perm, d.isMainFrame, undefined, d.requestingUrl);
    onPermission?.('request', perm, ok);
    cb(ok);
  });
};
