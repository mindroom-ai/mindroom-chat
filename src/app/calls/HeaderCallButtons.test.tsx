import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderCallButtons } from './HeaderCallButtons';

const state = vi.hoisted(() => ({
  candidates: [] as { userId: string; displayName: string }[],
  callMembers: 0,
  shownHere: false,
  callRoom: false,
  /** What the deployment's call service discovery answered. */
  support: 'supported' as 'checking' | 'supported' | 'unsupported',
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:example.org' }),
}));
vi.mock('../matrix/hooks/useRoom', () => ({
  useRoom: () => ({ roomId: '!room:example.org', isCallRoom: () => state.callRoom }),
}));
vi.mock('./RoomCallButton', () => ({
  RoomCallButton: () => React.createElement('button', { 'data-kind': 'room-call' }),
}));
vi.mock('./callStore', () => ({
  isActiveCallShownIn: () => state.shownHere,
  useActiveCall: () => undefined,
  useRoomCallMembers: () => Array.from({ length: state.callMembers }),
}));
vi.mock('./agent/AgentCallHeaderButton', () => ({
  AgentCallHeaderButton: () => React.createElement('button', { 'data-kind': 'agent-call' }),
}));
// The room's voice agents are the candidates given here; the rule for offering them is real.
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('./agent/agentPresence', () => ({ usePresenceStatuses: () => new Map() }));
vi.mock('./agent/agentCallCandidates', () => ({
  getAgentCallCandidates: () => state.candidates,
  keepThreadSenders: (candidates: unknown[]) => candidates,
}));
vi.mock('./callSupport', () => ({ useCallSupport: () => state.support }));

let renderer: ReactTestRenderer | undefined;
const render = (element: React.ReactElement) => {
  act(() => {
    renderer?.unmount();
    renderer = create(element);
  });
  return renderer!;
};
const kinds = (tree: ReactTestRenderer) =>
  tree.root.findAllByType('button').map((button) => button.props['data-kind']);

const agent = { userId: '@mindroom_code:example.org', displayName: 'Code' };

beforeEach(() => {
  state.candidates = [];
  state.callMembers = 0;
  state.shownHere = false;
  state.callRoom = false;
  state.support = 'supported';
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('HeaderCallButtons', () => {
  it('offers the room call where the deployment has a call service', () => {
    expect(kinds(render(<HeaderCallButtons />))).toEqual(['room-call']);
  });

  it('offers the agent in place of the room call', () => {
    state.candidates = [agent];
    expect(kinds(render(<HeaderCallButtons />))).toEqual(['agent-call']);
  });

  it('offers the room call and the agent while someone is in a call', () => {
    state.candidates = [agent];
    state.callMembers = 2;
    expect(kinds(render(<HeaderCallButtons />))).toEqual(['room-call', 'agent-call']);
  });

  it('offers the room call in a call room, whose call is in the room itself', () => {
    state.candidates = [agent];
    state.callRoom = true;
    expect(kinds(render(<HeaderCallButtons />))).toEqual(['room-call']);
  });
});

describe('a deployment without a call service', () => {
  beforeEach(() => {
    state.support = 'unsupported';
  });

  it.each([
    { name: 'without an agent', candidates: [] },
    { name: 'with a voice-capable agent', candidates: [agent] },
  ])('offers no call in the header $name', ({ candidates }) => {
    state.candidates = candidates;
    expect(kinds(render(<HeaderCallButtons />))).toEqual([]);
  });

  it('offers nothing while it is still being asked', () => {
    state.support = 'checking';
    expect(kinds(render(<HeaderCallButtons />))).toEqual([]);
  });

  it.each([
    { name: 'someone is in it', callMembers: 1, shownHere: false },
    { name: 'this device shows it', callMembers: 0, shownHere: true },
  ])('still shows a call that is on while $name, but no agent to call', (call) => {
    state.candidates = [agent];
    state.callMembers = call.callMembers;
    state.shownHere = call.shownHere;
    expect(kinds(render(<HeaderCallButtons />))).toEqual(['room-call']);
  });
});
