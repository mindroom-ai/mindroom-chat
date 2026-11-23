// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPushRules } from 'matrix-js-sdk';
import { mDirectAtom } from '../matrix/state/mDirectList';
import type { IncomingRing } from './callRings';
import { callPanelRoomAtom, callStartProblemAtom, type StartCallResult } from './callStore';
import { IncomingCalls } from './IncomingCalls';

const ROOM_ID = '!direct:calls.test';

const calls = vi.hoisted(() => ({
  ring: undefined as ((ring: IncomingRing) => void) | undefined,
  /** What Answer's start resolves with; a test answers it after switching accounts. */
  answer: undefined as ((result: StartCallResult) => void) | undefined,
  settings: false,
  nativeIOS: false,
  stopRingtone: vi.fn(),
  startRingtone: vi.fn(),
  navigateRoom: vi.fn(),
  members: [{ userId: '@maya:calls.test' }] as { userId: string }[],
}));
const client = vi.hoisted(() => ({
  clientRunning: true,
  pushRules: undefined as IPushRules | undefined,
  getRoom: (roomId: string) => ({ roomId, getMember: () => null, membersLoaded: () => true }),
  getSafeUserId: () => '@me:calls.test',
  matrixRTC: { getRoomSession: () => ({}) },
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: calls.navigateRoom }),
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({ useRoomName: () => 'Maya' }));
vi.mock('../preferences/useSetting', () => ({ useSetting: () => [calls.settings] }));
vi.mock('../native/nativeSso', () => ({ isNativeIOS: () => calls.nativeIOS }));
vi.mock('./ringtone', () => ({
  startRingtone: () => {
    calls.startRingtone();
    return calls.stopRingtone;
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./callRings', () => ({
  watchRings: (_mx: unknown, { onRing }: { onRing: (ring: IncomingRing) => void }) => {
    calls.ring = onRing;
    return () => undefined;
  },
  declineRing: vi.fn(async () => undefined),
}));
vi.mock('./callMemberships', () => ({ activeMemberships: () => calls.members }));
vi.mock('./CallTile', () => ({ CallMemberAvatar: () => null }));
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useActiveCall: () => undefined,
  useCallActions: () => ({
    startCall: () =>
      new Promise<StartCallResult>((resolve) => {
        calls.answer = resolve;
      }),
  }),
}));
vi.mock('./IncomingCalls.css', () => ({ Card: 'card' }));
vi.mock('../ui/glass/GlassPrimitives', () => ({
  Surface: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement('section', props, children),
}));
vi.mock('folds', () => {
  const plain =
    (tag: string) =>
    ({
      children,
      before: _before,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) =>
      React.createElement(tag, props, children);
  return {
    Box: plain('div'),
    Button: plain('button'),
    Text: plain('span'),
    Icon: () => null,
    Icons: { Phone: 'Phone', PhoneDown: 'PhoneDown' },
  };
});

/** Shows a ring from Maya and presses Answer. */
const answerRing = (store: ReturnType<typeof createStore>): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <IncomingCalls />
      </Provider>
    );
  });
  act(() => {
    calls.ring?.({
      roomId: ROOM_ID,
      eventId: '$ring',
      sender: '@maya:calls.test',
      video: false,
      expiresAt: Date.now() + 30_000,
    });
  });
  const shown = renderer as ReactTestRenderer;
  const [label] = shown.root.findAllByProps({ children: 'sharedUi.callEmbedProvider.answer' });
  let answer: ReactTestInstance | undefined = label;
  while (answer && answer.type !== 'button') answer = answer.parent ?? undefined;
  act(() => {
    answer?.props.onClick();
  });
  return shown;
};

afterEach(() => {
  client.clientRunning = true;
  client.pushRules = undefined;
  calls.ring = undefined;
  calls.answer = undefined;
  calls.settings = false;
  calls.nativeIOS = false;
  calls.startRingtone.mockClear();
  calls.stopRingtone.mockClear();
  calls.members = [{ userId: '@maya:calls.test' }];
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IncomingCalls Answer', () => {
  it("opens the room's call panel with why the call did not start", async () => {
    const store = createStore();
    const renderer = answerRing(store);
    await act(async () => {
      calls.answer?.('busy');
      await Promise.resolve();
    });

    expect(store.get(callStartProblemAtom)).toEqual({ roomId: ROOM_ID, result: 'busy' });
    expect(store.get(callPanelRoomAtom)).toBe(ROOM_ID);
    act(() => renderer.unmount());
  });

  it('leaves the next account nothing when the account that answered went away meanwhile', async () => {
    const store = createStore();
    const renderer = answerRing(store);
    // The account switches while the call starts: its client stops and the start fails.
    act(() => renderer.unmount());
    client.clientRunning = false;
    await act(async () => {
      calls.answer?.('failed');
      await Promise.resolve();
    });

    expect(store.get(callStartProblemAtom)).toBeUndefined();
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });
});

