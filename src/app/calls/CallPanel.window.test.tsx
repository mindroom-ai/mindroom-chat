// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { ActiveCall } from './callStore';
import type { CallParticipant, CallState } from './RoomCall';
import { CallPanel } from './CallPanel';
import { CallWindowFrameContext, type CallWindowFrame } from './window/callWindowFrame';
import {
  clearCallWindowStore,
  getCallWindowSettingsAtom,
  type CallWindowSettings,
} from './window/callWindowState';

// The call view's title bar in the floating window and in the docked panel: its buttons per
// mode, and the one-line bar the window shows while minimized.

const USER = '@me:panel.test';
const room = { roomId: '!standup:panel.test' } as Room;
const callRoom = { roomId: '!agent-call:panel.test' } as Room;

const calls = vi.hoisted(() => ({
  active: undefined as ActiveCall | undefined,
  state: undefined as CallState | undefined,
  members: [] as { userId: string }[],
}));
const navigation = vi.hoisted(() => ({ navigateRoom: vi.fn(), navigateRoomThread: vi.fn() }));
const leave = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:panel.test' }),
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({ useRoomName: () => 'Standup' }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
vi.mock('./agent/useCallFailureNotice', () => ({ useCallFailureNotice: () => undefined }));
vi.mock('./agent/useCallFailureDismissal', () => ({
  useCallFailureDismissal: () => ({ visibleFailure: undefined, dismissFailure: () => undefined }),
}));
vi.mock('./callSupport', () => ({
  browserSharesScreens: () => true,
  browserSupportsCalls: () => true,
  useCallSupport: () => 'supported',
}));
vi.mock('./callAccess', () => ({
  readCallAccess: () => ({ canJoin: true, canLetMembersIn: false }),
  allowMembersToCall: async () => undefined,
}));
vi.mock('./callMemberships', () => ({
  callUserIds: (members: { userId: string }[]) => members.map(({ userId }) => userId),
}));
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useActiveCall: () => calls.active,
  useCallState: () => calls.state,
  useRoomCallMembers: () => calls.members,
  useCallActions: () => ({
    endCall: leave,
    dismissCall: () => undefined,
    startCall: async () => 'started',
  }),
}));
vi.mock('./CallTile', () => ({
  useCallMemberProfile: (_room: Room, userId: string) => ({ name: userId }),
  CallMemberAvatar: ({ userId, size }: { userId: string; size?: string }) => (
    <span data-avatar={userId} data-size={size} />
  ),
  CallTile: ({ participant }: { participant: CallParticipant }) => (
    <li data-call-tile={participant.userId} />
  ),
  ScreenTile: () => null,
}));

const person = (userId: string, extra: Partial<CallParticipant> = {}): CallParticipant => ({
  key: `${userId}:DEVICE`,
  userId,
  deviceId: 'DEVICE',
  local: false,
  connected: true,
  speaking: false,
  microphone: true,
  ...extra,
});
const me = person(USER, { local: true });
const camera = {} as CallParticipant['video'];

const joined = (participants: CallParticipant[]): CallState => ({
  phase: 'connected',
  microphone: true,
  camera: false,
  screenShare: false,
  sound: true,
  audioBlocked: false,
  devices: {},
  participants,
});

const setMicrophone = vi.fn(async () => undefined);
const roomCall = (participants: CallParticipant[]) => {
  calls.active = { call: { room, setMicrophone } as unknown as ActiveCall['call'], kind: 'room' };
  calls.state = joined(participants);
};
const agentCall = (origin: { roomId: string; threadId?: string }) => {
  calls.active = {
    call: { room: callRoom, setMicrophone } as unknown as ActiveCall['call'],
    kind: 'agent',
    agentUserId: '@mindroom_helper:panel.test',
    origin,
  };
  calls.state = joined([me, person('@mindroom_helper:panel.test')]);
};

const frame = (bar = false): CallWindowFrame => ({
  bar,
  minimize: vi.fn(),
  expand: vi.fn(),
  handleProps: {
    'data-call-window-handle': '',
    tabIndex: 0,
    'aria-label': 'Move call window',
    role: 'group',
    onKeyDown: () => undefined,
  },
});

/** The route the person is on: Home unless a test opens a room (and a thread). */
type Place = { frame?: CallWindowFrame; size?: ScreenSize; panelRoom?: Room; route?: string };
let store = createStore();
const onClose = vi.fn();
const panel = (place: Place = {}) => {
  const { frame: inFrame, size = 'Desktop', panelRoom = room, route = '/home/' } = place;
  return (
    <Provider store={store}>
      <ScreenSizeProvider value={size}>
        <MemoryRouter initialEntries={[route]}>
          <CallWindowFrameContext.Provider value={inFrame}>
            <CallPanel room={panelRoom} onClose={onClose} />
          </CallWindowFrameContext.Provider>
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );
};
const roomRoute = (roomId: string, threadId?: string) =>
  `/home/${encodeURIComponent(roomId)}/${
    threadId ? `?threadId=${encodeURIComponent(threadId)}` : ''
  }`;
