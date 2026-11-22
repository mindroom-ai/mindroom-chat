import { isAllowedHomeserverBaseUrl } from '../../src/app/matrix/cs-api';
import { validMediaRequest } from '../../src/sw/swMediaAuth';
import { APP_ORIGIN, isAllowedAppPage } from './bundleProtocol';
import { handle } from './ipc';

export type MediaSession = { baseUrl: string; accessToken: string };
export type MediaRequest = {
  id: number;
  url: string;
  method: string;
  authorization: string | undefined;
  fromMainFrameOf: number | undefined;
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
      if (redirectedIds.has(req.id) || req.authorization !== undefined || req.method !== 'GET')
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
      const added = redirectedIds.has(req.id) ? owned.get(req.id) : undefined;
      return added !== undefined && req.authorization === added;
    },
    done(id: number): void {
      redirectedIds.delete(id);
      owned.delete(id);
    },
  };
};

type ParsedSession = { valid: true; session: MediaSession | null } | { valid: false };

const parseSession = (args: unknown[]): ParsedSession => {
  if (args.length > 1) return { valid: false };
  if (args[0] === undefined || args[0] === null) return { valid: true, session: null };
  if (typeof args[0] !== 'object' || Array.isArray(args[0])) return { valid: false };
  const { baseUrl, accessToken } = args[0] as Record<string, unknown>;
  if (typeof baseUrl !== 'string' || typeof accessToken !== 'string') return { valid: false };
  if (!accessToken.trim() || /[\r\n]/.test(accessToken) || !isAllowedHomeserverBaseUrl(baseUrl))
    return { valid: false };
  const { username, password } = new URL(baseUrl);
  return username || password
    ? { valid: false }
    : { valid: true, session: { baseUrl, accessToken } };
};

export const installMediaAuth = (
  ses: Electron.Session,
  owners: () => readonly Electron.WebContents[]
): ((windowId: number) => void) => {
  const auth = createMediaAuth();
  handle('desktop:set-media-session', owners, parseSession, async (parsed, sender) => {
    if (!parsed.valid) {
      auth.set(sender.id, undefined);
      return { ok: false, code: 'BAD_ARGUMENTS' };
    }
    auth.set(sender.id, parsed.session ?? undefined);
    return { ok: true, value: undefined };
  });
  ses.webRequest.onBeforeSendHeaders(HTTP_URLS, (d, cb) => {
    let res: Electron.BeforeSendResponse = {};
    try {
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
        authorization: authKey !== undefined ? h[authKey] : undefined,
        fromMainFrameOf: owner?.id,
      };
      if (auth.ownedHeaderToRemove(req)) {
        const next = { ...h };
        if (authKey !== undefined) delete next[authKey];
        res = { requestHeaders: next };
      } else {
        const header = auth.authorize(req);
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
