// @vitest-environment jsdom
/**
 * Component-level End behavior across BOTH surfaces (CINNY-129): the in-room
 * `CallControls` and the persistent status `CallControl`, mounted like
 * `CallEmbedProvider` mounts them — real `useCallTerminationController`, real
 * `CallTerminationContext`, real jotai store and `callEmbedAtom` setter (so
 * cleanup-generation claiming is exercised end to end). Only presentation
 * shells (folds, vanilla-extract styles) and the Matrix client are mocked.
 */
import React, { ReactNode } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Provider, createStore, useAtomValue } from 'jotai';

const mocks = vi.hoisted(() => {
  const mx = {
    getUserId: () => '@alice:mindroom.test',
    getSafeUserId: () => '@alice:mindroom.test',
    getDeviceId: () => 'HOSTDEV',
    sendStateEvent: vi.fn(async () => ({})),
    kick: vi.fn(async () => ({})),
    leave: vi.fn(async () => ({})),
    forget: vi.fn(async () => ({})),
    getRoom: vi.fn(() => null),
    // CallEmbedProvider's incoming-call listener subscribes to timeline events.
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const navigateRoom = vi.fn();
  return { mx, navigateRoom };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.mx,
}));

// The real useTheme drags in vanilla-extract styles that cannot load in vitest.
vi.mock('../../hooks/useTheme', () => ({
  ThemeKind: { Dark: 'dark', Light: 'light' },
  useTheme: () => ({ id: 'dark-theme', kind: 'dark', classNames: [] }),
}));

vi.mock('./styles.css', () => ({
  CallControlContainer: 'call-control-container',
  ControlCard: 'control-card',
}));

vi.mock('./Controls', () => ({
  ChatButton: () => null,
  ControlDivider: () => null,
  MicrophoneButton: () => null,
  ScreenShareButton: () => null,
  SoundButton: () => null,
  VideoButton: () => null,
}));

vi.mock('../call-status/components', () => ({
  StatusDivider: () => null,
}));

// The provider-level smoke test mounts the REAL CallEmbedProvider; only its
// presentation shells and router/screen-size/RTC-session environment are
// mocked so the termination wiring under test stays production code.
vi.mock('../../hooks/router/useSelectedRoom', () => ({
  useSelectedRoomResolution: () => ({ roomId: undefined }),
  useSelectedRoom: () => undefined,
}));

vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop', Tablet: 'Tablet', Mobile: 'Mobile' },
  useScreenSizeContext: () => 'Desktop',
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: mocks.navigateRoom, navigateSpace: vi.fn() }),
}));

// IncomingCall wraps its dialog in a focus trap that needs a real DOM.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('../../hooks/useCall', () => ({
  useCallSession: () => undefined,
  useCallMembers: () => [],
  useCallMembersChange: () => undefined,
}));

vi.mock('../../hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'Call room',
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../hooks/useLivekitSupport', () => ({
  useLivekitSupport: () => true,
}));

vi.mock('../../components/CallEmbedHost', () => ({
  CallEmbedHost: () => null,
}));

vi.mock('../../components/CallIframeBackground', () => ({
  CallIframeBackground: () => null,
}));

vi.mock('../../components/room-avatar', () => ({
  RoomAvatar: () => null,
  RoomIcon: () => null,
}));

vi.mock('../../styles/Animations.css', () => ({
  CallAvatarAnimation: 'call-avatar-animation',
}));

