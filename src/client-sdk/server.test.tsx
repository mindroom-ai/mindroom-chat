// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { ConnectionError, type IOpenIDToken, type MatrixClient, type Room } from 'matrix-js-sdk';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptionClient } from '../app/calls/transcription/api';
import type { AgentServer } from '../app/computer/agentServer';
import { clientSessions } from '../app/computer/clientSessions';
import { ClientConfigProvider } from '../app/config/useClientConfig';
import { MatrixClientProvider } from '../app/matrix/hooks/useMatrixClient';
import {
  ComputerApiError,
  MindroomServerError,
  useMindroomServer,
  useMindroomServerStatus,
  useRoomComputers,
  type MindroomServer,
  type RoomComputer,
} from './server';

const ROOM_ID = '!room:example.org';
const PUBLISHED = 'https://published.example.org';
const DEPLOYMENT = 'https://deployment.example.org';
const AGENT = { userId: '@mindroom_router:example.org', membership: 'join' };

const state = vi.hoisted(() => ({
  // Undefined asks the homeserver, which gives `binding`'s answer, as the app does.
  bindsTokens: true as boolean | undefined,
  binding: Promise.resolve(true as boolean | undefined),
  published: undefined as string | undefined,
  // The servers the room's agents published, in full, where a test needs more than `published`.
  servers: undefined as AgentServer[] | undefined,
  members: [] as { userId: string; membership: string; name?: string }[],
}));
vi.mock('../app/computer/useAgentServers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../app/computer/useAgentServers')>();
  const useOpenIdBinding = () => state.bindsTokens ?? actual.useOpenIdBinding();
  return {
    useOpenIdBinding,
    useBindsOpenIdTokens: () => useOpenIdBinding() === true,
    useRoomAgentServers: () =>
      state.servers ?? (state.published ? [{ apiUrl: state.published }] : []),
  };
});
vi.mock('../app/matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
const OPENID_TOKEN: IOpenIDToken = {
  access_token: 'openid',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};
const openId = vi.hoisted(() => ({ requestToken: vi.fn() }));
vi.mock('../app/matrix/openidAudience', () => ({
  readOpenIdBinding: () => state.binding,
  requestAudienceOpenIdToken: openId.requestToken,
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The servers' answers: client sessions, numbered, and what `route` answers for the rest. */
const fakeFetch = () => {
  const sent: { url: string; init: RequestInit }[] = [];
  let sessions = 0;
  const isSignIn = (url: string) => url.endsWith('/api/client-sessions');
  const route = vi.fn((_url: string): Response => json({}));
  const request = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    sent.push({ url, init });
    if (isSignIn(url)) {
      sessions += 1;
      return json({ session_token: `session-${sessions}`, expires_at: Date.now() / 1000 + 3600 });
    }
    return route(url);
  });
  vi.stubGlobal('fetch', request);
  const toRoutes = () => sent.filter(({ url }) => !isSignIn(url));
  return {
    route,
    request,
    signIns: () => sessions,
    /** The origin of each sign-in. */
    signInOrigins: () =>
      sent.filter(({ url }) => isSignIn(url)).map(({ url }) => new URL(url).origin),
    routes: () => toRoutes().map(({ url }) => url),
    /** The bearer each request after the sign-ins carried. */
    bearers: () => toRoutes().map(({ init }) => new Headers(init.headers).get('Authorization')),
    last: () => sent.at(-1),
  };
};

let mx: MatrixClient;

const signedIn = (deploymentUrl?: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MatrixClientProvider value={mx}>
        <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
          {children}
        </ClientConfigProvider>
      </MatrixClientProvider>
    );
  };

/** What `useMindroomServer(roomId)` gives, signed in to `mx`, with `deploymentUrl` in config.json. */
const server = (deploymentUrl?: string) =>
  renderHook(() => useMindroomServer(ROOM_ID), { wrapper: signedIn(deploymentUrl) }).result.current;

/** The homeserver's answer on binding tokens, which the test gives. */
const bindingAnswer = () => {
  let answer: (binds: boolean | undefined) => void = () => undefined;
  state.bindsTokens = undefined;
  state.binding = new Promise((resolve) => {
    answer = resolve;
  });
  return (binds: boolean | undefined) => act(async () => answer(binds));
};

const published = (): MindroomServer => {
  state.published = PUBLISHED;
  const found = server(DEPLOYMENT);
  if (!found) throw new Error('no server');
  return found;
};

beforeEach(() => {
  // Each test signs in afresh: sessions are kept per account.
  mx = { getRoom: () => null, getSafeUserId: () => '@ann:example.org' } as unknown as MatrixClient;
  state.bindsTokens = true;
  state.published = undefined;
  state.servers = undefined;
  state.members = [AGENT];
  openId.requestToken.mockReset();
  openId.requestToken.mockResolvedValue(OPENID_TOKEN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useMindroomServer', () => {
  it("is the room's published server while the homeserver binds tokens, else the deployment's", () => {
    expect(published().origin).toBe(PUBLISHED);
    state.bindsTokens = false;
    expect(server(DEPLOYMENT)?.origin).toBe(DEPLOYMENT);
    state.published = undefined;
    expect(server(DEPLOYMENT)?.origin).toBe(DEPLOYMENT);
  });

  it('is none without either, or in a room without a MindRoom agent', () => {
    expect(server()).toBeUndefined();
    state.published = PUBLISHED;
    state.members = [{ userId: '@bob:example.org', membership: 'join' }];
    expect(server(DEPLOYMENT)).toBeUndefined();
  });

  // A plugin that signs in at once spends a session at the configured server.
  it('is the configured server until the homeserver answers on binding tokens, then the published one', async () => {
    const answers = fakeFetch();
    const answer = bindingAnswer();
    state.published = PUBLISHED;
    const seen: (string | undefined)[] = [];
    renderHook(
      () => {
        const found = useMindroomServer(ROOM_ID);
        seen.push(found?.origin);
        useEffect(() => {
          found?.request('/api/plugins/notes/hello').catch(() => undefined);
        }, [found]);
      },
      { wrapper: signedIn(DEPLOYMENT) }
    );

    await answer(true);

    expect(seen[0]).toBe(DEPLOYMENT);
    expect(seen.at(-1)).toBe(PUBLISHED);
    await vi.waitFor(() => expect(answers.signInOrigins()).toEqual([DEPLOYMENT, PUBLISHED]));
  });

  it('shares one sign-in between every plugin and call transcripts', async () => {
    const answers = fakeFetch();

    await Promise.all([
      published().request('/api/plugins/notes/rooms/x/hello'),
      published().request('/api/plugins/tasks/rooms/x/list'),
      new TranscriptionClient(clientSessions(mx, PUBLISHED, true)).live(ROOM_ID),
    ]);

    expect(answers.signIns()).toBe(1);
    expect(answers.routes()).toHaveLength(3);
  });
});

describe('useMindroomServerStatus', () => {
  /**
   * Each status the hook gives, from a plugin that requests as soon as it has a server, and a
   * switch of that plugin to another room.
   */
  const statuses = (deploymentUrl?: string) => {
    const seen: { origin?: string; pending: boolean }[] = [];
    const { rerender } = renderHook(
      ({ roomId }) => {
        const { server: found, pending } = useMindroomServerStatus(roomId);
        seen.push({ origin: found?.origin, pending });
        useEffect(() => {
          found?.request('/api/plugins/notes/hello').catch(() => undefined);
        }, [found]);
      },
      { wrapper: signedIn(deploymentUrl), initialProps: { roomId: ROOM_ID } }
    );
    return { seen, showRoom: (roomId: string) => rerender({ roomId }) };
  };

  const rooms = new Map<string, Pick<Room, 'membersLoaded' | 'loadMembersIfNeeded'>>();
  beforeEach(() => rooms.clear());

  /** Makes `roomId` a room whose member list, lazy-loaded, is still out until the test settles it. */
  const loadingMembers = (roomId = ROOM_ID) => {
    let settle: (loaded: boolean) => void = () => undefined;
    const load = new Promise<boolean>((resolve, reject) => {
      settle = (loaded) => (loaded ? resolve(true) : reject(new Error('offline')));
    });
    let loaded = false;
    rooms.set(roomId, { membersLoaded: () => loaded, loadMembersIfNeeded: () => load });
    mx.getRoom = (id: string) => (rooms.get(id) ?? null) as ReturnType<MatrixClient['getRoom']>;
    return (ok: boolean) =>
      act(async () => {
        loaded = ok;
        settle(ok);
        await load.catch(() => undefined);
      });
  };

  it.each([
    ['loaded', true, PUBLISHED],
    ['failed to load, as the members the client has', false, undefined],
  ])(
    "is pending, with no server, until the room's member list has %s",
    async (_name, loads, origin) => {
      fakeFetch();
      state.published = PUBLISHED;
      // Before the list, the client knows no agent in the room.
      state.members = [];
      const settle = loadingMembers();
      const { seen } = statuses(DEPLOYMENT);
      expect(seen.at(-1)).toEqual({ origin: undefined, pending: true });

      if (loads) state.members = [AGENT];
      await settle(loads);

      expect(seen.at(-1)).toEqual({ origin, pending: false });
      expect(seen.filter(({ origin: shown }) => shown)).toHaveLength(origin ? 1 : 0);
    }
  );

  it('is pending again, with no server, on a switch to a room whose member list is still out', async () => {
    fakeFetch();
    state.published = PUBLISHED;
    const settleFirst = loadingMembers(ROOM_ID);
    const settleOther = loadingMembers('!other:example.org');
    const { seen, showRoom } = statuses(DEPLOYMENT);
    await settleFirst(true);
    expect(seen.at(-1)).toEqual({ origin: PUBLISHED, pending: false });

    showRoom('!other:example.org');
    expect(seen.at(-1)).toEqual({ origin: undefined, pending: true });
    await settleOther(true);
    expect(seen.at(-1)).toEqual({ origin: PUBLISHED, pending: false });
  });

  it('is pending, with no server, until the homeserver answers on binding tokens, then signs in at the published server only', async () => {
    const answers = fakeFetch();
    const answer = bindingAnswer();
    state.published = PUBLISHED;
    const { seen } = statuses(DEPLOYMENT);
    expect(seen).toEqual([{ origin: undefined, pending: true }]);

    await answer(true);

    expect(seen.at(-1)).toEqual({ origin: PUBLISHED, pending: false });
    expect(seen.filter(({ origin }) => origin)).toHaveLength(1);
    await vi.waitFor(() => expect(answers.routes()).toHaveLength(1));
    expect(answers.signInOrigins()).toEqual([PUBLISHED]);
  });

  it("counts a binding check that could not reach the homeserver as an answer: the deployment's server", async () => {
    fakeFetch();
    const answer = bindingAnswer();
    state.published = PUBLISHED;
    const { seen } = statuses(DEPLOYMENT);

    await answer(undefined);

    expect(seen.at(-1)).toEqual({ origin: DEPLOYMENT, pending: false });
  });

  it.each([
    ['without either server', [AGENT], undefined, undefined],
    [
      'without an agent',
      [{ userId: '@bob:example.org', membership: 'join' }],
      PUBLISHED,
      DEPLOYMENT,
    ],
  ])(
    'is no server, and not pending, once both are in, %s',
    async (_name, members, publishedUrl, deploymentUrl) => {
      const answer = bindingAnswer();
      state.members = members;
      state.published = publishedUrl;
      const { seen } = statuses(deploymentUrl);
      expect(seen.at(-1)).toEqual({ origin: undefined, pending: true });

      await answer(true);

      expect(seen.at(-1)).toEqual({ origin: undefined, pending: false });
    }
  );
});

describe('MindroomServer.request', () => {
  it("resolves with the answer's JSON, or undefined for an empty answer", async () => {
    const answers = fakeFetch();
    answers.route
      .mockImplementationOnce(() => json({ hello: '@ann:example.org' }))
      .mockImplementationOnce(() => new Response(null, { status: 204 }));
    const { request } = published();

    await expect(request('/api/plugins/notes/rooms/x/hello')).resolves.toEqual({
      hello: '@ann:example.org',
    });
    await expect(request('/api/plugins/notes/rooms/x/hello', { method: 'DELETE' })).resolves.toBe(
      undefined
    );
    expect(answers.routes()).toEqual([
      `${PUBLISHED}/api/plugins/notes/rooms/x/hello`,
      `${PUBLISHED}/api/plugins/notes/rooms/x/hello`,
    ]);
  });

  it('rejects with the status and body after the sign-in it tried again was refused too', async () => {
    const answers = fakeFetch();
    answers.route.mockImplementation(() =>
      json({ detail: 'Missing, invalid or expired client session.' }, 401)
    );

    const error = await published()
      .request('/api/plugins/notes/rooms/x/hello')
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MindroomServerError);
    expect(error).toMatchObject({
      status: 401,
      body: { detail: 'Missing, invalid or expired client session.' },
    });
    expect(answers.signIns()).toBe(2);
  });

  it('rejects with status 0 without an answer or for one that is not JSON', async () => {
    const answers = fakeFetch();
    answers.route
      .mockImplementationOnce(() => {
        throw new TypeError('Failed to fetch');
      })
      .mockImplementationOnce(() => new Response('<html>', { status: 200 }));
    const { request } = published();

    await expect(request('/api/plugins/notes/a')).rejects.toMatchObject({ status: 0 });
    await expect(request('/api/plugins/notes/b')).rejects.toMatchObject({ status: 0 });
  });

  it('sends nothing to a path that leads to another origin', async () => {
    const answers = fakeFetch();

    await expect(published().request('https://evil.example.org/steal')).rejects.toThrow(TypeError);

    expect(answers.request).not.toHaveBeenCalled();
  });
});

describe('MindroomServer.send', () => {
  it('resolves with the answer whatever its type or status, sent with the session and no cookies', async () => {
    const answers = fakeFetch();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    answers.route
      .mockImplementationOnce(
        () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } })
      )
      .mockImplementationOnce(() => new Response('<html>', { status: 404 }));
    const { send } = published();

    const image = await send('/api/plugins/notes/rooms/x/mark.png');
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
    expect(answers.last()?.init).toMatchObject({ credentials: 'omit', cache: 'no-store' });
    expect((await send('/api/plugins/notes/rooms/x/gone', { method: 'DELETE' })).status).toBe(404);
    expect(answers.last()?.init.method).toBe('DELETE');
    expect(answers.bearers()).toEqual(['Bearer session-1', 'Bearer session-1']);
  });

  it('signs in again after a 401 and resolves with the answer it sends once more', async () => {
    const answers = fakeFetch();
    answers.route
      .mockImplementationOnce(() => json({ detail: 'expired' }, 401))
      .mockImplementationOnce(() => new Response('note', { status: 200 }));

    const response = await published().send('/api/plugins/notes/rooms/x/note.txt');

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('note');
    expect(answers.signIns()).toBe(2);
    expect(answers.bearers()).toEqual(['Bearer session-1', 'Bearer session-2']);
  });

  it('rejects with status 0 without an answer, and sends nothing to another origin', async () => {
    const answers = fakeFetch();
    answers.route.mockImplementationOnce(() => {
      throw new TypeError('Failed to fetch');
    });
    const { send } = published();

    await expect(send('/api/plugins/notes/a')).rejects.toMatchObject({ status: 0 });
    answers.request.mockClear();
    await expect(send('https://evil.example.org/steal')).rejects.toThrow(TypeError);
    expect(answers.request).not.toHaveBeenCalled();
  });
});

