import { ConnectionError, HTTPError, type IOpenIDToken, type MatrixClient } from 'matrix-js-sdk';
import { requestAudienceOpenIdToken } from '../matrix/openidAudience';

const SESSIONS_PATH = '/api/client-sessions';
/** A session is renewed this long before the server lets it run out. */
const SESSION_RENEW_MARGIN_MS = 60_000;
/** Signing in (the token and the exchange) gives up after this long; the next request tries again. */
const SIGN_IN_TIMEOUT_MS = 15_000;
/** Sign-out waits this long at most for what must reach the server before it ends the session. */
const LAST_REQUESTS_WAIT_MS = 3_000;
/** A websocket offers this subprotocol, and this one followed by `.<session token>`. */
const SESSION_PROTOCOL = 'mindroom-session';
/** A websocket closes with this code once its session ends. */
const SESSION_ENDED = 4401;

/**
 * A request to a MindRoom server that it refused (`status`, with its parsed `body`), or that got no
 * answer (status 0).
 */
export class MindroomServerError extends Error {
  readonly status: number;

  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'MindroomServerError';
    this.status = status;
    this.body = body;
  }
}

const noAnswer = (message: string) => new MindroomServerError(message, 0);
const cancelled = () => noAnswer('MindRoom request cancelled.');

/** Rejects as soon as `signal` aborts, for steps that cannot be cancelled themselves. */
export const untilAborted = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
};

/**
 * A homeserver that could not be asked, or failed (also with a proxy's page that is not JSON), may
 * answer later. One that refused for good, such as one that does not bind tokens to their audience,
 * never lets MindRoom sign this person in.
 */
export const tokenError = (error: unknown): MindroomServerError => {
  if (error instanceof MindroomServerError) return error;
  if (error instanceof ConnectionError || error instanceof HTTPError)
    return noAnswer('The homeserver could not give a sign-in token.');
  return new MindroomServerError('The homeserver will not sign in to MindRoom.', 403);
};

type ClientSession = { token: string; expiresAt: number };