vi.mock('../../../../public/sound/call.ogg', () => ({
  default: 'call.ogg',
}));

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('folds', () => ({
  Avatar: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  Dialog: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  Overlay: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  OverlayBackdrop: () => null,
  OverlayCenter: ({ children }: { children?: ReactNode }) =>
    React.createElement('div', null, children),
  color: new Proxy({}, { get: () => new Proxy({}, { get: (_target, prop) => String(prop) }) }),
  Box: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  // The in-room End surface is the only folds Button in CallControls.
  Button: ({
    children,
    before,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    before?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) =>
    React.createElement(
      'button',
      { 'data-mock': 'folds-button', disabled, onClick },
      before,
      children
    ),
  // The status End surface is the only folds Chip in CallControl.
  Chip: ({
    children,
    before,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    before?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) =>
    React.createElement(
      'button',
      { 'data-mock': 'folds-chip', disabled, onClick },
      before,
      children
    ),
  IconButton: React.forwardRef(
    (
      { children, onClick }: { children?: ReactNode; onClick?: () => void },
      ref: React.Ref<HTMLButtonElement>
    ) => React.createElement('button', { 'data-mock': 'folds-icon-button', onClick, ref }, children)
  ),
  Icon: () => null,
  Icons: new Proxy({}, { get: (_target, prop) => String(prop) }),
  Menu: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  MenuItem: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  PopOut: ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  Spinner: () => React.createElement('i', { 'data-mock': 'spinner' }),
  Text: ({ children }: { children?: ReactNode }) => React.createElement('span', null, children),
  Tooltip: () => null,
  TooltipProvider: ({
    children,
  }: {
    children?: ReactNode | ((anchorRef: React.Ref<HTMLElement>) => ReactNode);
  }) => (typeof children === 'function' ? children(React.createRef()) : children),
  config: { space: new Proxy({}, { get: (_target, prop) => String(prop) }) },
  toRem: (value: number) => `${value}`,
}));

/* eslint-disable import/first */
import { Room } from 'matrix-js-sdk';
import { CallControls } from './CallControls';
import { CallControl } from '../call-status/CallControl';
import {
  CallTerminationContextProvider,
  useCallTermination,
  useCallTerminationController,
} from '../../hooks/useCallEmbed';
import { CallEmbedProvider } from '../../components/CallEmbedProvider';
import { callEmbedAtom } from '../../state/callEmbed';
import { CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS } from '../../state/callTerminationOwner';
import { CALL_END_HOST_DEADLINE_MS, CallEmbed } from '../../plugins/call';
import { CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS } from '../../plugins/call/rtcMembershipCleanup';
/* eslint-enable import/first */

const SCRUB_OPTS = { localTimeoutMs: CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS };

const USER_ID = '@alice:mindroom.test';
const DEVICE_ID = 'HOSTDEV';
const MEMBER_STATE_KEY = (userId = USER_ID) => `_${userId}_${DEVICE_ID}_m.call`;

const ownMembershipEvent = () => ({
  getSender: () => USER_ID,
  getStateKey: () => MEMBER_STATE_KEY(),
  getContent: () => ({
    application: 'm.call',
    call_id: '',
    scope: 'm.room',
    device_id: DEVICE_ID,
  }),
});

const agentCallEvent = () => ({
  getSender: () => USER_ID,
  getContent: () => ({
    version: 1,
    agent_user_id: '@mindroom_helper:mindroom.test',
    creator_user_id: USER_ID,
    ephemeral: true,
  }),
});

const makeRoom = (roomId: string, memberEvents: unknown[]): Room =>
  ({
    roomId,
    getVersion: () => '12',
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: string, stateKey?: string) => {
          if (type === 'org.matrix.msc3401.call.member') {
            return stateKey === undefined ? memberEvents : null;
          }
          if (type === 'io.mindroom.agent_call') {
            return stateKey === undefined ? [agentCallEvent()] : agentCallEvent();
          }
          return stateKey === undefined ? [] : null;
        },
      }),
    }),
  } as unknown as Room);

type FakeWidgetEvent = {
  detail: Record<string, unknown>;
  preventDefault: ReturnType<typeof vi.fn>;
};

type FakeEmbed = {
  embed: CallEmbed;
  hangup: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  emitWidget: (action: string) => FakeWidgetEvent;
};

