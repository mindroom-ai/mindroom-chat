import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderCallButtons, HeaderCallMenuEntries } from './HeaderCallButtons';
import { defined } from '../../test-utils/defined';

const state = vi.hoisted(() => ({
  candidates: [] as { userId: string; displayName: string }[],
  callMembers: 0,
  shownHere: false,
  callRoom: false,
  setPanelOpen: vi.fn(),
  call: vi.fn(),
}));

vi.mock('folds', () => ({ Icons: { Phone: 'Phone' } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../hooks/useRoom', () => ({
  useRoom: () => ({ roomId: '!room:example.org', isCallRoom: () => state.callRoom }),
}));
vi.mock('../../features/calls/RoomCallButton', () => ({
  RoomCallButton: () => React.createElement('button', { 'data-kind': 'room-call' }),
}));
vi.mock('../../features/calls/callStore', () => ({
  isActiveCallShownIn: () => state.shownHere,
  useActiveCall: () => undefined,
  useCallPanel: () => [false, state.setPanelOpen],
  useRoomCallMembers: () => Array.from({ length: state.callMembers }),
}));
vi.mock('./AgentCallHeaderButton', () => ({
  AgentCallHeaderButton: () => React.createElement('button', { 'data-kind': 'agent-call' }),
  useAgentCallCandidates: () => state.candidates,
}));
vi.mock('./agentCaller', () => ({ useAgentCaller: () => ({ call: state.call, pending: false }) }));
vi.mock('../../components/MenuEntry', () => ({
  MenuEntry: ({ label, onSelect }: { label: string; onSelect: () => void }) =>
    React.createElement('button', { 'data-kind': 'menu-entry', onClick: onSelect }, label),
}));

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
const labels = (tree: ReactTestRenderer) =>
  tree.root.findAllByType('button').map((button) => button.props.children);

const agent = { userId: '@mindroom_code:example.org', displayName: 'Code' };

beforeEach(() => {
  state.candidates = [];
  state.callMembers = 0;
  state.shownHere = false;
  state.callRoom = false;
  state.setPanelOpen.mockReset();
  state.call.mockReset();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('HeaderCallButtons', () => {
  it('offers the agent in place of the room call on wide screens', () => {
    state.candidates = [agent];
    expect(kinds(render(<HeaderCallButtons />))).toEqual(['agent-call']);
  });

  it('offers the room call and the agent while someone is in a call', () => {
    state.candidates = [agent];
    state.callMembers = 2;
    expect(kinds(render(<HeaderCallButtons />))).toEqual(['room-call', 'agent-call']);
  });

  it('shows nothing on a phone while no call is on', () => {
    state.candidates = [agent];
    expect(kinds(render(<HeaderCallButtons phone />))).toEqual([]);
    state.candidates = [];
    expect(kinds(render(<HeaderCallButtons phone />))).toEqual([]);
  });

  it.each([
    { name: 'someone is in a call', callMembers: 1, shownHere: false },
    { name: 'this device shows the call', callMembers: 0, shownHere: true },
  ])('shows the room call on a phone while $name', ({ callMembers, shownHere }) => {
    state.candidates = [agent];
    state.callMembers = callMembers;
    state.shownHere = shownHere;
    expect(kinds(render(<HeaderCallButtons phone />))).toEqual(['room-call']);
  });
});

describe('HeaderCallMenuEntries', () => {
  it('starts the room call from the menu when no agent can be called', () => {
    const requestClose = vi.fn();
    const tree = render(<HeaderCallMenuEntries requestClose={requestClose} />);
    expect(labels(tree)).toEqual(['featureUi.calls.header.startCall']);

    act(() => {
      tree.root.findByType('button').props.onClick();
    });
    expect(requestClose).toHaveBeenCalledOnce();
    expect(state.setPanelOpen).toHaveBeenCalledWith(true);
  });

  it('leaves a call that is on to the header button', () => {
    state.callMembers = 1;
    expect(labels(render(<HeaderCallMenuEntries requestClose={vi.fn()} />))).toEqual([]);
  });

  it('calls each voice-capable agent about the open thread, even during a call', () => {
    const second = { userId: '@mindroom_mind:example.org', displayName: 'Mind' };
    state.candidates = [agent, second];
    state.callMembers = 1;
    const requestClose = vi.fn();
    const tree = render(<HeaderCallMenuEntries threadId="$thread" requestClose={requestClose} />);
    expect(labels(tree)).toEqual([
      'mindroomUi.calls.agentCallHeaderButton.callAgent:Code',
      'mindroomUi.calls.agentCallHeaderButton.callAgent:Mind',
    ]);

    act(() => {
      defined(tree.root.findAllByType('button')[1], 'the second entry').props.onClick();
    });
    expect(requestClose).toHaveBeenCalledOnce();
    expect(state.call).toHaveBeenCalledWith({
      agentUserId: second.userId,
      displayName: 'Mind',
      roomId: '!room:example.org',
      threadId: '$thread',
    });
  });

  it('offers the room call in a call room, whose call is in the room itself', () => {
    state.candidates = [agent];
    state.callRoom = true;
    expect(labels(render(<HeaderCallMenuEntries requestClose={vi.fn()} />))).toEqual([
      'featureUi.calls.header.startCall',
    ]);
  });
});
