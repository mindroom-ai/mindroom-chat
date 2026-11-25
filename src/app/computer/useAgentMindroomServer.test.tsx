// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import type { AgentServer } from './agentServer';
import { computerServicePreferenceAtom } from './computerServiceSettings';
import { useAgentMindroomServer } from './useAgentMindroomServer';

const AGENT = '@mindroom_helper:example.org';
const OTHER_AGENT = '@mindroom_other:example.org';
const PUBLISHED = 'https://published.example.org';
const OTHER_PUBLISHED = 'https://other-agent.example.org';
const DEPLOYMENT = 'https://deployment.example.org';
const PERSONAL = 'https://personal.example.org';

const state = vi.hoisted((): { bindsTokens: boolean | undefined; servers: AgentServer[] } => ({
  bindsTokens: true,
  servers: [],
}));

const ROOM = vi.hoisted(() => ({ roomId: '!room:example.org' }));

vi.mock('./useAgentServers', () => ({
  useOpenIdBinding: () => state.bindsTokens,
  useRoomAgentServers: (room: unknown) => (room === ROOM ? state.servers : []),
}));

const publishedServer = (agentUserId: string, apiUrl: string, ts = 1): AgentServer => ({
  agentUserId,
  apiUrl,
  computer: false,
  ts,
});

type ComputersConfig = { apiUrl?: string; trustedApiUrls?: string[] };

const resolve = (
  computers?: ComputersConfig,
  preference: string | null = null,
  trust?: 'chosen' | 'room'
) => {
  const store = createStore();
  store.set(computerServicePreferenceAtom, preference);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <ClientConfigProvider value={{ mindroom: { computers } }}>{children}</ClientConfigProvider>
    </Provider>
  );
  const mx = {
    getRoom: (roomId: string) => (roomId === ROOM.roomId ? ROOM : null),
  } as unknown as MatrixClient;
  return renderHook(
    () => useAgentMindroomServer(mx, ROOM.roomId, AGENT, trust ? { trust } : undefined),
    { wrapper }
  ).result.current;
};

beforeEach(() => {
  localStorage.clear();
  state.bindsTokens = true;
  state.servers = [];
});

describe('useAgentMindroomServer', () => {
  describe("trust: 'room'", () => {
    it.each([null, ''])(
      'discovers only the target agent server automatically with preference %j',
      (preference) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        state.servers = [
          publishedServer(OTHER_AGENT, OTHER_PUBLISHED, 2),
          publishedServer(AGENT, PUBLISHED, 1),
        ];
        expect(resolve({ apiUrl: '' }, preference, 'room')).toEqual({
          apiUrl: PUBLISHED,
          pending: false,
        });

        state.servers = [publishedServer(OTHER_AGENT, OTHER_PUBLISHED, 2)];
        expect(resolve({ apiUrl: '' }, preference, 'room')).toEqual({
          apiUrl: undefined,
          pending: false,
        });
        warn.mockRestore();
      }
    );

    it('honours a configured trust list and personal override without configured fallback', () => {
      state.servers = [publishedServer(AGENT, DEPLOYMENT)];
      expect(resolve({ apiUrl: DEPLOYMENT }, null, 'room')).toEqual({
        apiUrl: DEPLOYMENT,
        pending: false,
      });

      state.servers = [publishedServer(AGENT, PUBLISHED)];
      expect(resolve({ apiUrl: DEPLOYMENT, trustedApiUrls: [PUBLISHED] }, null, 'room')).toEqual({
        apiUrl: PUBLISHED,
        pending: false,
      });
      expect(resolve({ trustedApiUrls: [PUBLISHED] }, null, 'room').apiUrl).toBe(PUBLISHED);
      expect(resolve({ apiUrl: DEPLOYMENT }, PUBLISHED, 'room').apiUrl).toBe(PUBLISHED);
      expect(resolve({ trustedApiUrls: [] }, PUBLISHED, 'room').apiUrl).toBe(PUBLISHED);

      // Untrusted published servers return undefined instead of falling back to configured.
      expect(resolve({ apiUrl: DEPLOYMENT }, null, 'room')).toEqual({
        apiUrl: undefined,
        pending: false,
      });
      expect(
        resolve({ apiUrl: DEPLOYMENT, trustedApiUrls: [OTHER_PUBLISHED] }, null, 'room').apiUrl
      ).toBeUndefined();
      expect(resolve({ trustedApiUrls: [] }, null, 'room').apiUrl).toBeUndefined();
    });

    it('falls back to configured or personal when unpublished or tokens are unbound', () => {
      state.servers = [publishedServer(OTHER_AGENT, OTHER_PUBLISHED)];
      expect(resolve({ apiUrl: DEPLOYMENT }, PERSONAL, 'room')).toEqual({
        apiUrl: DEPLOYMENT,
        pending: false,
      });
      expect(resolve({ apiUrl: '' }, PERSONAL, 'room')).toEqual({
        apiUrl: PERSONAL,
        pending: false,
      });
      expect(resolve({ apiUrl: '' }, '', 'room')).toEqual({
        apiUrl: undefined,
        pending: false,
      });

      state.servers = [publishedServer(AGENT, PUBLISHED)];
      state.bindsTokens = false;
      expect(resolve({ apiUrl: DEPLOYMENT }, null, 'room')).toEqual({
        apiUrl: DEPLOYMENT,
        pending: false,
      });
      expect(resolve({ apiUrl: '' }, PERSONAL, 'room')).toEqual({
        apiUrl: PERSONAL,
        pending: false,
      });
    });

    it('reports pending while the homeserver answer on binding tokens is still out', () => {
      state.bindsTokens = undefined;
      state.servers = [publishedServer(AGENT, PUBLISHED)];
      expect(resolve({ apiUrl: '' }, null, 'room')).toEqual({
        apiUrl: undefined,
        pending: true,
      });
      expect(resolve({ apiUrl: DEPLOYMENT }, null, 'room')).toEqual({
        apiUrl: DEPLOYMENT,
        pending: true,
      });
    });
  });

  describe("default trust ('chosen')", () => {
    it('rejects unchecked published servers when neither apiUrl nor trustedApiUrls is set', () => {
      state.servers = [publishedServer(AGENT, PUBLISHED)];
      expect(resolve({ apiUrl: '' }, null)).toEqual({
        apiUrl: undefined,
        pending: false,
      });
      expect(resolve({ apiUrl: '' }, '')).toEqual({
        apiUrl: undefined,
        pending: false,
      });
    });

    it('allows a published server that matches the personal preference', () => {
      state.servers = [publishedServer(AGENT, PUBLISHED)];
      expect(resolve({ apiUrl: '' }, PUBLISHED)).toEqual({
        apiUrl: PUBLISHED,
        pending: false,
      });
      expect(resolve({ apiUrl: '' }, PERSONAL)).toEqual({
        apiUrl: undefined,
        pending: false,
      });
    });
  });
});
