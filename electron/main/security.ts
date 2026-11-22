import { APP_ORIGIN, isAllowedAppPage, isFramePage, parseAppUrl } from './bundleProtocol';
import { handle } from './ipc';

const NETWORK_PERMISSIONS = new Set(['local-network', 'local-network-access', 'loopback-network']);
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
  'persistent-storage',
  ...NETWORK_PERMISSIONS,
]);
const MEDIA_PATH_RE = /(?:^|\/)_matrix\/(?:media\/|client\/[^/]+\/media\/)/i;
const ACCESS_TOKEN_RE = /(?:^|[?&#])access_token(?:=|&|#|$)/i;

const decodeOnce = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const hasAccessToken = (q: string): boolean =>
  ACCESS_TOKEN_RE.test(q) ||
  Array.from(new URLSearchParams(q).keys()).some((k) => k.toLowerCase() === 'access_token');

export const isOpenable = (url: string): boolean => {
  if (!url || /[\r\n\0]/.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return false;
  if (hasAccessToken(u.search) || hasAccessToken(u.hash.slice(1))) return false;
  if (u.protocol === 'mailto:') return u.pathname.trim().length > 0;
  const once = decodeOnce(u.pathname).replace(/\\/g, '/');
  return ![u.pathname, once, decodeOnce(once).replace(/\\/g, '/')].some((p) =>
    MEDIA_PATH_RE.test(p)
  );
};

let blockedUrlRecorder: ((url: string) => void) | undefined;

export const setBlockedUrlRecorder = (recorder: ((url: string) => void) | undefined): void => {
  blockedUrlRecorder = recorder;
};

export const guardWebContents = (contents: Electron.WebContents): void => {
  contents.setWindowOpenHandler(({ url }) => {
    blockedUrlRecorder?.(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAllowedAppPage(url)) return;
    event.preventDefault();
    blockedUrlRecorder?.(url);
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

export const registerExternalOpenHandler = (
  owners: () => readonly Electron.WebContents[],
  openUrl: (url: string) => Promise<void>
): void => {
  handle(
    'desktop:open-external',
    owners,
    (args) =>
      args.length === 1 && typeof args[0] === 'string' && isOpenable(args[0]) ? args[0] : undefined,
    async (url) => ({ ok: true, value: await openUrl(url) })
  );
};