const createFakeEmbed = (
  roomId: string,
  options?: { joined?: boolean; members?: unknown[] }
): FakeEmbed => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const reply = vi.fn();
  const call = {
    on: (type: string, callback: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(callback);
      listeners.set(type, set);
    },
    off: (type: string, callback: (event: unknown) => void) => {
      listeners.get(type)?.delete(callback);
    },
    transport: { reply },
  };
  const emitWidget = (action: string): FakeWidgetEvent => {
    const event: FakeWidgetEvent = { detail: {}, preventDefault: vi.fn() };
    listeners.get(`action:${action}`)?.forEach((callback) => callback(event));
    return event;
  };
  const hangup = vi.fn(
    () =>
      new Promise(() => {
        // never settles: models a wedged Element Call iframe
      })
  );
  const control = {
    getState: () => ({
      microphone: true,
      video: false,
      sound: true,
      screenshare: false,
      spotlight: false,
    }),
    on: () => undefined,
    off: () => undefined,
  };
  const embed = {
    joined: options?.joined ?? true,
    roomId,
    room: makeRoom(roomId, options?.members ?? [ownMembershipEvent()]),
    // The atom setter builds the cleanup owner from the embed's own client.
    client: mocks.mx,
    call,
    control,
    hangup,
    setTheme: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CallEmbed;
  return { embed, hangup, reply, emitWidget };
};

// Mirrors how CallEmbedProvider wires the shared termination context around
// both End surfaces.
function Surfaces({ embed }: { embed: CallEmbed }) {
  const termination = useCallTerminationController(embed);
  return (
    <CallTerminationContextProvider value={termination}>
      <CallControls callEmbed={embed} />
      <CallControl callEmbed={embed} compact={false} callJoined={embed.joined} />
    </CallTerminationContextProvider>
  );
}

function Harness() {
  const embed = useAtomValue(callEmbedAtom);
  return embed ? <Surfaces embed={embed} /> : <span>no-active-call</span>;
}

const findEndButton = (renderer: ReactTestRenderer, mock: 'folds-button' | 'folds-chip') => {
  const nodes = renderer.root.findAll((node) => node.props['data-mock'] === mock);
  expect(nodes).toHaveLength(1);
  return nodes[0];
};

const spinnerCount = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-mock'] === 'spinner').length;

