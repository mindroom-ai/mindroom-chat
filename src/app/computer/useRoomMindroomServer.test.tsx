// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { computerServicePreferenceAtom } from './computerServiceSettings';
import { useRoomMindroomServer } from './useRoomMindroomServer';

const PUBLISHED = 'https://published.example.org';
const DEPLOYMENT = 'https://deployment.example.org';

const state = vi.hoisted(() => ({
  bindsTokens: true,
  published: undefined as string | undefined,
  members: [] as { userId: string; membership: string }[],
}));

const ROOM = vi.hoisted(() => ({ roomId: '!room:example.org' }));

vi.mock('./useAgentServers', () => ({
  useBindsOpenIdTokens: () => state.bindsTokens,
  useRoomAgentServers: (room: unknown) =>
    room === ROOM && state.published ? [{ apiUrl: state.published }] : [],
}));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));

const server = (preference: string | null, deploymentUrl?: string) => {
  const store = createStore();
  store.set(computerServicePreferenceAtom, preference);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: deploymentUrl } } }}>
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
    it("is the room's published server while the homeserver binds tokens to it", () => {
      state.published = PUBLISHED;
      expect(server(preference, DEPLOYMENT)).toEqual({ apiUrl: PUBLISHED, discovered: true });
    });

    it("is the deployment's server when none is published or tokens are not bound", () => {
      expect(server(preference, DEPLOYMENT)).toEqual({ apiUrl: DEPLOYMENT, discovered: false });
      state.published = PUBLISHED;
      state.bindsTokens = false;
      expect(server(preference, DEPLOYMENT)).toEqual({ apiUrl: DEPLOYMENT, discovered: false });
    });

    it('is none without either, or in a room without a MindRoom agent', () => {
      expect(server(preference).apiUrl).toBeUndefined();
      state.published = PUBLISHED;
      state.members = [{ userId: '@bob:example.org', membership: 'join' }];
      expect(server(preference, DEPLOYMENT).apiUrl).toBeUndefined();
    });
  });
});
