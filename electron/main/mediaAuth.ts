import { isAllowedHomeserverBaseUrl } from '../../src/app/matrix/cs-api';
import { validMediaRequest } from '../../src/sw/swMediaAuth';
import { APP_ORIGIN, isAllowedAppPage } from './bundleProtocol';
import { handle } from './ipc';

export type MediaSession = { baseUrl: string; accessToken: string };
export type MediaRequest = {
  id: number;
  url: string;
  method: string;
  hasAuthorization: boolean;
  fromMainFrameOf: number | undefined;
  authorization?: string;
};

const HTTP_URLS = { urls: ['http://*/*', 'https://*/*'] };

export const createMediaAuth = () => {
  const sessions = new Map<number, MediaSession>();
  const redirectedIds = new Set<number>();
  const owned = new Map<number, string>();
  return {
    set(windowId: number, session?: MediaSession): void {
      if (session) sessions.set(windowId, session);
      else sessions.delete(windowId);
    },
    authorize(req: MediaRequest): string | undefined {
      if (redirectedIds.has(req.id) || req.hasAuthorization || req.method !== 'GET')
        return undefined;
      const s = req.fromMainFrameOf === undefined ? undefined : sessions.get(req.fromMainFrameOf);
      if (!s || !validMediaRequest(req.url, s.baseUrl)) return undefined;
      const header = `Bearer ${s.accessToken}`;
      owned.set(req.id, header);
      return header;
    },
    redirected(id: number): void {
      redirectedIds.add(id);
    },
    ownedHeaderToRemove(req: MediaRequest): boolean {
      const added =
        redirectedIds.has(req.id) && req.hasAuthorization ? owned.get(req.id) : undefined;
      return (
        added !== undefined && (req.authorization === undefined || req.authorization === added)
      );
    },
    done(id: number): void {
      redirectedIds.delete(id);
      owned.delete(id);
    },
  };
};

const parseSession = (args: unknown[]): MediaSession | null | undefined => {
  if (args.length > 1) return undefined;
  if (args[0] === undefined || args[0] === null) return null;
  if (typeof args[0] !== 'object' || Array.isArray(args[0])) return undefined;
  const { baseUrl, accessToken } = args[0] as Record<string, unknown>;
  if (typeof baseUrl !== 'string' || typeof accessToken !== 'string') return undefined;
  if (!accessToken.trim() || /[\r\n]/.test(accessToken) || !isAllowedHomeserverBaseUrl(baseUrl))
    return undefined;
  const { username, password } = new URL(baseUrl);
  return username || password ? undefined : { baseUrl, accessToken };
};

export const installMediaAuth = (
  ses: Electron.Session,
  owners: () => readonly Electron.WebContents[]
): void => {
  const auth = createMediaAuth();
  const watched = new WeakSet<Electron.WebContents>();
  handle('desktop:set-media-session', owners, parseSession, async (next, sender) => {
    if (!watched.has(sender)) {
      watched.add(sender);
      const forget = () => auth.set(sender.id, undefined);
      sender.once('destroyed', forget);
      sender.on('render-process-gone', forget);
    }
    auth.set(sender.id, next ?? undefined);
    return { ok: true, value: undefined };
  });
  ses.webRequest.onBeforeSendHeaders(HTTP_URLS, (d, cb) => {
    const h = d.requestHeaders;
    const authKey = Object.keys(h).find((k) => k.toLowerCase() === 'authorization');
    const f = d.resourceType === 'subFrame' ? null : d.frame;
    const owner =
      f && f.origin === APP_ORIGIN && isAllowedAppPage(f.url)
        ? owners().find((w) => !w.isDestroyed() && w.id === d.webContentsId && f === w.mainFrame)
        : undefined;
    const req: MediaRequest = {
      id: d.id,
      url: d.url,
      method: d.method,
      hasAuthorization: authKey !== undefined,
      fromMainFrameOf: owner?.id,
      authorization: authKey !== undefined ? h[authKey] : undefined,
    };
    if (auth.ownedHeaderToRemove(req)) {
      const next = { ...h };
      if (authKey !== undefined) delete next[authKey];
      cb({ requestHeaders: next });
      return;
    }
    const header = auth.authorize(req);
    cb(header ? { requestHeaders: { ...h, Authorization: header } } : {});
  });
  ses.webRequest.onBeforeRedirect(HTTP_URLS, (d) => auth.redirected(d.id));
  ses.webRequest.onCompleted(HTTP_URLS, (d) => auth.done(d.id));
  ses.webRequest.onErrorOccurred(HTTP_URLS, (d) => auth.done(d.id));
};
