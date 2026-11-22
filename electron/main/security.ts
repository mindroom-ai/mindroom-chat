import { APP_ORIGIN, isFramePage, parseAppUrl } from './bundleProtocol';

const NETWORK_PERMISSIONS = new Set(['local-network', 'local-network-access', 'loopback-network']);
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
  'persistent-storage',
  ...NETWORK_PERMISSIONS,
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
  isMainWindow: (contents: Electron.WebContents) => boolean,
  onNetworkPermission?: (permission: string) => void
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
    url: string | undefined,
    origin?: string
  ): boolean => {
    if (NETWORK_PERMISSIONS.has(perm)) onNetworkPermission?.(perm);
    return (
      isMainFrame &&
      ALLOWED_PERMISSIONS.has(perm) &&
      wc !== null &&
      isMainWindow(wc) &&
      wc.mainFrame.origin === APP_ORIGIN &&
      isAllowedAppPage(wc.mainFrame.url) &&
      (origin === undefined || parseAppUrl(origin) !== undefined) &&
      (url === undefined || isAllowedAppPage(url))
    );
  };

  session.setPermissionCheckHandler((wc, perm, origin, d) =>
    canGrant(wc, perm, d.isMainFrame, d.requestingUrl, origin)
  );
  session.setPermissionRequestHandler((wc, perm, cb, d) => {
    cb(canGrant(wc, perm, d.isMainFrame, d.requestingUrl));
  });
};
