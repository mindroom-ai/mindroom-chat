import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOpenIDToken, MatrixClient } from 'matrix-js-sdk';
import { requestAudienceOpenIdToken } from '../matrix/openidAudience';
import {
  ClientSessions,
  MindroomServerError,
  clientSessions,
  revokeClientSessions,
} from './clientSessions';

const API_URL = 'https://mindroom.example.org';
const NOW = Date.UTC(2026, 10, 7, 9, 30);

const TOKEN = vi.hoisted(
  (): IOpenIDToken => ({
    access_token: 'openid',
    token_type: 'Bearer',
    matrix_server_name: 'example.org',
    expires_in: 3600,
  })
);
vi.mock('../matrix/openidAudience', () => ({
  requestAudienceOpenIdToken: vi.fn(async () => TOKEN),
}));

type Sent = { url: string; init: RequestInit };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** MindRoom servers: client sessions, numbered across servers, and the answers a test sets. */
const fakeServer = () => {
  const sent: Sent[] = [];
  let sessions = 0;
  const route = vi.fn((_url: string, _init: RequestInit): Response => json({}));
  return {
    sent,
    route,
    request: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      sent.push({ url, init });
      if (url.endsWith('/api/client-sessions') && init.method === 'POST') {
        sessions += 1;
        return json({
          session_token: `session-${sessions}`,
          user_id: '@ann:example.org',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      }
      return route(url, init);
    }),
    signIns: () =>
      sent.filter(({ url, init }) => url.endsWith('/api/client-sessions') && init.method === 'POST')
        .length,
    /** Each request after the sign-ins, as `<method> <url> <bearer>`. */
    routes: () =>
      sent
        .filter(
          ({ url, init }) => !(url.endsWith('/api/client-sessions') && init.method === 'POST')
        )
        .map(
          ({ url, init }) =>
            `${init.method ?? 'GET'} ${url} ${new Headers(init.headers).get('Authorization')}`
        ),
  };
};

/** The websockets the page opened; a test opens or closes each as its server would. */
class FakeSocket extends EventTarget {
  static made: FakeSocket[] = [];

  readonly url: string;

  readonly protocols: string[];

  constructor(url: URL, protocols: string[]) {
    super();
    this.url = String(url);
    this.protocols = protocols;
    FakeSocket.made.push(this);
  }

  open() {
    this.dispatchEvent(new Event('open'));
  }

  closeWith(code: number) {
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
}

const pending = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const sessions = (server: ReturnType<typeof fakeServer>, apiUrl = API_URL) =>
  new ClientSessions({ apiUrl, getOpenIdToken: async () => TOKEN, request: server.request });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  FakeSocket.made = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('clientSessions', () => {
  it("is one per account and server, which signs in with a token bound to the server's origin", async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.request);
    const ann = { getSafeUserId: () => '@ann:example.org' } as MatrixClient;
    const bob = { getSafeUserId: () => '@bob:example.org' } as MatrixClient;

    const published = clientSessions(ann, API_URL, true);
    expect(clientSessions(ann, API_URL, true)).toBe(published);
    expect(clientSessions(bob, API_URL, true)).not.toBe(published);
    expect(clientSessions(ann, 'https://other.example.org', true)).not.toBe(published);

    await published.send('/api/plugins');
    await clientSessions(ann, API_URL, true).send('/api/plugins');
    expect(server.signIns()).toBe(1);
    // An origin the room's agents published gets a token only while the homeserver binds it.
    expect(requestAudienceOpenIdToken).toHaveBeenLastCalledWith(ann, API_URL, {
      requireBinding: true,
    });
    await clientSessions(ann, API_URL, false).send('/api/plugins');
    expect(requestAudienceOpenIdToken).toHaveBeenLastCalledWith(ann, API_URL, {
      requireBinding: false,
    });
  });