const renderPanel = (place: Place = {}) => render(panel(place));

const button = (name: string) => screen.queryByRole('button', { name });
// fireEvent runs in act already.
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const settings = (): CallWindowSettings => store.get(getCallWindowSettingsAtom(USER));

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  clearCallWindowStore(USER);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  calls.active = undefined;
  calls.state = undefined;
  calls.members = [];
});

describe('the call view title bar', () => {
  it('makes its header the window handle inside the frame, and only there', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame() });
    const handle = screen.getByRole('group', { name: 'Move call window' });
    expect(handle.tagName).toBe('HEADER');
    expect(handle.hasAttribute('data-call-window-handle')).toBe(true);
    expect(within(handle).getByRole('heading', { name: 'Standup' })).toBeTruthy();
    cleanup();

    renderPanel();
    expect(screen.queryByRole('group', { name: 'Move call window' })).toBeNull();
    expect(document.querySelector('[data-call-window-handle]')).toBeNull();
  });

  it('switches between speaker view and the grid while video shows, and only then', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame() });
    expect(button('Speaker view')).toBeNull();
    cleanup();

    roomCall([me, person('@ana:panel.test', { video: camera })]);
    renderPanel({ frame: frame() });
    const stage = () => document.querySelector('[data-call-stage]');
    const speakerSwitch = () => screen.getByRole('button', { name: 'Speaker view' });
    expect(stage()?.getAttribute('data-call-stage')).toBe('video');
    expect(stage()?.hasAttribute('data-speaker-view')).toBe(false);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('false');

    press('Speaker view');
    expect(stage()?.hasAttribute('data-speaker-view')).toBe(true);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
    press('Speaker view');
    expect(stage()?.hasAttribute('data-speaker-view')).toBe(false);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('false');
  });

  it('holds the speaker switch on, still named, while a shared screen keeps speaker view', () => {
    roomCall([me, person('@ana:panel.test', { video: camera, screen: camera })]);
    const inFrame = frame();
    const { rerender } = renderPanel({ frame: inFrame });
    const speakerSwitch = () => screen.getByRole('button', { name: 'Speaker view' });
    const speakerView = () =>
      document.querySelector('[data-call-stage]')?.hasAttribute('data-speaker-view');
    expect(speakerView()).toBe(true);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(speakerSwitch().getAttribute('aria-disabled')).toBe('true');

    // Held on, a press picks nothing: when the share ends, the grid comes back.
    press('Speaker view');
    roomCall([me, person('@ana:panel.test', { video: camera })]);
    rerender(panel({ frame: inFrame }));
    expect(speakerView()).toBe(false);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('false');
    expect(speakerSwitch().hasAttribute('aria-disabled')).toBe(false);
  });

  it('docks from the window and takes the person to the call room', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame() });
    expect(button('Float')).toBeNull();

    press('Dock to the side');
    expect(settings().mode).toBe('docked');
    expect(navigation.navigateRoom).toHaveBeenCalledWith(room.roomId);
    expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
  });

  it('docks an agent call into the conversation it started from, at its thread', () => {
    agentCall({ roomId: room.roomId, threadId: '$plan' });
    renderPanel({ frame: frame() });

    press('Dock to the side');
    expect(settings().mode).toBe('docked');
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(room.roomId, '$plan');
    expect(navigation.navigateRoom).not.toHaveBeenCalled();
  });

  it('docks a call not joined yet into its room', () => {
    calls.members = [{ userId: '@ana:panel.test' }];
    renderPanel({ frame: frame() });
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();

    press('Dock to the side');
    expect(settings().mode).toBe('docked');
    expect(navigation.navigateRoom).toHaveBeenCalledWith(room.roomId);
  });

  it('docks without moving the person who is in the room (and thread) already', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame(), route: roomRoute(room.roomId, '$other') });
    press('Dock to the side');
    expect(settings().mode).toBe('docked');
    expect(navigation.navigateRoom).not.toHaveBeenCalled();
    cleanup();

    agentCall({ roomId: room.roomId, threadId: '$plan' });
    renderPanel({ frame: frame(), route: roomRoute(room.roomId, '$plan') });
    press('Dock to the side');
    expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
    cleanup();

    // In the room but not in the agent call's thread, Dock opens that thread.
    renderPanel({ frame: frame(), route: roomRoute(room.roomId) });
    press('Dock to the side');
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(room.roomId, '$plan');
  });

  it('floats again from the docked panel on desktop, without moving the person', () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'docked' });
    roomCall([me, person('@ana:panel.test')]);
    renderPanel();
    expect(button('Dock to the side')).toBeNull();
    expect(button('Minimize')).toBeNull();

    press('Float');
    expect(settings().mode).toBe('floating');
    expect(navigation.navigateRoom).not.toHaveBeenCalled();
  });

  it('offers neither Dock nor Float on phones', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ size: 'Mobile' });
    expect(button('Dock to the side')).toBeNull();
    expect(button('Float')).toBeNull();
    expect(button('Minimize')).toBeNull();
    expect(button('Close call')).not.toBeNull();
  });

  it('minimizes the window from the title bar, and closes as before', () => {
    roomCall([me, person('@ana:panel.test')]);
    const inFrame = frame();
    renderPanel({ frame: inFrame });

    press('Minimize');
    expect(inFrame.minimize).toHaveBeenCalledOnce();
    press('Close call');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("goes to an agent call's conversation, at its thread when it has one", () => {
    agentCall({ roomId: room.roomId, threadId: '$plan' });
    renderPanel({ frame: frame() });
    press('Go to the conversation');
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(room.roomId, '$plan');
    expect(onClose).not.toHaveBeenCalled();
    cleanup();

    agentCall({ roomId: room.roomId });
    renderPanel({ frame: frame() });
    press('Go to the conversation');
    expect(navigation.navigateRoom).toHaveBeenCalledWith(room.roomId);
  });

  it('closes the call view that covers the conversation on phones when going there', () => {
    agentCall({ roomId: room.roomId, threadId: '$plan' });
    renderPanel({ size: 'Mobile' });
    press('Go to the conversation');
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(room.roomId, '$plan');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers no way to a conversation in a room call', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame() });
    expect(button('Go to the conversation')).toBeNull();
  });
});

