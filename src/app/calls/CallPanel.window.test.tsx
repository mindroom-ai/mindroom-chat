// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { IconButton } from 'folds';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { IconTooltipProps } from '../ui/IconTooltip';
import {
  callPanelRoomAtom,
  callStartProblemAtom,
  callViewStateAtom,
  type ActiveCall,
} from './callStore';
import type { CallDeviceKind, CallDevices, CallParticipant, CallState } from './RoomCall';
import { CallPanel } from './CallPanel';
import { ActiveCallTab } from './ActiveCallTab';
import { FloatingCallWindow } from './window/FloatingCallWindow';
import {
  CallWindowFrameContext,
  CallWindowSizeContext,
  type CallWindowFrame,
} from './window/callWindowFrame';
import { callTranscriptionAtom, liveTranscriptAtom } from './transcription/transcriptionState';
import { transcriptPanelAtom } from './transcription/transcriptPanel';
import { hasShortcutHandler, runShortcut } from '../shortcuts/useShortcut';
import {
  clearCallWindowStore,
  getCallWindowSettingsAtom,
  type CallWindowSettings,
} from './window/callWindowState';

// The call view's title bar in the floating window and in the docked panel: its buttons per
// mode, and the one-line bar the window shows while minimized; and the call's controls.

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
const dismiss = vi.hoisted(() => vi.fn());
const start = vi.hoisted(() => vi.fn(async (_options: unknown) => 'started' as const));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:panel.test' }),
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({ useRoomName: () => 'Standup' }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => [] }));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
// A button named in a tooltip says which side the tooltip opens on.
vi.mock('../ui/IconTooltip', () => ({
  IconTooltip: ({ position = 'Bottom', children }: IconTooltipProps) =>
    children((anchor) => anchor?.setAttribute('data-tooltip', position)),
}));
// The notice an agent posts when it joined but cannot hear or speak, while a test shows one.
const failures = vi.hoisted(() => ({
  visible: undefined as { eventId: string; message: string } | undefined,
}));
vi.mock('./agent/useCallFailureNotice', () => ({ useCallFailureNotice: () => failures.visible }));
vi.mock('../computer/useRoomMindroomServer', () => ({
  useRoomMindroomServer: () => ({ apiUrl: undefined, discovered: false }),
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
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useActiveCall: () => calls.active,
  useCallState: () => calls.state,
  // This device's call is on while it connects, is connected or reconnects.
  useInCall: () => ['connecting', 'connected', 'reconnecting'].includes(calls.state?.phase ?? ''),
  useRoomCallMembers: () => calls.members,
  useCallActions: () => ({
    endCall: leave,
    dismissCall: dismiss,
    startCall: start,
  }),
}));
// The device menu lists the browser's devices; here it picks a second microphone at once.
vi.mock('./CallControls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./CallControls')>()),
  DeviceControl: ({
    chosen,
    onChoose,
  }: {
    chosen: CallDevices;
    onChoose: (kind: CallDeviceKind, deviceId: string) => void;
  }) => (
    <button
      type="button"
      aria-label="Settings"
      data-microphone={chosen.audioinput}
      onClick={() => onChoose('audioinput', 'second-mic')}
    />
  ),
}));
vi.mock('./CallTile', () => ({
  useCallMemberProfile: (_room: Room, userId: string) => ({ name: userId }),
  CallMemberAvatar: ({ userId, size }: { userId: string; size?: string }) => (
    <span data-avatar={userId} data-size={size} />
  ),
  CallTile: ({ participant }: { participant: CallParticipant }) => (
    <li data-call-tile={participant.userId} />
  ),
  ScreenTile: ({ participant }: { participant: CallParticipant }) => (
    <li data-call-screen={participant.userId} />
  ),
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

// The handle's props as the floating window gives them (FloatingCallWindow.test.tsx).
const frame = (bar = false): CallWindowFrame => ({
  bar,
  minimize: vi.fn(),
  expand: vi.fn(),
  handleProps: {
    'data-call-window-handle': '',
    tabIndex: 0,
    'aria-label': bar ? 'Move minimized call window' : 'Move call window',
    'aria-keyshortcuts': 'ArrowUp',
    role: 'group',
    onKeyDown: () => undefined,
  },
  titleId: 'call-window-title',
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
            <CallWindowSizeContext.Provider value={inFrame && { width: 400, height: 480 }}>
              <CallPanel room={panelRoom} onClose={onClose} />
            </CallWindowSizeContext.Provider>
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
/** The call view in the floating window itself, rather than in a stand-in frame. */
const renderInWindow = () =>
  render(
    <Provider store={store}>
      <ScreenSizeProvider value="Desktop">
        <MemoryRouter>
          <FloatingCallWindow>
            <CallPanel room={room} onClose={onClose} />
          </FloatingCallWindow>
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );

/** The rail's call button, for the call in `calls.active`, and a press of it from the keyboard. */
const rail = () => screen.getByRole('button', { name: 'Return to the call in Standup' });
const pressRail = () => {
  rail().focus();
  fireEvent.click(rail());
};
const renderRail = () =>
  render(
    <Provider store={store}>
      <ScreenSizeProvider value="Desktop">
        <ActiveCallTab active={calls.active!} />
      </ScreenSizeProvider>
    </Provider>
  );

const button = (name: string) => screen.queryByRole('button', { name });
// fireEvent runs in act already.
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const settings = (): CallWindowSettings => store.get(getCallWindowSettingsAtom(USER));
const speakerSwitch = () => screen.getByRole('button', { name: 'Speaker view' });
const speakerView = () =>
  document.querySelector('[data-call-stage]')?.hasAttribute('data-speaker-view');
/** Whose screens and whose tiles the stage shows, in its order. */
const screensShown = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-call-screen]'), ({ dataset }) => {
    return dataset.callScreen;
  });
const tilesShown = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-call-tile]'), ({ dataset }) => {
    return dataset.callTile;
  });

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
  failures.visible = undefined;
});

