import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentCallHeaderButton } from './AgentCallHeaderButton';

const VOICE_CALLS_STATUS = '🤖 Model: openai/gpt-5.5 | 📞 Voice calls';
const ROOM_ID = '!room:mindroom.test';
const HELPER = { userId: '@mindroom_helper:mindroom.test', displayName: 'Helper' };
const ANALYST = { userId: '@mindroom_analyst:mindroom.test', displayName: 'Analyst' };

type PresenceListener = (event: unknown, user: { userId: string }) => void;

const state = vi.hoisted(() => ({
  startAgentCall: vi.fn(),
  call: {
    loading: false,
    error: undefined as string | undefined,
    unavailableReason: undefined as string | undefined,
  },
  members: [] as Array<{ userId: string; name: string; membership: string }>,
  statuses: {} as Record<string, string | undefined>,
  callRoom: false,
  presenceListeners: new Set<PresenceListener>(),
}));

const mx = vi.hoisted(() => ({
  getUserId: () => '@alice:mindroom.test',
  getUser: (userId: string) => ({ userId, presenceStatusMsg: state.statuses[userId] }),
  on: (_event: string, listener: PresenceListener) => state.presenceListeners.add(listener),
  removeListener: (_event: string, listener: PresenceListener) =>
    state.presenceListeners.delete(listener),
}));

vi.mock('./useStartAgentCall', () => ({
  useStartAgentCall: () => ({ startAgentCall: state.startAgentCall, ...state.call }),
}));

vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));

vi.mock('../../hooks/useRoom', () => ({
  useRoom: () => ({ roomId: ROOM_ID, isCallRoom: () => state.callRoom }),
}));

vi.mock('../../hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? content : null,
  TooltipProvider: ({
    tooltip,
    children,
  }: {
    tooltip: React.ReactNode;
    children: (ref: () => void) => React.ReactNode;
  }) => (
    <>
      {tooltip}
      {children(() => undefined)}
    </>
  ),
}));

const addVoiceAgent = (agent: { userId: string; displayName: string }) => {
  state.members.push({ userId: agent.userId, name: agent.displayName, membership: 'join' });
  state.statuses[agent.userId] = VOICE_CALLS_STATUS;
};

const render = (threadId?: string) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<AgentCallHeaderButton threadId={threadId} />);
  });
  return renderer;
};

const headerButton = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'])[0];

const anchorEvent = {
  currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 32, height: 32 }) },
};

const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());

const nodeText = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : nodeText(child))).join('');

describe('AgentCallHeaderButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.call = { loading: false, error: undefined, unavailableReason: undefined };
    state.members = [{ userId: '@bob:mindroom.test', name: 'Bob', membership: 'join' }];
    state.statuses = {};
    state.callRoom = false;
    state.presenceListeners.clear();
    state.startAgentCall.mockResolvedValue(true);
  });

  it('renders nothing without a voice-capable agent in the room', () => {
    state.members.push({ userId: HELPER.userId, name: 'Helper', membership: 'join' });
    state.statuses[HELPER.userId] = '🤖 Model: openai/gpt-5.5';

    expect(render('$root').toJSON()).toBeNull();
  });

  it('renders nothing inside a call room', () => {
    addVoiceAgent(HELPER);
    state.callRoom = true;

    expect(render().toJSON()).toBeNull();
  });

  it('appears once an agent starts advertising voice calls', () => {
    state.members.push({ userId: HELPER.userId, name: 'Helper', membership: 'join' });
    const renderer = render();
    expect(renderer.toJSON()).toBeNull();

    state.statuses[HELPER.userId] = VOICE_CALLS_STATUS;
    act(() => state.presenceListeners.forEach((listener) => listener(undefined, HELPER)));

    expect(headerButton(renderer).props['aria-label']).toBe('Call Helper');
  });

  it.each([
    ['$root', '$root'],
    [undefined, null],
  ])('calls the only agent from thread %s with origin thread %s', async (threadId, expected) => {
    addVoiceAgent(HELPER);
    const renderer = render(threadId);

    await act(async () => headerButton(renderer).props.onClick(anchorEvent));

    expect(state.startAgentCall).toHaveBeenCalledWith(HELPER, {
      room_id: ROOM_ID,
      thread_id: expected,
    });
    expect(text(renderer)).not.toContain('Choose an agent to call');
  });

  it('lets the user choose between several agents', async () => {
    addVoiceAgent(HELPER);
    addVoiceAgent(ANALYST);
    const renderer = render('$root');
    expect(headerButton(renderer).props['aria-label']).toBe('Call an agent');
    expect(text(renderer)).not.toContain('Choose an agent to call');

    act(() => headerButton(renderer).props.onClick(anchorEvent));

    expect(state.startAgentCall).not.toHaveBeenCalled();
    expect(text(renderer)).toContain('Choose an agent to call');
    const items = renderer.root.findAll(
      (node) => node.type === 'button' && !node.props['aria-label']
    );
    expect(items.map(nodeText)).toEqual(['Analyst', 'Helper']);

    await act(async () => items[1].props.onClick());

    expect(state.startAgentCall).toHaveBeenCalledWith(HELPER, {
      room_id: ROOM_ID,
      thread_id: '$root',
    });
    expect(text(renderer)).not.toContain('Choose an agent to call');
  });

  it('explains why calling is unavailable and ignores clicks', () => {
    addVoiceAgent(HELPER);
    state.call.unavailableReason = 'End your current call first.';
    const renderer = render();

    act(() => headerButton(renderer).props.onClick(anchorEvent));

    expect(headerButton(renderer).props['aria-label']).toBe('End your current call first.');
    expect(headerButton(renderer).props['aria-disabled']).toBe(true);
    expect(state.startAgentCall).not.toHaveBeenCalled();
  });

  it('shows a failed start in the tooltip', () => {
    addVoiceAgent(HELPER);
    state.call.error = 'sync failed';

    expect(headerButton(render()).props['aria-label']).toBe('Failed to start the call.');
  });
});