/** `init`'s headers with the session as bearer, asking for JSON unless they ask for other. */
const bearer = (init: RequestInit, session: ClientSession): Headers => {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${session.token}`);
  return headers;
};

type ClientSessionsOptions = {
  /** The MindRoom server's origin. */
  apiUrl: string;
  /** A Matrix OpenID token bound to `apiUrl`. */
  getOpenIdToken: () => Promise<IOpenIDToken>;
  request?: typeof fetch;
};

/**
 * The signed-in person's client session with one MindRoom server (`POST /api/client-sessions`, for
 * a Matrix OpenID token), which its client routes and plugin routes take as bearer; no cookies go
 * with any request. MindRoom keeps a session for an hour, in memory, and eight per user.
 */
export class ClientSessions {
  readonly apiUrl: string;

  private readonly getOpenIdToken: () => Promise<IOpenIDToken>;

  private readonly request: typeof fetch;

  private session?: ClientSession;

  private signingIn?: Promise<ClientSession>;

  /** The session a websocket offered and that closed before it opened, which may have ended. */
  private unverified?: ClientSession;

  /** What must reach the server with the session before sign-out ends it, such as a call's leave. */
  private readonly lastRequests = new Set<() => Promise<unknown>>();

  /** The sessions it signed in for that the server may still accept, all of which sign-out ends. */
  private readonly issued = new Set<ClientSession>();

  /** Sign-out ended its sessions: it signs in no more, and ends one a sign-in still brings. */
  private revoked = false;

  constructor({ apiUrl, getOpenIdToken, request }: ClientSessionsOptions) {
    this.apiUrl = apiUrl;
    this.getOpenIdToken = getOpenIdToken;
    this.request = request ?? ((input, init) => fetch(input, init));
  }

  /** `path` on this server; one that leads to another origin throws, so the session never leaves. */
  private url(path: string): URL {
    const url = new URL(path, this.apiUrl);
    if (url.origin !== this.apiUrl) {
      throw new TypeError(`${path} is not on the MindRoom server ${this.apiUrl}.`);
    }
    return url;
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.request(url, { ...init, credentials: 'omit', cache: 'no-store' });
    } catch {
      throw noAnswer('MindRoom could not be reached.');
    }
  }

  private async signIn(): Promise<ClientSession> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), SIGN_IN_TIMEOUT_MS);
    try {
      return await this.exchange(timeout.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async exchange(signal: AbortSignal): Promise<ClientSession> {
    const openIdToken = await untilAborted(this.getOpenIdToken(), signal).catch(
      (error: unknown) => {
        throw tokenError(error);
      }
    );
    const response = await this.fetch(`${this.apiUrl}${SESSIONS_PATH}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ openid_token: openIdToken }),
      signal,
    });
    const body = (await response.json().catch(() => undefined)) as
      | { session_token?: unknown; expires_at?: unknown }
      | undefined;
    if (!response.ok) {
      throw new MindroomServerError(
        `MindRoom refused the sign-in (${response.status}).`,
        response.status,
        body
      );
    }
    if (typeof body?.session_token !== 'string' || typeof body.expires_at !== 'number') {
      throw noAnswer('MindRoom answered the sign-in without a session.');
    }
    return { token: body.session_token, expiresAt: body.expires_at * 1000 };
  }

  /**
   * The session to send, signing in when there is none or it is about to run out. Requests at the
   * same time share one sign-in; a failed one is not kept, so the next request signs in again.
   */
  private currentSession(signal?: AbortSignal): Promise<ClientSession> {
    if (this.revoked) return Promise.reject(noAnswer('Signed out of MindRoom.'));
    if (this.session && this.session.expiresAt - SESSION_RENEW_MARGIN_MS > Date.now()) {
      return Promise.resolve(this.session);
    }
    // Before a sign-in starts that no one would wait for.
    if (signal?.aborted) return Promise.reject(cancelled());
    this.session = undefined;
    if (!this.signingIn) {
      this.signingIn = this.signIn()
        .then((session) => {
          if (this.revoked) {
            void this.sendNow(SESSIONS_PATH, { method: 'DELETE' }, session);
            throw noAnswer('Signed out of MindRoom.');
          }
          this.issued.forEach((old) => {
            if (old.expiresAt <= Date.now()) this.issued.delete(old);
          });
          this.issued.add(session);
          this.session = session;
          return session;
        })
        .finally(() => {
          this.signingIn = undefined;
        });
    }
    return untilAborted(this.signingIn, signal);
  }

  /**
   * Sends `path`, such as `/api/plugins`, with the session as bearer and resolves with the answer.
   * A refused session signs in again and sends once more. Rejects with `MindroomServerError` when
   * there is no answer or the sign-in fails, and with a `TypeError` before sending anything when
   * `path` leads to another origin.
   */
  async send(path: string, init: RequestInit = {}): Promise<Response> {
    const url = this.url(path).href;
    for (let attempt = 0; ; attempt += 1) {
      const session = await this.currentSession(init.signal ?? undefined);
      const response = await this.fetch(url, { ...init, headers: bearer(init, session) });
      if (response.status !== 401 || attempt > 0) return response;
      this.forget(session);
    }
  }

  /** Drops a session the server refused or ended, so the next request signs in again. */
  private forget(session: ClientSession): void {
    this.issued.delete(session);
    if (this.session === session) this.session = undefined;
  }

  /**
   * The session's token, for a request `send` cannot make, signing in when there is none or it is
   * about to run out. `refused`: a token the server answered 401, which is dropped first if still
   * held, so a new sign-in replaces it. Rejects as `send` does when the sign-in fails.
   */
  async token({
    signal,
    refused,
  }: { signal?: AbortSignal; refused?: string } = {}): Promise<string> {
    if (this.session && this.session.token === refused) this.forget(this.session);
    return (await this.currentSession(signal)).token;
  }

  /**
   * Sends `path` at once with the session already held (or `session`), for a page that goes away:
   * the request outlives the page, and its failure is ignored. Without a session, or once it has
   * run out, nothing is sent, as there is no time to sign in.
   */
  sendNow(path: string, init: RequestInit, session = this.session): Promise<void> {
    if (!session || session.expiresAt <= Date.now()) return Promise.resolve();
    const headers = bearer(init, session);
    return this.fetch(this.url(path).href, { ...init, keepalive: true, headers }).then(
      () => undefined,
      () => undefined
    );
  }

  /**
   * Has sign-out run `send` before it ends the session, which `send` then still has; the function
   * returned takes it back.
   */
  beforeRevoke(send: () => Promise<unknown>): () => void {
    this.lastRequests.add(send);
    return () => {
      this.lastRequests.delete(send);
    };
  }

  /**
   * Ends every session it signed in for that may still be live, as at sign-out, once what
   * `beforeRevoke` asked for and a sign-in on its way were answered (3 seconds at most): the server
   * refuses their tokens from then on.
   */
  async revoke(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      // A sign-in on its way gives the session to end.
      Promise.allSettled([this.signingIn, ...[...this.lastRequests].map(async (send) => send())]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, LAST_REQUESTS_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
    this.revoked = true;
    this.issued.forEach((session) => {
      void this.sendNow(SESSIONS_PATH, { method: 'DELETE' }, session);
    });
    this.issued.clear();
    this.session = undefined;
  }

  /**
   * Opens a websocket to `path` (`wss:` or `ws:`) that offers the session as MindRoom's plugin
   * websockets take it. Once the server ends the session (close code 4401) the next request signs
   * in again. A refused handshake reaches the browser only as a socket that closes before it
   * opens, also for a session that ended, so the next socket asks `GET /api/plugins` first, which
   * signs in again only on a 401: a refused origin or membership never ends the user's other
   * sessions through repeated sign-ins.
   */
  async openSocket(path: string): Promise<WebSocket> {
    const url = this.url(path);
    if (this.session && this.session === this.unverified) {
      this.unverified = undefined;
      await this.send('/api/plugins').catch(() => undefined);
    }
    const session = await this.currentSession();
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, [SESSION_PROTOCOL, `${SESSION_PROTOCOL}.${session.token}`]);
    let opened = false;
    socket.addEventListener('open', () => {
      opened = true;
    });
    socket.addEventListener('close', ({ code }) => {
      if (code === SESSION_ENDED) this.forget(session);
      else if (!opened && this.session === session) this.unverified = session;
    });
    return socket;
  }
}

/** Each account's sessions, one per server URL and whether the room's agents published it. */
const shared = new WeakMap<MatrixClient, Map<string, ClientSessions>>();

/**
 * The account's client session with the MindRoom server at `apiUrl`, shared by every caller that
 * passes the same `apiUrl` and `discovered`.
 * `discovered`: an origin the room's agents published, whose tokens only a homeserver that binds
 * them may give.
 */
export const clientSessions = (
  mx: MatrixClient,
  apiUrl: string,
  discovered: boolean
): ClientSessions => {
  const servers = shared.get(mx) ?? new Map<string, ClientSessions>();
  shared.set(mx, servers);
  const key = `${discovered ? 'discovered' : 'configured'} ${apiUrl}`;
  const sessions =
    servers.get(key) ??
    new ClientSessions({
      apiUrl,
      getOpenIdToken: () => requestAudienceOpenIdToken(mx, apiUrl, { requireBinding: discovered }),
    });
  servers.set(key, sessions);
  return sessions;
};

/** Ends every client session the account holds, as at sign-out. */
export const revokeClientSessions = async (mx: MatrixClient): Promise<void> => {
  await Promise.all([...(shared.get(mx)?.values() ?? [])].map((sessions) => sessions.revoke()));
};
