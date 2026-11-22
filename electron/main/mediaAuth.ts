import { ipcMain } from 'electron';
import type { DesktopMediaSession as MediaSession } from '../../src/app/lib/desktopBridge';
import { isAllowedHomeserverBaseUrl } from '../../src/app/matrix/cs-api';
import { validMediaRequest } from '../../src/sw/swMediaAuth';
import { APP_ORIGIN, isAllowedAppPage } from './bundleProtocol';
import { isAuthorized, type Result } from './ipc';

export type MediaRequest = {
  id: number;
  url: string;
  method: string;
  authorization: string | undefined;
  fromMainFrameOf: number | undefined;
};

const HTTP_URLS = { urls: ['http://*/*', 'https://*/*'] };
// Only a download may end in a file name.
const MEDIA_ROUTE =
  /^\/_matrix\/client\/v1\/media\/(?:download\/[^/]+\/[^/]+(?:\/[^/]+)?|thumbnail\/[^/]+\/[^/]+)$/;

const isStrictMediaUrl = (url: string, baseUrl: string): boolean => {
  if (!validMediaRequest(url, baseUrl)) return false;
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  const rawPath = url.replace(/^https?:\/\/[^/?#]+/i, '').split(/[?#]/, 1)[0] ?? '';
  if (!rawPath.startsWith(basePath)) return false;
  const suffix = rawPath.slice(basePath.length);
  if (/%(?:2f|5c|2e)/i.test(suffix) || suffix.includes('\\')) return false;
  if (suffix.split('/').some((seg) => seg === '.' || seg === '..')) return false;
  return MEDIA_ROUTE.test(suffix);
};

export const createMediaAuth = () => {
  const sessions = new Map<number, MediaSession>();
  const redirectedIds = new Set<number>();
  const owned = new Map<number, string>();
  return {
    /** Replaces the window's session and returns the one it had. */
    set(windowId: number, session?: MediaSession): MediaSession | undefined {
      const previous = sessions.get(windowId);
      if (session) sessions.set(windowId, session);
      else sessions.delete(windowId);
      return previous;
    },
    authorize(req: MediaRequest): string | undefined {
      if (redirectedIds.has(req.id) || req.authorization !== undefined || req.method !== 'GET')
        return undefined;
      const s = req.fromMainFrameOf === undefined ? undefined : sessions.get(req.fromMainFrameOf);
      if (!s || !isStrictMediaUrl(req.url, s.baseUrl)) return undefined;
      const header = `Bearer ${s.accessToken}`;
      owned.set(req.id, header);
      return header;
    },
    redirected(id: number): void {
      redirectedIds.add(id);
    },
    ownedHeaderToRemove(req: MediaRequest): boolean {
      const added = redirectedIds.has(req.id) ? owned.get(req.id) : undefined;
      return added !== undefined && req.authorization === added;
    },
    done(id: number): void {
      redirectedIds.delete(id);
      owned.delete(id);
    },
  };
};

/** The pushed session, `null` for none (signed out), or `undefined` when the push is malformed. */
const parseSession = (args: unknown[]): MediaSession | null | undefined => {
  if (args.length > 1) return undefined;
  if (args[0] === undefined || args[0] === null) return null;
  if (typeof args[0] !== 'object' || Array.isArray(args[0])) return undefined;
  const { baseUrl, userId, accessToken } = args[0] as Record<string, unknown>;
  if (typeof baseUrl !== 'string' || typeof userId !== 'string' || typeof accessToken !== 'string')
    return undefined;
  if (!accessToken.trim() || /[\r\n]/.test(accessToken) || !isAllowedHomeserverBaseUrl(baseUrl))
    return undefined;
  const { username, password } = new URL(baseUrl);
  return username || password ? undefined : { baseUrl, userId, accessToken };
};

export const installMediaAuth = (
  ses: Electron.Session,
  owners: () => readonly Electron.WebContents[]
): ((windowId: number) => void) => {
  const auth = createMediaAuth();
  // The one synchronous channel (all others go through `handle()`): main must hold the token
  // before the page can send any request after its session store changed.
  ipcMain.on('desktop:set-media-session', (event, ...args) => {
    let result: Result<void> = { ok: false, code: 'FORBIDDEN' };
    const reply = (): void => {
      event.returnValue = result;
    };
    try {
      const owner = owners().find((candidate) => isAuthorized(event, candidate));
      if (!owner) return reply();
      const next = parseSession(args);
      const previous = auth.set(owner.id, next ?? undefined);
      result =
        next === undefined ? { ok: false, code: 'BAD_ARGUMENTS' } : { ok: true, value: undefined };
      // A response cached for the account that left must not be served to a request without its header.
      if (previous && (previous.baseUrl !== next?.baseUrl || previous.userId !== next?.userId))
        return void ses.clearCache().then(reply, reply);
    } catch {
      // Answer what was decided so far; the page must never stay blocked.
    }
    return reply();
  });
  ses.webRequest.onBeforeSendHeaders(HTTP_URLS, (d, cb) => {
    let res: Electron.BeforeSendResponse = {};
    try {
      const h = d.requestHeaders;
      const authKey = Object.keys(h).find((k) => k.toLowerCase() === 'authorization');
      const authorization = authKey !== undefined ? h[authKey] : undefined;
      const baseReq: MediaRequest = {
        id: d.id,
        url: d.url,
        method: d.method,
        authorization,
        fromMainFrameOf: undefined,
      };
      if (auth.ownedHeaderToRemove(baseReq)) {
        const next = { ...h };
        if (authKey !== undefined) delete next[authKey];
        res = { requestHeaders: next };
      } else if (authorization === undefined) {
        const f = d.resourceType === 'subFrame' ? null : d.frame;
        const owner =
          f && f.origin === APP_ORIGIN && isAllowedAppPage(f.url)
            ? owners().find(
                (w) => !w.isDestroyed() && w.id === d.webContentsId && f === w.mainFrame
              )
            : undefined;
        const header = auth.authorize({ ...baseReq, fromMainFrameOf: owner?.id });
        if (header) res = { requestHeaders: { ...h, Authorization: header } };
      }
    } catch {
      res = {};
    }
    cb(res);
  });
  ses.webRequest.onBeforeRedirect(HTTP_URLS, (d) => auth.redirected(d.id));
  ses.webRequest.onCompleted(HTTP_URLS, (d) => auth.done(d.id));
  ses.webRequest.onErrorOccurred(HTTP_URLS, (d) => auth.done(d.id));
  return (windowId) => auth.set(windowId, undefined);
};
