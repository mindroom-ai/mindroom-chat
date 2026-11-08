// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { IOpenIDToken, MatrixClient } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptionClient } from '../app/calls/transcription/api';
import { clientSessions } from '../app/computer/clientSessions';
import { ClientConfigProvider } from '../app/config/useClientConfig';
import { MatrixClientProvider } from '../app/matrix/hooks/useMatrixClient';
import { MindroomServerError, useMindroomServer, type MindroomServer } from './server';

const ROOM_ID = '!room:example.org';
const PUBLISHED = 'https://published.example.org';
const DEPLOYMENT = 'https://deployment.example.org';

const state = vi.hoisted(() => ({
  bindsTokens: true,
  published: undefined as string | undefined,
  members: [] as { userId: string; membership: string }[],
}));
vi.mock('../app/computer/useAgentServers', () => ({
  useBindsOpenIdTokens: () => state.bindsTokens,
  useRoomAgentServers: () => (state.published ? [{ apiUrl: state.published }] : []),
}));
vi.mock('../app/matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
vi.mock('../app/matrix/openidAudience', () => ({
  requestAudienceOpenIdToken: async (): Promise<IOpenIDToken> => ({
    access_token: 'openid',
    token_type: 'Bearer',
    matrix_server_name: 'example.org',
    expires_in: 3600,
  }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The servers' answers: client sessions, numbered, and what `route` answers for the rest. */
const fakeFetch = () => {
  const sent: { url: string; init: RequestInit }[] = [];
  let sessions = 0;
  const route = vi.fn((_url: string): Response => json({}));
  const request = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    sent.push({ url, init });
    if (url.endsWith('/api/client-sessions')) {
      sessions += 1;
      return json({ session_token: `session-${sessions}`, expires_at: Date.now() / 1000 + 3600 });
    }
    return route(url);
  });
  vi.stubGlobal('fetch', request);
  const toRoutes = () => sent.filter(({ url }) => !url.endsWith('/api/client-sessions'));
  return {
    route,
    request,
    signIns: () => sessions,
    routes: () => toRoutes().map(({ url }) => url),
    /** The bearer each request after the sign-ins carried. */
    bearers: () => toRoutes().map(({ init }) => new Headers(init.headers).get('Authorization')),
    last: () => sent.at(-1),
  };
};

let mx: MatrixClient;

/** What `useMindroomServer(roomId)` gives, signed in to `mx`, with `deploymentUrl` in config.json. */
const server = (deploymentUrl?: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MatrixClientProvider value={mx}>
      <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
        {children}
      </ClientConfigProvider>
    </MatrixClientProvider>
  );
  return renderHook(() => useMindroomServer(ROOM_ID), { wrapper }).result.current;
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
  state.members = [{ userId: '@mindroom_router:example.org', membership: 'join' }];
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

  it('shares one sign-in between every plugin and call transcripts', async () => {
    const answers = fakeFetch();
    answers.route.mockImplementation((url) =>
      url.includes('calls.live') ? json({ call: null, lines: [], names: {} }) : json({})
    );

    await Promise.all([
      published().request('/api/plugins/notes/rooms/x/hello'),
      published().request('/api/plugins/tasks/rooms/x/list'),
      new TranscriptionClient(clientSessions(mx, PUBLISHED, true)).live(ROOM_ID),
    ]);

    expect(answers.signIns()).toBe(1);
    expect(answers.routes()).toHaveLength(3);
  });
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
