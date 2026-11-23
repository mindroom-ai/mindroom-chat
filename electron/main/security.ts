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
const MAX_URL_LENGTH = 8192;
const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
// `access_token` as a parameter name (query, fragment, or a query inside the fragment), or
// `access_token=` anywhere, which also catches a nested redirect that carries one.
const ACCESS_TOKEN_RE = /[?&#]access_token(?:[=&#]|$)|access_token=/i;
// eslint-disable-next-line no-control-regex
const MAILTO_ATTACH_RE = /[?&]attach(?:ment)?(?:[=&#\0]|$)/i;

/** The text as written, percent-decoded once, and twice. Decodes byte by byte: never throws. */
const decodings = (value: string): string[] => {
  const decode = (text: string): string =>
    text.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const once = decode(value);
  return [value, once, decode(once)];
};

/** One pass over the path segments: a `_matrix` segment followed later by a `media` segment. */
const isMediaPath = (pathname: string): boolean => {
  let inMatrix = false;
  return pathname
    .toLowerCase()
    .split(/[/\\]/)
    .some((segment) => {
      if (segment === '_matrix') inMatrix = true;
      return inMatrix && segment === 'media';
    });
};

/** The canonical form of a URL the app may hand to the system, or `undefined`. */
export const openableHref = (url: string): string | undefined => {
  // eslint-disable-next-line no-control-regex
  if (!url || url.length > MAX_URL_LENGTH || /[\0-\x1f\x7f]/.test(url)) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.href.length > MAX_URL_LENGTH || !OPENABLE_SCHEMES.has(u.protocol)) return undefined;
  if (u.username || u.password) return undefined;
  const texts = decodings(url);
  const paths = decodings(u.pathname);
  if (texts.some((text) => ACCESS_TOKEN_RE.test(text))) return undefined;
  if (u.protocol === 'mailto:') {
    // An authority (`mailto://host/x`) is no address; a blank path names nobody.
    if (u.host || u.href.startsWith('mailto://') || paths.some((path) => !path.trim()))
      return undefined;
    if (texts.some((text) => MAILTO_ATTACH_RE.test(text))) return undefined;
  }
  return paths.some(isMediaPath) ? undefined : u.href;
};

export const isOpenable = (url: string): boolean => openableHref(url) !== undefined;

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

/**
 * Whether this host supports macOS 15+ system screen sharing (SCContentSharingPicker).
 * Unpackaged tests may pass an explicit `'1'` or `'0'` override.
 */
export const supportsSystemScreenShare = (
  platform: NodeJS.Platform,
  systemVersion: string,
  testOverride?: string
): boolean => {
  if (testOverride === '1') return true;
  if (testOverride === '0') return false;
  if (platform !== 'darwin') return false;
  const match = /^(\d+)(?:\.|$)/.exec(systemVersion.trim());
  return match !== null && Number(match[1]) >= 15;
};

export const guardSession = (
  session: Electron.Session,
  isMainWindow: (contents: Electron.WebContents) => boolean,
  onNetworkPermission?: (permission: string) => void,
  options?: { screenShare?: boolean }
): void => {
  const screenShare = options?.screenShare ?? false;
  const allowedPermissions = screenShare
    ? new Set([...ALLOWED_PERMISSIONS, 'display-capture'])
    : ALLOWED_PERMISSIONS;

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
      allowedPermissions.has(perm) &&
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
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      callback({});
    },
    screenShare ? { useSystemPicker: true } : { useSystemPicker: false }
  );
};

export const registerExternalOpenHandler = (
  owners: () => readonly Electron.WebContents[],
  openUrl: (url: string) => Promise<void>
): void => {
  handle(
    'desktop:open-external',
    owners,
    (args) =>
      args.length === 1 && typeof args[0] === 'string' ? openableHref(args[0]) : undefined,
    async (url) => ({ ok: true, value: await openUrl(url) })
  );
};
