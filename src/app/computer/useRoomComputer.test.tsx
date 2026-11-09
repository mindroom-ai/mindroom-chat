// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { RoomMember } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import type { AgentServer } from './agentServer';
import { computerServicePreferenceAtom } from './computerServiceSettings';
import { useRoomComputer } from './useRoomComputer';

const CONFIGURED = 'https://computer.example.org';
const ME = '@ann:example.org';
const HELPER = '@mindroom_helper:example.org';
const CODER = '@mindroom_coder:example.org';
const QUIET = '@mindroom_quiet:example.org';

// The homeserver binds sign-in tokens.
vi.mock('./useAgentServers', () => ({ useBindsOpenIdTokens: () => true }));

const member = (userId: string, membership = 'join') =>
  ({ userId, membership, name: userId.slice(1, userId.indexOf(':')) } as RoomMember);

// Ann, a person, an invited agent and three joined agents: the helper's and the coder's servers
// have a computer, the quiet one's has none.
const MEMBERS = [
  member(ME),
  member('@bob:example.org'),
  member('@mindroom_invited:example.org', 'invite'),
  member(HELPER),
  member(CODER),
  member(QUIET),
];
const SERVERS: AgentServer[] = [
  { agentUserId: HELPER, apiUrl: 'https://helper.example.org', computer: true, ts: 3 },
  { agentUserId: CODER, apiUrl: 'https://coder.example.org', computer: true, ts: 2 },
  { agentUserId: QUIET, apiUrl: 'https://quiet.example.org', computer: false, ts: 1 },
];

const roomComputer = (
  configured: string | undefined,
  {
    preference = null,
    members = MEMBERS,
  }: { preference?: string | null; members?: RoomMember[] } = {}
) => {
  const store = createStore();
  store.set(computerServicePreferenceAtom, preference);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: configured } } }}>
        {children}
      </ClientConfigProvider>
    </Provider>
  );
  return renderHook(() => useRoomComputer(members, SERVERS, ME), { wrapper }).result.current;
};

beforeEach(() => {
  localStorage.clear();
});

describe('useRoomComputer', () => {
  it('gives a configured server every joined agent but one whose MindRoom says it has no computer', () => {
    // The agent that publishes no server at all still runs on the configured one.
    const unpublished = '@mindroom_new:example.org';
    expect(roomComputer(CONFIGURED, { members: [...MEMBERS, member(unpublished)] })).toEqual({
      agents: [
        { userId: HELPER, name: 'mindroom_helper' },
        { userId: CODER, name: 'mindroom_coder' },
        { userId: unpublished, name: 'mindroom_new' },
      ],
      apiUrl: CONFIGURED,
    });
  });

  it('gives no agent a computer once the user turned computers off', () => {
    expect(roomComputer(CONFIGURED, { preference: '' })).toEqual({ agents: [], apiUrl: undefined });
  });
});
