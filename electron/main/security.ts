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
const MAX_URL_LENGTH = 8192;
const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
// `access_token` as a parameter name (query, fragment, or a query inside the fragment), or
// `access_token=` anywhere, which also catches a nested redirect that carries one.
const ACCESS_TOKEN_RE = /[?&#]access_token(?:[=&#]|$)|access_token=/i;
const MAILTO_BLOCKED_PARAMS = new Set(['attach', 'attachment']);

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
  if (!OPENABLE_SCHEMES.has(u.protocol) || u.username || u.password) return undefined;
  if (decodings(url).some((text) => ACCESS_TOKEN_RE.test(text))) return undefined;
  if (u.protocol === 'mailto:') {
    const blocked = Array.from(u.searchParams.keys()).some((key) =>
      MAILTO_BLOCKED_PARAMS.has(key.toLowerCase())
    );
    // An authority (`mailto://host/x`) is no address; `mailto:` alone names nobody.
    if (u.host || u.href.startsWith('mailto://') || !u.pathname.trim() || blocked) return undefined;
  }
  return decodings(u.pathname).some(isMediaPath) ? undefined : u.href;
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
    takeUndelivered(): string | undefined;
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
      return url ? openableHref(url) : undefined;
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
    if (!pending || !isOpenable(url) || !isSignInUrl(url, pending)) {
      return { ok: false, code: 'BAD_ARGUMENTS' };
    }
    return { ok: true, value: await openUrl(new URL(url).href) };
  });
  handle(
    'desktop:take-app-url',
    signInOwners,
    (args) => (args.length === 0 ? true : undefined),
    async () => ({ ok: true, value: authCallback.takeUndelivered() })
  );
};