describe('End surfaces under one termination context', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {} // eslint-disable-line class-methods-use-this

        unobserve() {} // eslint-disable-line class-methods-use-this

        disconnect() {} // eslint-disable-line class-methods-use-this
      }
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.mx.sendStateEvent.mockClear();
    mocks.mx.kick.mockClear();
    mocks.mx.leave.mockClear();
    mocks.mx.forget.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const renderHarness = (store: ReturnType<typeof createStore>): ReactTestRenderer => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Harness />
        </Provider>
      );
    });
    return renderer;
  };

  const flushAsync = () =>
    act(async () => {
      // Drain the detached cleanup's multi-step await chain (scrub PUT, then
      // kick/leave/forget), which involves no timers once delays elapsed.
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve(); // eslint-disable-line no-await-in-loop
      }
    });

  it('one click sends one widget request, disables both surfaces, and Close resets everything', async () => {
    const store = createStore();
    const roomId = '!surfaces-close:mindroom.test';
    const { embed, hangup, emitWidget } = createFakeEmbed(roomId);
    store.set(callEmbedAtom, embed);
    const renderer = renderHarness(store);

    expect(findEndButton(renderer, 'folds-button').props.disabled).toBe(false);
    expect(findEndButton(renderer, 'folds-chip').props.disabled).toBe(false);
    expect(spinnerCount(renderer)).toBe(0);

    act(() => {
      findEndButton(renderer, 'folds-button').props.onClick();
    });

    expect(hangup).toHaveBeenCalledTimes(1);
    // One click disables BOTH surfaces and shows both spinners.
    expect(findEndButton(renderer, 'folds-button').props.disabled).toBe(true);
    expect(findEndButton(renderer, 'folds-chip').props.disabled).toBe(true);
    expect(spinnerCount(renderer)).toBe(2);

    // Pressing the other surface (or the same one again) is a no-op.
    act(() => {
      findEndButton(renderer, 'folds-chip').props.onClick();
    });
    expect(hangup).toHaveBeenCalledTimes(1);

    // The healthy terminal signal finalizes once: atom cleared, surfaces gone.
    act(() => {
      emitWidget('io.element.close');
    });
    expect(store.get(callEmbedAtom)).toBeUndefined();
    expect(renderer.root.findAllByType('span').length).toBeGreaterThan(0);

    // Residual own-device membership is still observed after the settle
    // delay (Element Call never completed its leave), so the host scrubs it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS);
    });
    await flushAsync();
    expect(mocks.mx.sendStateEvent).toHaveBeenCalledWith(
      roomId,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY(),
      SCRUB_OPTS
    );
    expect(mocks.mx.leave).toHaveBeenCalledWith(roomId);
  });

  it('ends a not-yet-joined call from the status surface without a widget request', async () => {
    const store = createStore();
    const roomId = '!surfaces-notjoined:mindroom.test';
    const { embed, hangup } = createFakeEmbed(roomId, { joined: false, members: [] });
    store.set(callEmbedAtom, embed);
    const renderer = renderHarness(store);

    act(() => {
      findEndButton(renderer, 'folds-chip').props.onClick();
    });

    expect(hangup).not.toHaveBeenCalled();
    expect(store.get(callEmbedAtom)).toBeUndefined();

    // The ephemeral agent room is still cleaned up, with nothing to scrub —
    // a forced end with no captured membership waits for the residual
    // recheck (late-synced state would otherwise ghost for hours).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS);
    });
    await flushAsync();
    expect(mocks.mx.sendStateEvent).not.toHaveBeenCalled();
    expect(mocks.mx.kick).toHaveBeenCalledTimes(1);
    expect(mocks.mx.leave).toHaveBeenCalledWith(roomId);
    expect(mocks.mx.forget).toHaveBeenCalledWith(roomId);
  });

  it('remounting mid-ending rebinds the same coordinator: one hangup, one finalizer', async () => {
    const store = createStore();
    const roomId = '!surfaces-remount:mindroom.test';
    const { embed, hangup } = createFakeEmbed(roomId);
    store.set(callEmbedAtom, embed);
    const first = renderHarness(store);

    act(() => {
      findEndButton(first, 'folds-button').props.onClick();
    });
    expect(hangup).toHaveBeenCalledTimes(1);

    act(() => {
      first.unmount();
    });

    // A real remount runs the hook's useMemo again; a fresh coordinator
    // would report ending=false, re-enable both surfaces, and allow a second
    // widget hangup while the old coordinator's deadline still runs.
    const second = renderHarness(store);
    expect(findEndButton(second, 'folds-button').props.disabled).toBe(true);
    expect(findEndButton(second, 'folds-chip').props.disabled).toBe(true);
    expect(spinnerCount(second)).toBe(2);

    act(() => {
      findEndButton(second, 'folds-chip').props.onClick();
    });
    expect(hangup).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_HOST_DEADLINE_MS);
    });
    await flushAsync();

    expect(store.get(callEmbedAtom)).toBeUndefined();
    // One finalizer: exactly one forced scrub PUT for the one captured key.
    expect(mocks.mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mocks.mx.sendStateEvent).toHaveBeenCalledWith(
      roomId,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY(),
      SCRUB_OPTS
    );
  });

  it('acknowledges from-widget Hangup and Close instead of letting them auto-error', async () => {
    // matrix-widget-api auto-replies "unsupported action" to any from-widget
    // request nobody preventDefault()s — and the transport now stays alive
    // through the whole ending window.
    const store = createStore();
    const roomId = '!surfaces-reply:mindroom.test';
    const { embed, reply, emitWidget } = createFakeEmbed(roomId);
    store.set(callEmbedAtom, embed);
    renderHarness(store);

    let hangupEvent!: FakeWidgetEvent;
    act(() => {
      hangupEvent = emitWidget('im.vector.hangup');
    });
    expect(hangupEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(hangupEvent.detail, {});

    let closeEvent!: FakeWidgetEvent;
    act(() => {
      closeEvent = emitWidget('io.element.close');
    });
    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(closeEvent.detail, {});
    expect(reply).toHaveBeenCalledTimes(2);
    expect(store.get(callEmbedAtom)).toBeUndefined();
  });

  it('keeps an in-flight ending alive across unmount and still finalizes at the deadline', async () => {
    // Pins the dispose decision rule: an effect detach while the embed is
    // still current (StrictMode replay, offscreen remount, unmount mid-call)
    // must NOT dispose the coordinator, or End would be permanently dead.
    const store = createStore();
    const roomId = '!surfaces-unmount:mindroom.test';
    const { embed, hangup } = createFakeEmbed(roomId);
    store.set(callEmbedAtom, embed);
    const renderer = renderHarness(store);

    act(() => {
      findEndButton(renderer, 'folds-button').props.onClick();
    });
    expect(hangup).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_HOST_DEADLINE_MS);
    });
    await flushAsync();

    expect(store.get(callEmbedAtom)).toBeUndefined();
    expect(mocks.mx.sendStateEvent).toHaveBeenCalledWith(
      roomId,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY(),
      SCRUB_OPTS
    );
  });

  it('a different-room replacement mid-ending abandons into detached cleanup for the old room', async () => {
    const store = createStore();
    const oldRoomId = '!surfaces-old:mindroom.test';
    const newRoomId = '!surfaces-new:mindroom.test';
    const old = createFakeEmbed(oldRoomId);
    const replacement = createFakeEmbed(newRoomId);
    store.set(callEmbedAtom, old.embed);
    const renderer = renderHarness(store);

    act(() => {
      findEndButton(renderer, 'folds-button').props.onClick();
    });
    expect(old.hangup).toHaveBeenCalledTimes(1);

    act(() => {
      store.set(callEmbedAtom, replacement.embed);
    });

    // The old embed was disposed by the atom setter; the new surfaces are
    // live and not ending.
    expect(old.embed.dispose).toHaveBeenCalledTimes(1);
    expect(store.get(callEmbedAtom)).toBe(replacement.embed);
    expect(findEndButton(renderer, 'folds-button').props.disabled).toBe(false);

    // The abandoned ending still runs its network cleanup for the OLD room.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS);
    });
    await flushAsync();
    expect(mocks.mx.sendStateEvent).toHaveBeenCalledWith(
      oldRoomId,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY(),
      SCRUB_OPTS
    );
    expect(mocks.mx.leave).toHaveBeenCalledWith(oldRoomId);

    // The old deadline never fires against the replacement.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_HOST_DEADLINE_MS * 2);
    });
    expect(store.get(callEmbedAtom)).toBe(replacement.embed);
    expect(replacement.embed.dispose).not.toHaveBeenCalled();
  });

  it('replacing an idle unjoined embed still runs the predecessor room cleanup', async () => {
    // Answering an incoming call in another room replaces an embed whose
    // End was never pressed. Its residual RTC membership (Element Call may
    // have published before the replacement) and its ephemeral agent room
    // must still be cleaned — an idle predecessor leaves the same
    // obligations behind as one replaced mid-ending (review A1, round 4).
    const store = createStore();
    const oldRoomId = '!surfaces-idle-old:mindroom.test';
    const newRoomId = '!surfaces-idle-new:mindroom.test';
    const old = createFakeEmbed(oldRoomId, { joined: false });
    const replacement = createFakeEmbed(newRoomId);
    store.set(callEmbedAtom, old.embed);
    renderHarness(store);

    // No End press: the predecessor is idle when the answer replaces it.
    act(() => {
      store.set(callEmbedAtom, replacement.embed);
    });
    expect(old.embed.dispose).toHaveBeenCalledTimes(1);
    expect(old.hangup).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS);
    });
    await flushAsync();

    expect(mocks.mx.sendStateEvent).toHaveBeenCalledWith(
      oldRoomId,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY(),
      SCRUB_OPTS
    );
    expect(mocks.mx.kick).toHaveBeenCalledTimes(1);
    expect(mocks.mx.leave).toHaveBeenCalledWith(oldRoomId);
    expect(mocks.mx.forget).toHaveBeenCalledWith(oldRoomId);
    // The live replacement stays untouched.
    expect(replacement.embed.dispose).not.toHaveBeenCalled();
    expect(store.get(callEmbedAtom)).toBe(replacement.embed);
    expect(mocks.mx.leave).not.toHaveBeenCalledWith(newRoomId);
  });

  it('a publish and replacement batched into one commit still cleans the intermediate room', async () => {
    // Review A1/B1 (round 5): two `setCallEmbed` calls inside one React
    // commit dispose the intermediate iframe before the provider ever
    // renders it. With render-coupled ownership no coordinator would exist
    // for it and its room's cleanup would silently never run; ownership is
    // anchored to the atom setter now.
    const store = createStore();
    const intermediateRoomId = '!batched-intermediate:mindroom.test';
    const finalRoomId = '!batched-final:mindroom.test';
    const intermediate = createFakeEmbed(intermediateRoomId, { joined: false });
    const final = createFakeEmbed(finalRoomId);
    const renderer = renderHarness(store);
    expect(renderer.root.findAllByType('span').length).toBeGreaterThan(0);

    act(() => {
      // Same commit: the provider never renders the intermediate embed.
      store.set(callEmbedAtom, intermediate.embed);
      store.set(callEmbedAtom, final.embed);
    });

    expect(intermediate.embed.dispose).toHaveBeenCalledTimes(1);
    expect(store.get(callEmbedAtom)).toBe(final.embed);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS);
    });
    await flushAsync();

    // The never-rendered predecessor's obligations ran anyway...
    expect(mocks.mx.sendStateEvent).toHaveBeenCalledWith(
      intermediateRoomId,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY(),
      SCRUB_OPTS
    );
    expect(mocks.mx.kick).toHaveBeenCalledTimes(1);
    expect(mocks.mx.leave).toHaveBeenCalledWith(intermediateRoomId);
    expect(mocks.mx.forget).toHaveBeenCalledWith(intermediateRoomId);
    // ...and the live replacement stays untouched.
    expect(final.embed.dispose).not.toHaveBeenCalled();
    expect(mocks.mx.leave).not.toHaveBeenCalledWith(finalRoomId);
  });

  it('answering an incoming call whose start is refused dismisses the prompt without navigating', async () => {
    // Review A5 (round 5): the Answer catch path must dismiss the ring
    // prompt and must NOT navigate when `startCall` throws (e.g. the room
    // retired mid-ring, or the embed container is unavailable).
    const store = createStore();
    const ringRoomId = '!incoming-ring:mindroom.test';
    const powerLevelsEvent = { getContent: () => ({ state_default: 0, users_default: 0 }) };
    const ringRoom = {
      roomId: ringRoomId,
      isCallRoom: () => false,
      getType: () => undefined,
      getJoinRule: () => 'invite',
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: (type: string, stateKey?: string) => {
            if (type === 'm.room.power_levels') {
              return stateKey === undefined ? [powerLevelsEvent] : powerLevelsEvent;
            }
            return stateKey === undefined ? [] : null;
          },
        }),
      }),
    } as unknown as Room;
    mocks.mx.getRoom.mockImplementation(() => ringRoom as never);

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <CallEmbedProvider />
        </Provider>
      );
    });
    const timelineRegistration = mocks.mx.on.mock.calls
      .filter(([eventName]) => eventName === 'Room.timeline')
      .pop();
    expect(timelineRegistration).toBeDefined();
    const handleTimeline = timelineRegistration![1] as (
      event: unknown,
      room: unknown,
      toStart: boolean,
      removed: boolean,
      data: { liveEvent: boolean }
    ) => Promise<void>;

    const notification = {
      getRelation: () => ({ rel_type: 'm.reference', event_id: '$ring-ref:mindroom.test' }),
      isEncrypted: () => false,
      getType: () => 'org.matrix.msc4075.rtc.notification',
      getSender: () => '@openclaw:mindroom.test',
      getTs: () => Date.now(),
      getContent: () => ({
        sender_ts: Date.now(),
        lifetime: 30_000,
        notification_type: 'ring',
        'm.mentions': { room: true },
      }),
    };
    await act(async () => {
      await handleTimeline(notification, ringRoom, false, false, { liveEvent: true });
    });

    const buttons = renderer.root.findAll((node) => node.props['data-mock'] === 'folds-button');
    // The ring prompt is up: Answer and Reject/Ignore.
    expect(buttons).toHaveLength(2);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      act(() => {
        // Answer: startCall throws (no embed container mounts in this
        // harness — the same handled-refusal contract as a retired room).
        buttons[0].props.onClick();
      });
    } finally {
      warn.mockRestore();
    }

    // Prompt dismissed, no navigation, no embed published.
    expect(
      renderer.root.findAll((node) => node.props['data-mock'] === 'folds-button')
    ).toHaveLength(0);
    expect(mocks.navigateRoom).not.toHaveBeenCalled();
    expect(store.get(callEmbedAtom)).toBeUndefined();
    mocks.mx.getRoom.mockImplementation(() => null);
  });

  it('the real CallEmbedProvider wires the termination context and widget signals end-to-end', () => {
    // The other tests mount the surfaces under a manually reconstructed
    // controller; this one mounts the production provider so an omitted or
    // miswired CallTerminationContext / widget-signal subscription in
    // CallEmbedProvider itself fails the suite.
    function TerminationProbe() {
      const { ending, endCall } = useCallTermination();
      return React.createElement('button', {
        'data-mock': 'probe-end',
        'data-ending': ending,
        onClick: endCall,
      });
    }

    const store = createStore();
    const roomId = '!provider-smoke:mindroom.test';
    const { embed, hangup, emitWidget } = createFakeEmbed(roomId);
    store.set(callEmbedAtom, embed);

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <CallEmbedProvider>
            <TerminationProbe />
          </CallEmbedProvider>
        </Provider>
      );
    });
    const probe = () => {
      const nodes = renderer.root.findAll((node) => node.props['data-mock'] === 'probe-end');
      expect(nodes).toHaveLength(1);
      return nodes[0];
    };

    expect(probe().props['data-ending']).toBe(false);

    act(() => {
      probe().props.onClick();
    });
    expect(hangup).toHaveBeenCalledTimes(1);
    expect(probe().props['data-ending']).toBe(true);

    // The provider's own widget Close subscription must finalize: the real
    // callEmbedAtom clears and the shared ending state resets.
    act(() => {
      emitWidget('io.element.close');
    });
    expect(store.get(callEmbedAtom)).toBeUndefined();
    expect(probe().props['data-ending']).toBe(false);
  });

  it('a same-room replacement mid-ending fences the abandoned cleanup wholesale', async () => {
    const store = createStore();
    const roomId = '!surfaces-samero:mindroom.test';
    const old = createFakeEmbed(roomId);
    const replacement = createFakeEmbed(roomId);
    store.set(callEmbedAtom, old.embed);
    const renderer = renderHarness(store);

    act(() => {
      findEndButton(renderer, 'folds-chip').props.onClick();
    });
    expect(old.hangup).toHaveBeenCalledTimes(1);

    act(() => {
      store.set(callEmbedAtom, replacement.embed);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS + CALL_END_HOST_DEADLINE_MS * 2
      );
    });
    await flushAsync();

    // The successor claimed the room: no stale scrub may clobber its fresh
    // membership and no stale agent cleanup may leave its live room.
    expect(mocks.mx.sendStateEvent).not.toHaveBeenCalled();
    expect(mocks.mx.kick).not.toHaveBeenCalled();
    expect(mocks.mx.leave).not.toHaveBeenCalled();
    expect(store.get(callEmbedAtom)).toBe(replacement.embed);
  });
});
