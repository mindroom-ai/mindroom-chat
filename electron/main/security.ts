import {
  isSignInUrl,
  parseSignInRequest,
  type PendingSignIn,
  type SignInRequest,
} from './authCallback';
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
const MEDIA_PATH_RE = /(?:^|\/)_matrix\/(?:[^/]+\/)*media\//i;
const MAILTO_BLOCKED_PARAMS = new Set(['attach', 'attachment']);

const decodeOnce = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const hasParam = (query: string, match: (lowerKey: string) => boolean): boolean =>
  Array.from(new URLSearchParams(query).keys()).some((k) => match(k.toLowerCase()));

const hasAccessToken = (u: URL): boolean => {
  const isToken = (k: string) => k === 'access_token';
  if (hasParam(u.search, isToken)) return true;
  const hash = u.hash.slice(1);
  if (!hash) return false;
  if (hasParam(hash, isToken)) return true;
  const qAt = hash.indexOf('?');
  return qAt >= 0 && hasParam(hash.slice(qAt + 1), isToken);
};

const isMediaPath = (pathname: string): boolean => {
  const once = decodeOnce(pathname).replace(/\\/g, '/');
  const twice = decodeOnce(once).replace(/\\/g, '/');
  return [pathname, once, twice].some((p) => MEDIA_PATH_RE.test(p.replace(/\/+/g, '/')));
};

export const isOpenable = (url: string): boolean => {
  if (!url || /[\r\n\0]/.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return false;
  if (hasAccessToken(u)) return false;
  if (u.protocol === 'mailto:') {
    return u.pathname.trim().length > 0 && !hasParam(u.search, (k) => MAILTO_BLOCKED_PARAMS.has(k));
  }
  if (u.username || u.password) return false;
  return !isMediaPath(u.pathname);
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

type ExternalOpenDeps = {
  externalOwners: () => readonly Electron.WebContents[];
  signInOwners: () => readonly Electron.WebContents[];
  authCallback: {
    start(r: SignInRequest): Promise<PendingSignIn>;
    pending(): PendingSignIn | undefined;
  };
  openUrl: (url: string) => Promise<void>;
};

const stringArg = (args: unknown[]): string | undefined =>
  args.length === 1 && typeof args[0] === 'string' ? args[0] : undefined;

export const registerExternalOpenHandlers = ({
  externalOwners,
  signInOwners,
  authCallback,
  openUrl,
}: ExternalOpenDeps): void => {
  handle(
    'desktop:open-external',
    externalOwners,
    (args) => {
      const url = stringArg(args);
      return url && isOpenable(url) ? new URL(url).href : undefined;
    },
    async (url) => ({ ok: true, value: await openUrl(url) })
  );
  handle(
    'desktop:start-sign-in',
    signInOwners,
    (args) => (args.length === 1 ? parseSignInRequest(args[0]) : undefined),
    async (req) => ({ ok: true, value: (await authCallback.start(req)).redirectUrl })
  );
  handle('desktop:open-sign-in', signInOwners, stringArg, async (url) => {
    const pending = authCallback.pending();
    if (!pending || !isSignInUrl(url, pending)) return { ok: false, code: 'BAD_ARGUMENTS' };
    return { ok: true, value: await openUrl(url) };
  });
};