describe('the call view title bar', () => {
  it('makes its header the window handle inside the frame, and only there', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame() });
    const handle = screen.getByRole('group', { name: 'Move call window' });
    expect(handle.tagName).toBe('HEADER');
    expect(handle.hasAttribute('data-call-window-handle')).toBe(true);
    // Read out as it changes.
    expect(within(handle).getByText('2 people in the call').getAttribute('aria-live')).toBe(
      'polite'
    );
    // The window's handle takes the focus handed to the window, not its title.
    const heading = within(handle).getByRole('heading', { name: 'Standup' });
    expect(heading.hasAttribute('tabindex')).toBe(false);
    cleanup();

    renderPanel();
    expect(screen.queryByRole('group', { name: 'Move call window' })).toBeNull();
    expect(document.querySelector('[data-call-window-handle]')).toBeNull();
    const header = screen.getByTestId('call-panel').querySelector('header')!;
    expect(within(header).getByText('2 people in the call')).toBeTruthy();
    expect(within(header).getByRole('heading', { name: 'Standup' }).tabIndex).toBe(-1);
  });

  it('is no landmark of its own in the window, whose one landmark its title names', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderInWindow();
    const [region, ...more] = screen.getAllByRole('region');
    expect(more).toHaveLength(0);
    expect(region).toBe(screen.getByTestId('call-window'));
    expect(screen.getByRole('region', { name: 'Standup' })).toBe(region);
    expect(within(region!).getByTestId('call-panel').tagName).toBe('DIV');

    // Minimized, the same.
    act(() => {
      store.set(getCallWindowSettingsAtom(USER), {
        mode: 'floating',
        rect: { x: 600, y: 704, width: 400, height: 56 },
      });
    });
    expect(screen.getByTestId('call-window').hasAttribute('data-bar')).toBe(true);
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Standup' })).toBe(region);
    cleanup();

    // The docked panel is the landmark, named by the call.
    renderPanel();
    expect(screen.getByRole('region', { name: 'Standup' })).toBe(screen.getByTestId('call-panel'));
  });

  it('switches between speaker view and the grid while video shows, and only then', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame() });
    expect(button('Speaker view')).toBeNull();
    cleanup();

    roomCall([me, person('@ana:panel.test', { video: camera })]);
    renderPanel({ frame: frame() });
    const stage = () => document.querySelector('[data-call-stage]');
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

  it("opens speaker view for someone else's screen, and the switch leaves it for the grid and back", () => {
    const ana = person('@ana:panel.test', { video: camera });
    const bo = person('@bo:panel.test', { video: camera });
    roomCall([me, { ...ana, screen: camera }, bo]);
    const inFrame = frame();
    const { rerender } = renderPanel({ frame: inFrame });
    expect(speakerView()).toBe(true);
    expect(screensShown()).toEqual([ana.userId]);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(speakerSwitch().hasAttribute('aria-disabled')).toBe(false);

    // The grid: the screen as a row over every camera.
    press('Speaker view');
    expect(speakerView()).toBe(false);
    expect(screensShown()).toEqual([ana.userId]);
    expect(tilesShown()).toEqual([USER, ana.userId, bo.userId]);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('false');
    press('Speaker view');
    expect(speakerView()).toBe(true);
    press('Speaker view');
    expect(speakerView()).toBe(false);

    // The share ends: the call's own pick, the grid. A new share opens speaker view again.
    roomCall([me, ana, bo]);
    rerender(panel({ frame: inFrame }));
    expect(speakerView()).toBe(false);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('false');
    roomCall([me, ana, { ...bo, screen: camera }]);
    rerender(panel({ frame: inFrame }));
    expect(speakerView()).toBe(true);
    expect(screensShown()).toEqual([bo.userId]);
  });

  it('shows a lone own screen in the grid with every camera, the switch free', () => {
    const ana = person('@ana:panel.test', { video: camera });
    roomCall([{ ...me, video: camera, screen: camera }, ana]);
    renderPanel({ frame: frame() });
    expect(speakerView()).toBe(false);
    expect(screensShown()).toEqual([USER]);
    expect(tilesShown()).toEqual([USER, ana.userId]);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('false');
    expect(speakerSwitch().hasAttribute('aria-disabled')).toBe(false);

    // Speaker view puts the other person in focus, not the own screen.
    press('Speaker view');
    expect(speakerView()).toBe(true);
    expect(screensShown()).toEqual([]);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
  });

  it('shows two or more shared screens in rows, the switch free to speaker view and back', () => {
    const ana = person('@ana:panel.test', { screen: camera });
    roomCall([me, ana, person('@bo:panel.test', { screen: camera })]);
    const inFrame = frame();
    const { rerender } = renderPanel({ frame: inFrame });
    expect(screensShown()).toEqual([ana.userId, '@bo:panel.test']);
    expect(speakerView()).toBe(false);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('false');
    expect(speakerSwitch().hasAttribute('aria-disabled')).toBe(false);

    press('Speaker view');
    expect(speakerView()).toBe(true);
    expect(screensShown()).toEqual([ana.userId]);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
    press('Speaker view');
    expect(speakerView()).toBe(false);

    // One screen left: speaker view shows it, and the switch says so.
    roomCall([me, ana, person('@bo:panel.test')]);
    rerender(panel({ frame: inFrame }));
    expect(speakerView()).toBe(true);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(speakerSwitch().hasAttribute('aria-disabled')).toBe(false);
  });

  it('holds the switch on speaker view while grid tiles would be too small', () => {
    // The stage hears it is 300 by 120 px: four tiles would be under 100 px wide.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}

        observe(target: Element) {
          const contentRect = { width: 300, height: 120 } as DOMRectReadOnly;
          this.callback(
            [{ target, contentRect } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          );
        }

        disconnect() {}
      }
    );
    const others = ['@ana:panel.test', '@bo:panel.test', '@cy:panel.test'].map((userId) =>
      person(userId, { video: camera })
    );
    roomCall([me, ...others]);
    renderPanel({ frame: frame() });
    expect(speakerView()).toBe(true);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(speakerSwitch().getAttribute('aria-disabled')).toBe('true');

    // Held, a press picks nothing.
    press('Speaker view');
    expect(speakerView()).toBe(true);
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(store.get(callViewStateAtom).size).toBe(0);
  });

  it('keeps the pick wherever the call view moves and when it opens again, for the call and for the screens shared', () => {
    roomCall([me, person('@ana:panel.test', { video: camera })]);
    const inWindow = renderPanel({ frame: frame() });
    press('Speaker view');
    expect(speakerView()).toBe(true);
    // Docked, floating again, or closed and opened again, the call view mounts anew.
    inWindow.unmount();
    const docked = renderPanel();
    expect(speakerView()).toBe(true);
    docked.unmount();
    const again = renderPanel({ frame: frame() });
    expect(speakerSwitch().getAttribute('aria-pressed')).toBe('true');
    again.unmount();

    // Ana shares her screen, which opens speaker view; the grid picked for it stays too.
    roomCall([me, person('@ana:panel.test', { video: camera, screen: camera })]);
    const sharing = renderPanel({ frame: frame() });
    expect(speakerView()).toBe(true);
    press('Speaker view');
    expect(speakerView()).toBe(false);
    sharing.unmount();
    renderPanel();
    expect(speakerView()).toBe(false);
  });

  it('docks from the window and takes the person to the call room', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame() });
    expect(button('Float')).toBeNull();

    // Its icon points to the side, which mirrors in right-to-left languages.
    const icon = (name: string) => button(name)?.querySelector('[data-directional]');
    expect(icon('Dock to the side')).not.toBeNull();
    expect(icon('Minimize')).toBeNull();

    press('Dock to the side');
    expect(settings().mode).toBe('docked');
    expect(store.get(callPanelRoomAtom)).toBe(room.roomId);
    expect(navigation.navigateRoom).toHaveBeenCalledWith(room.roomId);
    expect(navigation.navigateRoomThread).not.toHaveBeenCalled();
  });

  it('docks an agent call into the conversation it started from, at its thread', () => {
    agentCall({ roomId: room.roomId, threadId: '$plan' });
    renderPanel({ frame: frame() });

    press('Dock to the side');
    expect(settings().mode).toBe('docked');
    // The docked panel shows in the conversation's room, not in the agent's call room.
    expect(store.get(callPanelRoomAtom)).toBe(room.roomId);
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
    expect(button('Float')?.querySelector('[data-directional]')).not.toBeNull();

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
    expect(button('Close call view')).not.toBeNull();
  });

  it('minimizes the window from the title bar, and closes as before', () => {
    roomCall([me, person('@ana:panel.test')]);
    const inFrame = frame();
    renderPanel({ frame: inFrame });

    const sides = ['Dock to the side', 'Minimize', 'Close call view'].map(
      (name) => button(name)?.dataset.tooltip
    );
    expect(sides).toEqual(['Bottom', 'Bottom', 'Bottom']);

    press('Minimize');
    expect(inFrame.minimize).toHaveBeenCalledOnce();
    press('Close call view');
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

describe('the control bar', () => {
  it('offers the camera and screen sharing in an agent call too', () => {
    agentCall({ roomId: room.roomId });
    renderPanel();

    const controls = screen.getByRole('toolbar', { name: 'Standup' });
    expect(within(controls).getByRole('button', { name: 'Start Camera' })).toBeTruthy();
    expect(within(controls).getByRole('button', { name: 'Start Screenshare' })).toBeTruthy();
  });
});

describe('the prescreen as the call view moves', () => {
  const microphonePick = () =>
    screen.getByRole('button', { name: 'Settings' }).getAttribute('data-microphone');

  it('keeps the microphone, camera and devices picked when it docks, and joins with them', () => {
    calls.members = [{ userId: '@ana:panel.test' }];
    const inWindow = renderPanel({ frame: frame() });
    press('Turn Off Microphone');
    press('Start Camera');
    press('Settings');
    expect(microphonePick()).toBe('second-mic');

    press('Dock to the side');
    inWindow.unmount();
    renderPanel();
    expect(button('Turn On Microphone')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Stop Camera')?.getAttribute('aria-pressed')).toBe('true');
    expect(microphonePick()).toBe('second-mic');

    press('Join');
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        microphone: false,
        video: true,
        devices: { audioinput: 'second-mic' },
      })
    );
  });

  it('keeps them when it floats again and on a phone, for its own room only', () => {
    store.set(getCallWindowSettingsAtom(USER), { mode: 'docked' });
    store.set(callPanelRoomAtom, room.roomId);
    const docked = renderPanel();
    press('Turn Off Microphone');
    press('Float');
    docked.unmount();

    const inWindow = renderPanel({ frame: frame() });
    expect(button('Turn On Microphone')).not.toBeNull();
    inWindow.unmount();
    const onPhone = renderPanel({ size: 'Mobile' });
    expect(button('Turn On Microphone')).not.toBeNull();
    onPhone.unmount();

    // Another room's prescreen starts from the defaults.
    renderPanel({ panelRoom: callRoom });
    expect(button('Turn Off Microphone')).not.toBeNull();
    expect(button('Start Camera')).not.toBeNull();
  });
  it('keeps why Join did nothing when it docks, and forgets it once the view closes', () => {
    calls.members = [{ userId: '@ana:panel.test' }];
    store.set(callPanelRoomAtom, room.roomId);
    const busy = () => screen.queryByText(/Already in another call/);
    const inWindow = renderPanel({ frame: frame() });
    // Join answered busy: another tab of this session is in a call.
    act(() => store.set(callStartProblemAtom, { roomId: room.roomId, result: 'busy' }));
    expect(busy()).not.toBeNull();

    press('Dock to the side');
    inWindow.unmount();
    const docked = renderPanel();
    expect(busy()).not.toBeNull();

    // Close, as the host does it: the open call view is no room's.
    act(() => store.set(callPanelRoomAtom, undefined));
    docked.unmount();
    act(() => store.set(callPanelRoomAtom, room.roomId));
    renderPanel();
    expect(busy()).toBeNull();
  });
});

