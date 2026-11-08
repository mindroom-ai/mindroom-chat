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
  return {
    route,
    request,
    signIns: () => sent.filter(({ url }) => url.endsWith('/api/client-sessions')).length,
    routes: () =>
      sent.filter(({ url }) => !url.endsWith('/api/client-sessions')).map(({ url }) => url),
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
    answers.route.mockImplementation(() => json({ detail: 'Not a member.' }, 401));

    const error = await published()
      .request('/api/plugins/notes/rooms/x/hello')
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MindroomServerError);
    expect(error).toMatchObject({ status: 401, body: { detail: 'Not a member.' } });
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