const mountAndRing = (store: ReturnType<typeof createStore>, eventId = '$ring') => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <IncomingCalls />
      </Provider>
    );
  });
  act(() => {
    calls.ring?.({
      roomId: ROOM_ID,
      eventId,
      sender: '@maya:calls.test',
      video: false,
      expiresAt: Date.now() + 30_000,
    });
  });
  return renderer;
};

describe('IncomingCalls ring alerts', () => {
  it('stops the web ringtone on native iOS on hide and restarts on resume only while the ring is still live', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    calls.settings = true;
    calls.nativeIOS = true;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    const renderer = mountAndRing(createStore());
    expect(calls.startRingtone).toHaveBeenCalledTimes(1);
    expect(calls.stopRingtone).not.toHaveBeenCalled();

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls.stopRingtone).toHaveBeenCalledTimes(1);

    // Resuming while the ring is still live restarts the ringtone.
    act(() => {
      vi.setSystemTime(1_010_000);
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls.startRingtone).toHaveBeenCalledTimes(2);

    // Hide again, let the ring expire without running the 1 s cleanup interval, then resume.
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls.stopRingtone).toHaveBeenCalledTimes(2);

    act(() => {
      vi.setSystemTime(1_030_000);
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls.startRingtone).toHaveBeenCalledTimes(2);

    act(() => renderer.unmount());
  });

  it.each([false, true])(
    'starts the ringtone on first render even before call memberships are populated (nativeIOS=%s)',
    (nativeIOS) => {
      calls.settings = true;
      calls.nativeIOS = nativeIOS;
      calls.members = [];

      const renderer = mountAndRing(createStore(), `$empty-members-${nativeIOS}`);
      expect(calls.startRingtone).toHaveBeenCalledTimes(1);

      act(() => renderer.unmount());
    }
  );

  it('starts the ringtone on first resume when a ring arrived while hidden before memberships loaded', () => {
    calls.settings = true;
    calls.nativeIOS = true;
    calls.members = [];
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });

    const renderer = mountAndRing(createStore(), '$hidden-first');
    expect(calls.startRingtone).not.toHaveBeenCalled();

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls.startRingtone).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
  });

  it('silences ringtone and desktop alert for a muted non-m.direct room while keeping the card visible', () => {
    calls.settings = true;
    const notifications: string[] = [];
    class RecordedNotification {
      static permission = 'granted';

      onclick: (() => void) | null = null;

      constructor(title: string) {
        notifications.push(title);
      }

      close() {}
    }
    vi.stubGlobal('Notification', RecordedNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    client.pushRules = {
      global: {
        override: [
          {
            rule_id: ROOM_ID,
            default: false,
            enabled: true,
            conditions: [{ kind: 'event_match', key: 'room_id', pattern: ROOM_ID }],
            actions: [],
          },
        ],
      },
    } as unknown as IPushRules;

    // Non-m.direct muted room: card renders, no ringtone and no desktop notification.
    const nonDirectStore = createStore();
    const mutedRenderer = mountAndRing(nonDirectStore, '$muted-ring');
    expect(
      mutedRenderer.root
        .findAllByType('section')
        .filter((node) => node.props['data-incoming-call'] === ROOM_ID)
    ).toHaveLength(1);
    expect(calls.startRingtone).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
    act(() => mutedRenderer.unmount());

    // An m.direct room keeps ringing.
    const directStore = createStore();
    directStore.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set([ROOM_ID]) });
    const directRenderer = mountAndRing(directStore, '$direct-ring');
    expect(calls.startRingtone).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(1);
    act(() => directRenderer.unmount());
  });

  it('shows the desktop main window and opens the room when a call notification is clicked', () => {
    calls.settings = true;
    const shown: { onclick: (() => void) | null; close: ReturnType<typeof vi.fn> }[] = [];
    class ClickableNotification {
      static permission = 'granted';

      onclick: (() => void) | null = null;

      close = vi.fn();

      constructor() {
        shown.push(this);
      }
    }
    const showMainWindow = vi.fn(async () => ({ ok: true as const, value: undefined }));
    vi.stubGlobal('Notification', ClickableNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: { showMainWindow },
    });
    const store = createStore();
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set([ROOM_ID]) });
    let directRenderer: ReactTestRenderer | undefined;
    try {
      directRenderer = mountAndRing(store, '$desktop-ring');
      expect(shown).toHaveLength(1);
      act(() => shown[0]?.onclick?.());
      expect(showMainWindow).toHaveBeenCalledOnce();
      expect(shown[0]?.close).toHaveBeenCalled();
      expect(calls.navigateRoom).toHaveBeenCalledWith(ROOM_ID);
    } finally {
      act(() => directRenderer?.unmount());
      Reflect.deleteProperty(window, 'mindroomDesktop');
    }
  });
});