  it('ends at sign-out each session the account holds, and only those', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.request);
    const ann = { getSafeUserId: () => '@ann:example.org' } as MatrixClient;
    const bob = { getSafeUserId: () => '@bob:example.org' } as MatrixClient;
    await clientSessions(ann, API_URL, true).send('/api/plugins');
    await clientSessions(ann, 'https://other.example.org', false).send('/api/plugins');
    await clientSessions(bob, API_URL, true).send('/api/plugins');
    // A server the account has not signed in to yet has nothing to end.
    clientSessions(ann, 'https://unused.example.org', false);
    server.sent.length = 0;

    await revokeClientSessions(ann);

    expect(server.routes()).toEqual([
      `DELETE ${API_URL}/api/client-sessions Bearer session-1`,
      'DELETE https://other.example.org/api/client-sessions Bearer session-2',
    ]);
    server.sent.forEach(({ init }) => {
      expect(init.keepalive).toBe(true);
      expect(init.credentials).toBe('omit');
    });
    // The next request signs in again.
    server.sent.length = 0;
    await clientSessions(ann, API_URL, true).send('/api/plugins');
    expect(server.signIns()).toBe(1);
  });
});

describe('ClientSessions.revoke', () => {
  it('ends the session once the requests asked to go first were answered, waiting 3 seconds at most', async () => {
    const server = fakeServer();
    const store = sessions(server);
    await store.send('/api/plugins');
    const leave = pending();
    const answered = vi.fn(() => leave.promise);
    store.beforeRevoke(answered);
    const takenBack = vi.fn(async () => undefined);
    store.beforeRevoke(takenBack)();
    server.sent.length = 0;

    const revoked = store.revoke();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.routes()).toEqual([]);
    leave.resolve();
    await revoked;
    expect(server.routes()).toEqual([`DELETE ${API_URL}/api/client-sessions Bearer session-1`]);
    expect(answered).toHaveBeenCalledTimes(1);
    expect(takenBack).not.toHaveBeenCalled();

    // A request that never answers holds sign-out back no longer than 3 seconds.
    const hanging = sessions(server);
    await hanging.send('/api/plugins');
    hanging.beforeRevoke(() => new Promise(() => undefined));
    server.sent.length = 0;
    let done = false;
    void hanging.revoke().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(server.routes()).toEqual([`DELETE ${API_URL}/api/client-sessions Bearer session-2`]);
  });
});

describe('ClientSessions.send', () => {
  it('signs in again after a 401 and sends once more, and answers with a second 401', async () => {
    const server = fakeServer();
    server.route.mockImplementation(() => json({ detail: 'expired' }, 401));
    const store = sessions(server);

    const response = await store.send('/api/plugins/notes/rooms/!room/hello');

    expect(response.status).toBe(401);
    expect(server.routes()).toEqual([
      `GET ${API_URL}/api/plugins/notes/rooms/!room/hello Bearer session-1`,
      `GET ${API_URL}/api/plugins/notes/rooms/!room/hello Bearer session-2`,
    ]);
  });

  it('asks for JSON with no cookies, unless the caller asks for something else', async () => {
    const server = fakeServer();
    const store = sessions(server);

    await store.send('/api/plugins/notes/a');
    await store.send('/api/plugins/notes/b', {
      method: 'POST',
      headers: { Accept: 'text/plain', 'Content-Type': 'text/plain' },
      body: 'note',
    });

    const [, first, second] = server.sent;
    expect(new Headers(first?.init.headers).get('Accept')).toBe('application/json');
    expect(new Headers(second?.init.headers).get('Accept')).toBe('text/plain');
    expect(new Headers(second?.init.headers).get('Content-Type')).toBe('text/plain');
    expect(second?.init).toMatchObject({ body: 'note', credentials: 'omit', cache: 'no-store' });
  });

  it('sends nothing to a path that leads to another origin', async () => {
    const server = fakeServer();
    const store = sessions(server);

    await expect(store.send('//evil.example.org/steal')).rejects.toThrow(TypeError);
    await expect(store.send('https://evil.example.org/steal')).rejects.toThrow(TypeError);
    await expect(store.openSocket('wss://evil.example.org/steal')).rejects.toThrow(TypeError);

    expect(server.sent).toEqual([]);
    expect(FakeSocket.made).toEqual([]);
  });

  it('rejects with status 0 when the sign-in answers without a session', async () => {
    const server = fakeServer();
    server.request.mockImplementationOnce(async () => json({ user_id: '@ann:example.org' }));

    await expect(sessions(server).send('/api/plugins')).rejects.toMatchObject({ status: 0 });
    expect(server.routes()).toEqual([]);
  });

  it('rejects with the refused sign-in, its status and body', async () => {
    const server = fakeServer();
    server.request.mockImplementationOnce(async () =>
      json({ detail: 'Client sessions need a homeserver that binds OpenID tokens.' }, 403)
    );

    const error = await sessions(server)
      .send('/api/plugins')
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MindroomServerError);
    expect(error).toMatchObject({
      status: 403,
      body: { detail: 'Client sessions need a homeserver that binds OpenID tokens.' },
    });
  });
});

