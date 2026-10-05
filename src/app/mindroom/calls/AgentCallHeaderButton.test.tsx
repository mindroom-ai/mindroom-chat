import React from 'react';
import { EventEmitter } from 'events';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClient, MatrixEvent, User } from 'matrix-js-sdk';
import { ReEmitter } from 'matrix-js-sdk/lib/ReEmitter';
import FocusTrap from 'focus-trap-react';
import { Tooltip } from 'folds';
import { AgentCallHeaderButton } from './AgentCallHeaderButton';

const MODEL_STATUS = '🤖 Model: openai/gpt-5.5';
const VOICE_CALLS_STATUS = `${MODEL_STATUS} | 📞 Voice calls`;
const ROOM_ID = '!room:mindroom.test';
const HELPER = { userId: '@mindroom_helper:mindroom.test', displayName: 'Helper' };
const ANALYST = { userId: '@mindroom_analyst:mindroom.test', displayName: 'Analyst' };

const state = vi.hoisted(() => ({
  startAgentCall: vi.fn(),
  call: {
    supported: true,
    loading: false,
    error: undefined as string | undefined,
    unavailableReason: undefined as string | undefined,
  },
  members: [] as Array<{ userId: string; name: string; membership: string }>,
  callRoom: false,
}));

// A client that re-emits its users' events, as the SDK's User.createUser wires them up.
const users = new Map<string, User>();
const mx = Object.assign(new EventEmitter(), {
  getUserId: () => '@alice:mindroom.test',
  getUser: (userId: string) => users.get(userId) ?? null,
});
Object.assign(mx, { reEmitter: new ReEmitter(mx) });

const setStatus = (userId: string, status: string) => {
  const user = users.get(userId) ?? User.createUser(userId, mx as unknown as MatrixClient);
  users.set(userId, user);
  user.setPresenceEvent(
    new MatrixEvent({
      type: 'm.presence',
      sender: userId,
      content: { presence: 'online', status_msg: status },
    })
  );
};

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
  setStatus(agent.userId, VOICE_CALLS_STATUS);
};

// The header trigger is the only host node that gets a DOM element, so refs to it can be checked.
const triggerNode = {};

const render = (threadId?: string) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<AgentCallHeaderButton threadId={threadId} />, {
      createNodeMock: (element) =>
        String(element.props?.['aria-label']).startsWith('Call ') ? triggerNode : null,
    });
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
    state.call = {
      supported: true,
      loading: false,
      error: undefined,
      unavailableReason: undefined,
    };
    state.members = [{ userId: '@bob:mindroom.test', name: 'Bob', membership: 'join' }];
    users.clear();
    mx.removeAllListeners();
    state.callRoom = false;
    state.startAgentCall.mockResolvedValue(true);
  });

  it('renders nothing without a voice-capable agent in the room', () => {
    state.members.push({ userId: HELPER.userId, name: 'Helper', membership: 'join' });
    setStatus(HELPER.userId, MODEL_STATUS);

    expect(render('$root').toJSON()).toBeNull();
  });

  it('renders nothing where calling is not supported', () => {
    addVoiceAgent(HELPER);
    state.call.supported = false;

    expect(render().toJSON()).toBeNull();
  });

  it('renders nothing inside a call room', () => {
    addVoiceAgent(HELPER);
    state.callRoom = true;

    expect(render().toJSON()).toBeNull();
  });

  it('follows an agent turning voice calls on and off while it stays online', () => {
    state.members.push({ userId: HELPER.userId, name: 'Helper', membership: 'join' });
    setStatus(HELPER.userId, MODEL_STATUS);
    const renderer = render();
    expect(renderer.toJSON()).toBeNull();

    act(() => setStatus(HELPER.userId, VOICE_CALLS_STATUS));
    expect(headerButton(renderer).props['aria-label']).toBe('Call Helper');

    act(() => setStatus(HELPER.userId, MODEL_STATUS));
    expect(renderer.toJSON()).toBeNull();
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

  it('stamps no thread while the thread root is still a local echo', async () => {
    addVoiceAgent(HELPER);
    const renderer = render('~!room:mindroom.test:m1791165951526.3');

    await act(async () => headerButton(renderer).props.onClick(anchorEvent));

    expect(state.startAgentCall).toHaveBeenCalledWith(HELPER, {
      room_id: ROOM_ID,
      thread_id: null,
    });
  });

  it('explains why calling is unavailable and ignores clicks', () => {
    addVoiceAgent(HELPER);
    state.call.unavailableReason = 'End your current call first.';
    const renderer = render();

    act(() => headerButton(renderer).props.onClick(anchorEvent));

    expect(headerButton(renderer).props['aria-label']).toBe('Call Helper');
    const reason = renderer.root.find(
      (node) => node.props.id === headerButton(renderer).props['aria-describedby']
    );
    expect(nodeText(reason)).toBe('End your current call first.');
    expect(headerButton(renderer).props['aria-disabled']).toBe(true);
    expect(state.startAgentCall).not.toHaveBeenCalled();
  });

  it('shows a failed start visibly until dismissed', async () => {
    addVoiceAgent(HELPER);
    state.startAgentCall.mockImplementationOnce(async () => {
      state.call.error =
        'Microphone access is blocked. Allow microphone access for MindRoom Chat in iPhone settings and try again.';
      return false;
    });
    const renderer = render('$root');
    const notices = () =>
      renderer.root.findAll((node) => typeof node.type === 'string' && node.props.role === 'alert');
    expect(notices()).toHaveLength(0);

    await act(async () => headerButton(renderer).props.onClick(anchorEvent));

    expect(notices().map(nodeText)).toEqual([
      'Microphone access is blocked. Allow microphone access for MindRoom Chat in iPhone settings and try again.',
    ]);
    expect(renderer.root.findAllByType(Tooltip)).toHaveLength(0);
    expect(headerButton(renderer).props['aria-label']).toBe('Call Helper');
    act(() =>
      renderer.root
        .findAll((node) => node.type === 'button' && node.props['aria-label'] === 'Close')[0]
        .props.onClick()
    );
    expect(notices()).toHaveLength(0);
    expect(renderer.root.findAllByType(Tooltip)).toHaveLength(1);
  });

  it('returns focus to the button when the menu or the notice closes', async () => {
    addVoiceAgent(HELPER);
    addVoiceAgent(ANALYST);
    state.startAgentCall.mockImplementationOnce(async () => {
      state.call.error = 'No microphone was found on this device.';
      return false;
    });
    const renderer = render();
    const trapOptions = () =>
      renderer.root.findAllByType(FocusTrap).map((trap) => trap.props.focusTrapOptions);
    const returnsFocus = () => trapOptions().map((options) => options.returnFocusOnDeactivate);
    const returnTargets = () => trapOptions().map((options) => options.setReturnFocus());

    act(() => headerButton(renderer).props.onClick(anchorEvent));
    expect(text(renderer)).toContain('Choose an agent to call');
    expect(returnsFocus()).toEqual([true]);
    expect(returnTargets()).toEqual([triggerNode]);
    const [menuReturnFocus] = trapOptions().map((options) => options.setReturnFocus);

    const items = renderer.root.findAll(
      (node) => node.type === 'button' && !node.props['aria-label']
    );
    await act(async () => items[0].props.onClick());
    expect(text(renderer)).toContain('No microphone was found on this device.');
    expect(returnsFocus()).toEqual([true]);
    // The menu item is gone, so the notice's trap would otherwise save BODY.
    expect(returnTargets()).toEqual([triggerNode]);

    act(() => renderer.unmount());
    expect(menuReturnFocus()).toBe(false);
  });
});
