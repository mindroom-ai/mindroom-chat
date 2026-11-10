// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { computerServicePreferenceAtom } from './computerServiceSettings';
import { useRoomMindroomServer } from './useRoomMindroomServer';

const PUBLISHED = 'https://published.example.org';
const DEPLOYMENT = 'https://deployment.example.org';
const OTHER = 'https://other.example.org';

const state = vi.hoisted(() => ({
  // Undefined asks the homeserver, as the app does.
  bindsTokens: true as boolean | undefined,
  published: undefined as string | undefined,
  members: [] as { userId: string; membership: string }[],
}));

const ROOM = vi.hoisted(() => ({ roomId: '!room:example.org', membersLoaded: () => true }));

vi.mock('./useAgentServers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useAgentServers')>();
  return {
    useOpenIdBinding: () => state.bindsTokens ?? actual.useOpenIdBinding(),
    useRoomAgentServers: (room: unknown) =>
      room === ROOM && state.published ? [{ apiUrl: state.published }] : [],
  };
});
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
// The homeserver binds tokens when a test asks it.
vi.mock('../matrix/openidAudience', () => ({ readOpenIdBinding: async () => true }));

const server = (preference: string | null, deploymentUrl?: string, trustedApiUrls?: string[]) => {
  const store = createStore();
  store.set(computerServicePreferenceAtom, preference);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <ClientConfigProvider
        value={{ mindroom: { computers: { apiUrl: deploymentUrl, trustedApiUrls } } }}
      >
        {children}
      </ClientConfigProvider>
    </Provider>
  );
  const mx = {
    getRoom: (roomId: string) => (roomId === ROOM.roomId ? ROOM : null),
  } as unknown as MatrixClient;
  return renderHook(() => useRoomMindroomServer(mx, ROOM.roomId), { wrapper }).result.current;
};

beforeEach(() => {
  localStorage.clear();
  state.bindsTokens = true;
  state.published = undefined;
  state.members = [{ userId: '@mindroom_router:example.org', membership: 'join' }];
});

describe('useRoomMindroomServer', () => {
  // This device's choice of server for agents' computers, or computers turned off, never counts:
  // call transcripts and plugin routes need the MindRoom whose router is in the room.
  describe.each([null, 'https://other.example.org', ''])('with the preference %j', (preference) => {
    it("is the room's published server while the homeserver binds tokens to it and it is trusted", () => {
      state.published = PUBLISHED;
      expect(server(preference, DEPLOYMENT, [PUBLISHED])).toEqual({
        apiUrl: PUBLISHED,
        pending: false,
      });
      expect(server(preference, undefined, [PUBLISHED]).apiUrl).toBe(PUBLISHED);
    });

    // Any account on the homeserver named like an agent can publish one.
    it("keeps the deployment's server when the published one is not on the trusted list", () => {
      state.published = PUBLISHED;
      expect(server(preference, DEPLOYMENT)).toEqual({ apiUrl: DEPLOYMENT, pending: false });
      expect(server(preference, DEPLOYMENT, [OTHER]).apiUrl).toBe(DEPLOYMENT);
      expect(server(preference, undefined, [OTHER]).apiUrl).toBeUndefined();
    });

    it('is the published server, unchecked, with neither a configured server nor a list', () => {
      state.published = PUBLISHED;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(server(preference).apiUrl).toBe(PUBLISHED);
      warn.mockRestore();
    });

    it("is the deployment's server when none is published or tokens are not bound", () => {
      expect(server(preference, DEPLOYMENT)).toEqual({
        apiUrl: DEPLOYMENT,
        pending: false,
      });
      state.published = PUBLISHED;
      state.bindsTokens = false;
      expect(server(preference, DEPLOYMENT, [PUBLISHED])).toEqual({
        apiUrl: DEPLOYMENT,
        pending: false,
      });
    });

    it('is none without either, or in a room without a MindRoom agent', () => {
      expect(server(preference).apiUrl).toBeUndefined();
      state.published = PUBLISHED;
      state.members = [{ userId: '@bob:example.org', membership: 'join' }];
      expect(server(preference, DEPLOYMENT).apiUrl).toBeUndefined();
    });
  });

  // A plugin that requests on mount sends its first request to the server of its first render.
  it("is the room's published server from a later mount's first render once the homeserver answered", async () => {
    state.bindsTokens = undefined;
    state.published = PUBLISHED;
    const mx = {
      getRoom: (roomId: string) => (roomId === ROOM.roomId ? ROOM : null),
    } as unknown as MatrixClient;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MatrixClientProvider value={mx}>
        <ClientConfigProvider
          value={{ mindroom: { computers: { apiUrl: DEPLOYMENT, trustedApiUrls: [PUBLISHED] } } }}
        >
          {children}
        </ClientConfigProvider>
      </MatrixClientProvider>
    );
    const mount = () => {
      const seen: ReturnType<typeof useRoomMindroomServer>[] = [];
      const { unmount } = renderHook(() => seen.push(useRoomMindroomServer(mx, ROOM.roomId)), {
        wrapper,
      });
      return { seen, unmount };
    };

    // The page's first check is still unanswered on the first render.
    const first = mount();
    expect(first.seen[0]).toEqual({ apiUrl: DEPLOYMENT, pending: true });
    await waitFor(() => expect(first.seen.at(-1)).toEqual({ apiUrl: PUBLISHED, pending: false }));
    first.unmount();

    expect(mount().seen[0]).toEqual({ apiUrl: PUBLISHED, pending: false });
  });
});