describe('MindroomServer.token', () => {
  it('is the bearer request sends, new once the server refused it or it ran out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const answers = fakeFetch();
    const { request, token } = published();

    await expect(token()).resolves.toBe('session-1');
    await request('/api/plugins/notes/a');
    expect(answers.signIns()).toBe(1);

    // A 401 for it signs in again; a later refusal of the same token leaves the new one.
    await expect(token({ refused: 'session-1' })).resolves.toBe('session-2');
    await expect(token({ refused: 'session-1' })).resolves.toBe('session-2');
    await request('/api/plugins/notes/b');

    // An hour later the session ran out.
    vi.setSystemTime(Date.now() + 3600_000);
    await expect(token()).resolves.toBe('session-3');
    expect(answers.signIns()).toBe(3);
    expect(answers.bearers()).toEqual(['Bearer session-1', 'Bearer session-2']);
  });

  it('rejects once its signal aborts while it signs in', async () => {
    const answers = fakeFetch();
    answers.request.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const stop = new AbortController();

    const asked = published().token({ signal: stop.signal });
    stop.abort();

    await expect(asked).rejects.toMatchObject({ status: 0 });
  });
});

describe('useRoomComputers', () => {
  const HELPER = { userId: '@mindroom_helper:example.org', membership: 'join', name: 'Helper' };
  const CODER = { userId: '@mindroom_coder:example.org', membership: 'join', name: 'Coder' };
  const SESSION = { session_id: 's1', state: 'ready', mode: 'view', expires_at: 2 };

  /** What `useRoomComputers(ROOM_ID)` gives, with `deploymentUrl` in config.json. */
  const computers = (deploymentUrl?: string) =>
    renderHook(() => useRoomComputers(ROOM_ID), { wrapper: signedIn(deploymentUrl) }).result
      .current;

  /** The computer of the agent `userId` among `found`. */
  const computerOf = (found: RoomComputer[], userId: string) => {
    const computer = found.find((entry) => entry.userId === userId);
    if (!computer) throw new Error(`no computer of ${userId}`);
    return computer;
  };

  beforeEach(() => {
    state.members = [AGENT, HELPER, CODER, { userId: '@ann:example.org', membership: 'join' }];
    // The helper's MindRoom has a computer and the coder's has none; the router publishes nothing.
    state.servers = [
      { agentUserId: HELPER.userId, apiUrl: PUBLISHED, computer: true, ts: 2 },
      { agentUserId: CODER.userId, apiUrl: 'https://coder.example.org', computer: false, ts: 1 },
    ];
  });

  it('lists every agent a configured server serves but one whose MindRoom has no computer', () => {
    const found = computers(DEPLOYMENT);
    expect(found.map(({ userId, name }) => ({ userId, name }))).toEqual([
      { userId: AGENT.userId, name: AGENT.userId },
      { userId: HELPER.userId, name: 'Helper' },
    ]);
    // Which server each runs on stays inside the SDK.
    expect(Object.keys(computerOf(found, HELPER.userId)).sort()).toEqual([
      'name',
      'openSession',
      'userId',
    ]);
  });

  it('lists, without one, only the agents that published a computer, while the homeserver binds tokens', () => {
    expect(computers().map(({ userId }) => userId)).toEqual([HELPER.userId]);
    state.bindsTokens = false;
    expect(computers()).toEqual([]);
  });

  it("opens a session with a bound token for an agent's own server, an unbound one for the configured server", async () => {
    const answers = fakeFetch();
    answers.route.mockImplementation(() => json({ ...SESSION, session_token: 'viewer' }));
    // Each agent's computer on its own server: the coder's is not the one the room found first.
    const coderServer = 'https://coder.example.org';
    state.servers = [
      { agentUserId: HELPER.userId, apiUrl: PUBLISHED, computer: true, ts: 2 },
      { agentUserId: CODER.userId, apiUrl: coderServer, computer: true, ts: 1 },
    ];

    const session = await computerOf(computers(), CODER.userId).openSession();
    expect(session.status).toEqual(SESSION);
    const stop = new AbortController();
    await computerOf(computers(DEPLOYMENT), CODER.userId).openSession(stop.signal);
    expect(answers.last()?.init.signal).toBe(stop.signal);

    expect(openId.requestToken.mock.calls).toEqual([
      [mx, coderServer, { requireBinding: true }],
      [mx, DEPLOYMENT, { requireBinding: false }],
    ]);
    expect(answers.routes()).toEqual([
      `${coderServer}/api/computers/sessions`,
      `${DEPLOYMENT}/api/computers/sessions`,
    ]);
    const created = JSON.parse(String(answers.last()?.init.body));
    expect(created).toEqual({
      openid_token: OPENID_TOKEN,
      room_id: ROOM_ID,
      agent_user_id: CODER.userId,
    });
  });

  it('rejects with ComputerApiError and its status when the server or the homeserver refuses', async () => {
    const answers = fakeFetch();
    answers.route.mockImplementation(() => json({ detail: 'Not in this room.' }, 403));
    const helper = computerOf(computers(), HELPER.userId);

    const refused = helper.openSession();
    await expect(refused).rejects.toBeInstanceOf(ComputerApiError);
    await expect(refused).rejects.toMatchObject({ status: 403, message: 'Not in this room.' });

    // A homeserver that cannot be reached gives no answer; one that will not sign in refuses.
    openId.requestToken.mockRejectedValueOnce(new ConnectionError('offline'));
    await expect(helper.openSession()).rejects.toMatchObject({
      name: 'ComputerApiError',
      status: 0,
    });
    openId.requestToken.mockRejectedValueOnce(new Error('does not bind sign-in tokens'));
    await expect(helper.openSession()).rejects.toMatchObject({
      name: 'ComputerApiError',
      status: 403,
    });
    expect(answers.routes()).toHaveLength(1);
  });

  it('asks for no token when its signal aborted before the call', async () => {
    const answers = fakeFetch();
    const stop = new AbortController();
    stop.abort();

    await expect(
      computerOf(computers(), HELPER.userId).openSession(stop.signal)
    ).rejects.toMatchObject({ name: 'ComputerApiError', status: 0 });
    expect(openId.requestToken).not.toHaveBeenCalled();
    expect(answers.routes()).toEqual([]);
  });

  it('rejects with status 0 once its signal aborts while the homeserver gives no token', async () => {
    const answers = fakeFetch();
    openId.requestToken.mockReturnValueOnce(new Promise(() => undefined));
    const stop = new AbortController();

    const opening = computerOf(computers(), HELPER.userId).openSession(stop.signal);
    stop.abort();

    await expect(opening).rejects.toMatchObject({ name: 'ComputerApiError', status: 0 });
    expect(answers.routes()).toEqual([]);
  });
});