describe('the minimized bar', () => {
  it('keeps the focus in the window when Minimize or Expand goes with its line', () => {
    roomCall([me, person('@ana:panel.test')]);
    const { rerender } = renderPanel({ frame: frame() });
    const handle = () => screen.getByRole('group', { name: 'Move call window' });

    screen.getByRole('button', { name: 'Minimize' }).focus();
    rerender(panel({ frame: frame(true) }));
    expect(document.activeElement).toBe(handle());
    expect(handle().hasAttribute('data-call-window-handle')).toBe(true);

    screen.getByRole('button', { name: 'Expand' }).focus();
    rerender(panel({ frame: frame() }));
    expect(document.activeElement).toBe(handle());
    expect(handle().tagName).toBe('HEADER');
  });

  it('shows three of the others, the speaking one marked, the title, the status, the microphone and leave', () => {
    roomCall([
      me,
      person('@ana:panel.test'),
      person('@bo:panel.test', { speaking: true }),
      person('@cy:panel.test'),
      person('@di:panel.test'),
    ]);
    const inFrame = frame(true);
    renderPanel({ frame: inFrame });

    const bar = screen.getByRole('group', { name: 'Move call window' });
    const faces = [...bar.querySelectorAll('[data-avatar]')];
    expect(faces.map((face) => face.getAttribute('data-avatar'))).toEqual([
      '@ana:panel.test',
      '@bo:panel.test',
      '@cy:panel.test',
    ]);
    expect(faces.every((face) => face.getAttribute('data-size') === '200')).toBe(true);
    const speaking = bar.querySelectorAll('[data-speaking="true"] [data-avatar]');
    expect([...speaking].map((face) => face.getAttribute('data-avatar'))).toEqual([
      '@bo:panel.test',
    ]);
    expect(within(bar).getByText('Standup')).toBeTruthy();
    expect(within(bar).getByText('5 people in the call')).toBeTruthy();

    // The stage, the control bar and the title bar's buttons wait for Expand.
    expect(document.querySelector('[data-call-stage]')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(button('Minimize')).toBeNull();

    fireEvent.click(within(bar).getByRole('button', { name: 'Turn Off Microphone' }));
    expect(setMicrophone).toHaveBeenCalledWith(false);
    fireEvent.click(within(bar).getByRole('button', { name: 'End' }));
    expect(leave).toHaveBeenCalledOnce();
    fireEvent.click(within(bar).getByRole('button', { name: 'Expand' }));
    expect(inFrame.expand).toHaveBeenCalledOnce();
  });

  it('shows only the title and Expand before the call is joined', () => {
    calls.members = [{ userId: '@ana:panel.test' }];
    renderPanel({ frame: frame(true) });

    const bar = screen.getByRole('group', { name: 'Move call window' });
    expect(within(bar).getByText('Standup')).toBeTruthy();
    expect(
      within(bar)
        .getAllByRole('button')
        .map((each) => each.getAttribute('aria-label'))
    ).toEqual(['Expand']);
    expect(button('Join')).toBeNull();
  });
});