describe('the focus after Dock and Float', () => {
  const title = () => screen.getByRole('heading', { name: 'Standup' });

  it("goes to the docked panel's title after Dock, and to the window's handle after Float", () => {
    roomCall([me, person('@ana:panel.test')]);
    const inWindow = renderPanel({ frame: frame() });
    screen.getByRole('button', { name: 'Dock to the side' }).focus();
    press('Dock to the side');
    // The window goes with the button, and the room's side panel shows the call view.
    inWindow.unmount();
    expect(document.activeElement).toBe(document.body);
    renderPanel();
    expect(document.activeElement).toBe(title());

    // The docked panel moves out while the window opens, its Float button still focused.
    screen.getByRole('button', { name: 'Float' }).focus();
    press('Float');
    render(panel({ frame: frame() }));
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Move call window' }));
  });

  it('hands the focus over once, not to the docked panel when it opens again', () => {
    roomCall([me, person('@ana:panel.test')]);
    const inWindow = renderPanel({ frame: frame() });
    screen.getByRole('button', { name: 'Dock to the side' }).focus();
    press('Dock to the side');
    inWindow.unmount();
    const docked = renderPanel();
    expect(document.activeElement).toBe(title());

    // Another room shown and this one again: the panel mounts anew, the focus on the page.
    docked.unmount();
    renderPanel();
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves the focus where it is when the call view opens otherwise', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame() });
    expect(document.activeElement).toBe(document.body);
    cleanup();

    renderPanel();
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves the focus to whatever has it when the call view arrives', () => {
    roomCall([me, person('@ana:panel.test')]);
    const inWindow = renderPanel({ frame: frame() });
    press('Dock to the side');
    inWindow.unmount();
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    elsewhere.focus();
    renderPanel();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

describe("the focus after the rail's call button", () => {
  const handle = () => screen.getByRole('group', { name: 'Move call window' });

  it("goes to the window's handle when the button opens the window", () => {
    roomCall([me, person('@ana:panel.test')]);
    renderRail();
    pressRail();
    // The window opens with the call view in it.
    render(panel({ frame: frame() }));
    expect(document.activeElement).toBe(handle());
  });

  it('goes to the handle of a window that shows already', () => {
    roomCall([me, person('@ana:panel.test')]);
    renderRail();
    renderPanel({ frame: frame() });
    pressRail();
    expect(document.activeElement).toBe(handle());
  });

  it('goes to the handle of a window the button expands from its bar', () => {
    roomCall([me, person('@ana:panel.test')]);
    const bar = { x: 600, y: 704, width: 400, height: 56 };
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', rect: bar });
    renderRail();
    renderInWindow();
    const callWindow = screen.getByTestId('call-window');
    expect(callWindow.hasAttribute('data-bar')).toBe(true);

    pressRail();
    expect(callWindow.hasAttribute('data-bar')).toBe(false);
    expect(document.activeElement).toBe(handle());
  });
});

describe('the shortcut to the call view', () => {
  /** ⌘⇧L or Ctrl+Shift+L, as the app's one window listener hands it on (ShortcutRoot). */
  const goToCall = () => {
    let acted = false;
    act(() => {
      acted = runShortcut('callView', new KeyboardEvent('keydown', { key: 'L' }));
    });
    return acted;
  };
  /** The focus is on the page, far from the call view: in the composer, say. */
  const typing = () => {
    const composer = document.createElement('textarea');
    document.body.prepend(composer);
    composer.focus();
    return composer;
  };
  afterEach(() => document.querySelectorAll('textarea').forEach((composer) => composer.remove()));

  it("goes to the floating window's handle, also while it is minimized to its bar", () => {
    roomCall([me, person('@ana:panel.test')]);
    const { rerender } = renderPanel({ frame: frame() });
    typing();
    expect(goToCall()).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Move call window' }));

    rerender(panel({ frame: frame(true) }));
    typing();
    expect(goToCall()).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole('group', { name: 'Move minimized call window' })
    );
  });

  it.each(['Desktop', 'Mobile'] as const)(
    "goes to the title of the call view in the room's side panel (%s)",
    (size) => {
      roomCall([me, person('@ana:panel.test')]);
      renderPanel({ size });
      typing();
      expect(goToCall()).toBe(true);
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Standup' }));
    }
  );

  it('leaves the key to the browser while no call view shows, or when it cannot take the focus', () => {
    roomCall([me, person('@ana:panel.test')]);
    expect(hasShortcutHandler('callView')).toBe(false);

    // The docked panel folded to its tab at the room's edge shows nothing to focus.
    renderPanel();
    const title = screen.getByRole('heading', { name: 'Standup' });
    vi.spyOn(title, 'focus').mockImplementation(() => undefined);
    const composer = typing();
    expect(goToCall()).toBe(false);
    expect(document.activeElement).toBe(composer);

    cleanup();
    expect(hasShortcutHandler('callView')).toBe(false);
  });
});

describe('the minimized bar', () => {
  it('keeps the focus in the window when Minimize or Expand goes with its line', () => {
    roomCall([me, person('@ana:panel.test')]);
    const { rerender } = renderPanel({ frame: frame() });
    const handle = () => screen.getByRole('group', { name: /^Move (minimized )?call window$/ });

    screen.getByRole('button', { name: 'Minimize' }).focus();
    rerender(panel({ frame: frame(true) }));
    expect(document.activeElement).toBe(handle());
    expect(handle().hasAttribute('data-call-window-handle')).toBe(true);
    expect(handle().getAttribute('aria-label')).toBe('Move minimized call window');

    screen.getByRole('button', { name: 'Expand' }).focus();
    rerender(panel({ frame: frame() }));
    expect(document.activeElement).toBe(handle());
    expect(handle().tagName).toBe('HEADER');
  });

  it('leaves the focus that is elsewhere when the window minimizes or expands', () => {
    roomCall([me, person('@ana:panel.test')]);
    const { rerender } = renderPanel({ frame: frame() });
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    elsewhere.focus();

    rerender(panel({ frame: frame(true) }));
    expect(document.activeElement).toBe(elsewhere);
    rerender(panel({ frame: frame() }));
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
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

    const bar = screen.getByRole('group', { name: 'Move minimized call window' });
    const faces = [...bar.querySelectorAll('[data-avatar]')];
    expect(faces.map((face) => face.getAttribute('data-avatar'))).toEqual([
      '@ana:panel.test',
      '@bo:panel.test',
      '@cy:panel.test',
    ]);
    expect(faces.every((face) => face.getAttribute('data-size') === '200')).toBe(true);
    const list = within(bar).getByRole('list', { name: 'People in the call' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((face) => face.getAttribute('aria-label'))
    ).toEqual(['@ana:panel.test', '@bo:panel.test', '@cy:panel.test']);
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

    const buttons = within(bar).getAllByRole('button');
    const names = buttons.map((each) => each.getAttribute('aria-label'));
    expect(names).toEqual(['Turn Off Microphone', 'End', 'Expand', 'Close call view']);
    // The line sits low on the screen, so its buttons are named above it.
    expect(buttons.map((each) => each.dataset.tooltip)).toEqual(['Top', 'Top', 'Top', 'Top']);

    fireEvent.click(within(bar).getByRole('button', { name: 'Turn Off Microphone' }));
    expect(setMicrophone).toHaveBeenCalledWith(false);
    fireEvent.click(within(bar).getByRole('button', { name: 'End' }));
    expect(leave).toHaveBeenCalledOnce();
    fireEvent.click(within(bar).getByRole('button', { name: 'Expand' }));
    expect(inFrame.expand).toHaveBeenCalledOnce();
    fireEvent.click(within(bar).getByRole('button', { name: 'Close call view' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows no list of faces to someone alone in the call', () => {
    roomCall([me]);
    renderPanel({ frame: frame(true) });

    const bar = screen.getByRole('group', { name: 'Move minimized call window' });
    expect(within(bar).queryByRole('list', { name: 'People in the call' })).toBeNull();
    expect(within(bar).getByText('Standup')).toBeTruthy();
  });

  it('shows the agent an agent call waits for, as the stage does', () => {
    agentCall({ roomId: room.roomId });
    calls.state = { ...joined([me]), phase: 'connecting' };
    renderPanel({ frame: frame(true) });

    const bar = screen.getByRole('group', { name: 'Move minimized call window' });
    expect(
      [...bar.querySelectorAll('[data-avatar]')].map((face) => face.getAttribute('data-avatar'))
    ).toEqual(['@mindroom_helper:panel.test']);
  });

  it.each([
    [
      'the browser blocks the sound',
      'Play sound',
      () => {
        calls.state = {
          ...joined([me, person('@mindroom_helper:panel.test')]),
          audioBlocked: true,
        };
      },
    ],
    [
      'the agent posts that it cannot hear',
      'Dismiss voice call error',
      () => {
        failures.visible = { eventId: '$deaf', message: 'Voice call error: no audio arrives' };
      },
    ],
  ])('expands when %s, so the notice and its action show', (_problem, action, comesUp) => {
    agentCall({ roomId: room.roomId });
    // The window's Expand is one function, minimized or not.
    const expand = vi.fn();
    const asBar = { ...frame(true), expand };
    const expanded = { ...frame(), expand };
    const { rerender } = renderPanel({ frame: asBar });
    expect(expand).not.toHaveBeenCalled();

    comesUp();
    rerender(panel({ frame: asBar }));
    expect(expand).toHaveBeenCalledOnce();
    rerender(panel({ frame: expanded }));
    expect(screen.getByRole('button', { name: action })).toBeTruthy();

    // Minimized again while the problem stands, it stays a bar.
    rerender(panel({ frame: asBar }));
    expect(expand).toHaveBeenCalledOnce();
  });

  it("shows someone on two devices once, and this person's other device not at all", () => {
    const phone = { key: 'PHONE', deviceId: 'PHONE' };
    roomCall([
      me,
      person('@ana:panel.test'),
      person('@ana:panel.test', { ...phone, speaking: true }),
      person(USER, phone),
      person('@bo:panel.test'),
    ]);
    renderPanel({ frame: frame(true) });

    const bar = screen.getByRole('group', { name: 'Move minimized call window' });
    const faces = [...bar.querySelectorAll('[data-avatar]')];
    expect(faces.map((face) => face.getAttribute('data-avatar'))).toEqual([
      '@ana:panel.test',
      '@bo:panel.test',
    ]);
    expect(faces[0]?.closest('[data-speaking]')?.getAttribute('data-speaking')).toBe('true');
  });

  it.each([
    ['failed', 'connection', "The call's connection was lost."],
    ['ended', undefined, 'The call ended.'],
  ] as const)(
    'says in the bar why the call stopped (%s) and offers Close in place of the microphone and leave',
    (phase, problem, said) => {
      roomCall([me, person('@ana:panel.test')]);
      calls.state = { ...joined([me, person('@ana:panel.test')]), phase, problem };
      renderPanel({ frame: frame(true) });

      const bar = screen.getByRole('group', { name: 'Move minimized call window' });
      expect(within(bar).getByText(said)).toBeTruthy();
      const names = within(bar)
        .getAllByRole('button')
        .map((each) => each.textContent || each.getAttribute('aria-label'));
      // Close drops the finished call, as the expanded view's Close does, so new calls can start;
      // the window closes with it, so the bar has no Close call view beside it.
      expect(names).toEqual(['Close', 'Expand']);
      fireEvent.click(within(bar).getByRole('button', { name: 'Close' }));
      expect(dismiss).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();
    }
  );

  it('says in the bar why the microphone it turned on stays off, keeping the controls', () => {
    roomCall([me, person('@ana:panel.test')]);
    calls.state = {
      ...joined([me, person('@ana:panel.test')]),
      microphone: false,
      problem: 'device',
    };
    renderPanel({ frame: frame(true) });

    const bar = screen.getByRole('group', { name: 'Move minimized call window' });
    expect(within(bar).getByText('Your microphone or camera could not be used.')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Turn On Microphone' })).toBeTruthy();
    cleanup();

    // Expanded, the notice over the stage says the same.
    renderPanel({ frame: frame() });
    const said = screen.getByText('Your microphone or camera could not be used.');
    expect(said.closest('[role="status"]')).not.toBeNull();
  });

  it('shows only the title, Expand and Close before the call is joined', () => {
    calls.members = [{ userId: '@ana:panel.test' }];
    renderPanel({ frame: frame(true) });

    const bar = screen.getByRole('group', { name: 'Move minimized call window' });
    expect(within(bar).getByText('Standup')).toBeTruthy();
    expect(within(bar).queryByText('1 person in the call')).toBeNull();
    expect(
      within(bar)
        .getAllByRole('button')
        .map((each) => each.getAttribute('aria-label'))
    ).toEqual(['Expand', 'Close call view']);
    expect(button('Join')).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: 'Close call view' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  /** The classes folds gives an icon button of the bar at `size`. */
  const iconButtonClass = (size: '300' | '400', variant: 'Surface' | 'Critical') => {
    const { container, unmount } = render(<IconButton size={size} radii="300" variant={variant} />);
    const className = container.querySelector('button')?.className;
    unmount();
    return className;
  };

  it.each([
    ['a touch screen', true, '400'],
    ['a mouse', false, '300'],
  ] as const)('sizes the microphone and leave buttons for %s', (_pointer, coarse, size) => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: coarse && query === '(pointer: coarse)',
    }));
    roomCall([me, person('@ana:panel.test')]);
    renderPanel({ frame: frame(true) });
    const bar = screen.getByRole('group', { name: 'Move minimized call window' });
    const named = (name: string) => within(bar).getByRole('button', { name }).className;
    expect(named('Turn Off Microphone')).toBe(iconButtonClass(size, 'Surface'));
    expect(named('End')).toBe(iconButtonClass(size, 'Critical'));
    expect(named('Expand')).toBe(iconButtonClass('300', 'Surface'));
  });
});

describe('the live transcript in the window', () => {
  /** MindRoom transcribes the room's call, nothing said yet, and the account shows the transcript. */
  const transcribed = () => {
    store.set(callTranscriptionAtom, { roomId: room.roomId, status: 'transcribing' });
    store.set(liveTranscriptAtom, {
      roomId: room.roomId,
      call: {
        id: 'call-1',
        roomId: room.roomId,
        rowEventId: '$row',
        startedAt: '2026-11-07T09:29:00Z',
        endedAt: null,
        members: [USER, '@ana:panel.test'],
        pausedBy: null,
      },
      lines: [],
      names: {},
    });
    store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', transcript: true });
  };
  const transcript = () => document.querySelector('[data-call-window-transcript]');

  it('shows with the stage in the expanded window, its switch in the controls pressed', () => {
    roomCall([me, person('@ana:panel.test')]);
    transcribed();
    renderPanel({ frame: frame() });
    const split = document.querySelector('[data-call-transcript-layout]');
    expect(split?.getAttribute('data-call-transcript-layout')).toBe('stacked');
    expect(split?.querySelector('[data-call-stage]')).not.toBeNull();
    expect(transcript()?.textContent).toContain('Nothing has been said yet.');
    const toggle = screen.getByRole('button', { name: 'Live transcript' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    press('Live transcript');
    expect(settings().transcript).toBe(false);
    expect(transcript()).toBeNull();
    expect(document.querySelector('[data-call-stage]')).not.toBeNull();
  });

  it("leaves the focus the rail's call button hands the window to its handle, not the transcript", () => {
    roomCall([me, person('@ana:panel.test')]);
    transcribed();
    renderPanel({ frame: frame() });
    renderRail();
    pressRail();
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Move call window' }));
  });

  it("names the transcript without a landmark of its own: the window is the call view's one", () => {
    roomCall([me, person('@ana:panel.test')]);
    transcribed();
    renderInWindow();
    expect(transcript()).not.toBeNull();
    expect(screen.getAllByRole('region')).toEqual([screen.getByTestId('call-window')]);
    expect(screen.getByRole('group', { name: 'Live transcript' })).toBe(transcript()?.firstChild);
  });

  it("hides with its switch, leaving the room's side transcript alone", () => {
    roomCall([me, person('@ana:panel.test')]);
    transcribed();
    renderPanel({ frame: frame() });
    const side = { roomId: room.roomId, replacedCall: false };
    act(() => store.set(transcriptPanelAtom, side));

    press('Live transcript');
    expect(settings().transcript).toBe(false);
    expect(store.get(transcriptPanelAtom)).toEqual(side);
  });

  it('shows neither in the bar nor in the docked panel', () => {
    roomCall([me, person('@ana:panel.test')]);
    transcribed();
    renderPanel({ frame: frame(true) });
    expect(transcript()).toBeNull();
    cleanup();

    store.set(getCallWindowSettingsAtom(USER), { mode: 'docked', transcript: true });
    renderPanel();
    expect(transcript()).toBeNull();
    expect(document.querySelector('[data-call-transcript-layout]')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Live transcript' }).hasAttribute('aria-pressed')
    ).toBe(false);
  });
});