describe('ClientSessions.openSocket', () => {
  it('opens a websocket to the path that offers the session as both subprotocols', async () => {
    const server = fakeServer();

    const socket = await sessions(server).openSocket('/api/plugins/notes/rooms/!room/echo?x=1');
    await sessions(server, 'http://127.0.0.1:8765').openSocket('/api/plugins/notes/live');

    expect(socket).toBe(FakeSocket.made[0]);
    expect(FakeSocket.made.map(({ url, protocols }) => ({ url, protocols }))).toEqual([
      {
        url: 'wss://mindroom.example.org/api/plugins/notes/rooms/!room/echo?x=1',
        protocols: ['mindroom-session', 'mindroom-session.session-1'],
      },
      {
        url: 'ws://127.0.0.1:8765/api/plugins/notes/live',
        protocols: ['mindroom-session', 'mindroom-session.session-2'],
      },
    ]);
  });

  it('signs in again for the next socket once the server ended the session (4401)', async () => {
    const server = fakeServer();
    const store = sessions(server);
    const first = (await store.openSocket('/api/plugins/notes/live')) as unknown as FakeSocket;
    first.open();
    first.closeWith(1012);
    await store.openSocket('/api/plugins/notes/live');
    expect(server.signIns()).toBe(1);

    FakeSocket.made[1]?.open();
    FakeSocket.made[1]?.closeWith(4401);
    await store.openSocket('/api/plugins/notes/live');

    expect(server.signIns()).toBe(2);
    expect(FakeSocket.made[2]?.protocols).toEqual([
      'mindroom-session',
      'mindroom-session.session-2',
    ]);
    expect(server.routes()).toEqual([]);
  });

  it('asks whether the session lives after a socket that closed before it opened, and keeps a live one', async () => {
    const server = fakeServer();
    server.route.mockImplementation(() => json({ plugin_api_version: '1.8', plugins: [] }));
    const store = sessions(server);
    const refused = (await store.openSocket('/api/plugins/notes/live')) as unknown as FakeSocket;
    // A refused origin or membership looks the same as an ended session.
    refused.closeWith(1006);

    await store.openSocket('/api/plugins/notes/live');

    expect(server.routes()).toEqual([`GET ${API_URL}/api/plugins Bearer session-1`]);
    expect(server.signIns()).toBe(1);
    expect(FakeSocket.made[1]?.protocols).toEqual([
      'mindroom-session',
      'mindroom-session.session-1',
    ]);
  });

  it('signs in again when the check after a socket that never opened says the session ended', async () => {
    const server = fakeServer();
    server.route.mockImplementationOnce(() => json({ detail: 'expired' }, 401));
    const store = sessions(server);
    ((await store.openSocket('/api/plugins/notes/live')) as unknown as FakeSocket).closeWith(1006);

    await store.openSocket('/api/plugins/notes/live');

    expect(server.signIns()).toBe(2);
    expect(FakeSocket.made[1]?.protocols).toEqual([
      'mindroom-session',
      'mindroom-session.session-2',
    ]);
  });
});
