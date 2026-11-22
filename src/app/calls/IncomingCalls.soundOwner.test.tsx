// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import {
  EventType,
  KnownMembership,
  MatrixEvent,
  RoomEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordRecentLiveEvents } from '../matrix/client/recentLiveEvents';
import { IncomingCalls } from './IncomingCalls';

const ME = '@me:calls.test';
const CALLER = '@alice:calls.test';
const ROOM_ID = '!direct:calls.test';

const mocks = vi.hoisted(() => ({
  nativeIOS: true,
  startRingtone: vi.fn(() => vi.fn()),
  mx: undefined as unknown as MatrixClient,
}));

class FakeMatrixClient extends EventEmitter {
  clientRunning = true;

  getSafeUserId() {
    return ME;
  }

  getRoom(roomId: string) {
    return {
      roomId,
      getMyMembership: () => KnownMembership.Join,
      getMember: () => null,
      membersLoaded: () => true,
    };
  }

  matrixRTC = { getRoomSession: () => ({}) };

  decryptEventIfNeeded = vi.fn(async () => undefined);
}

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.mx }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: vi.fn() }),
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({ useRoomName: () => 'Alice' }));
vi.mock('../preferences/useSetting', () => ({
  useSetting: (_atom: unknown, key: string) => [key === 'isNotificationSounds'],
}));
vi.mock('../native/nativeSso', () => ({
  isNativeIOS: () => mocks.nativeIOS,
}));
vi.mock('./ringtone', () => ({
  startRingtone: () => mocks.startRingtone(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./callMemberships', () => ({ activeMemberships: () => [{ userId: CALLER }] }));
vi.mock('./CallTile', () => ({ CallMemberAvatar: () => null }));
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useActiveCall: () => undefined,
  useCallActions: () => ({ startCall: vi.fn(async () => 'started' as const) }),
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

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

const makeRing = (eventId: string, ts: number) =>
  new MatrixEvent({
    type: EventType.RTCNotification,
    room_id: ROOM_ID,
    event_id: eventId,
    sender: CALLER,
    origin_server_ts: ts,
    content: {
      notification_type: 'ring',
      'm.mentions': { user_ids: [], room: true },
      sender_ts: ts,
      lifetime: 30_000,
    },
  });

const deliver = async (client: FakeMatrixClient, event: MatrixEvent) => {
  await act(async () => {
    client.emit(RoomEvent.Timeline, event, client.getRoom(ROOM_ID), false, false, {
      liveEvent: true,
    });
    await Promise.resolve();
  });
};

describe('IncomingCalls native iOS sound ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    mocks.nativeIOS = true;
    mocks.startRingtone.mockClear();
    setVisibility('visible');
  });

  afterEach(() => {
    setVisibility('visible');
    vi.useRealTimers();
  });

  it('starts no ringtone for a ring seen while hidden, even after coming to the front, and rings for a new ring while visible', async () => {
    const client = new FakeMatrixClient();
    mocks.mx = client as unknown as MatrixClient;
    setVisibility('hidden');

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Provider store={createStore()}>
          <IncomingCalls />
        </Provider>
      );
    });

    await deliver(client, makeRing('$hidden-ring', Date.now()));
    expect(
      renderer.root
        .findAllByType('section')
        .filter((node) => node.props['data-incoming-call'] === ROOM_ID)
    ).toHaveLength(1);
    expect(mocks.startRingtone).not.toHaveBeenCalled();

    // App comes to the front while the same ring is still active: APNs already owns it.
    act(() => {
      vi.advanceTimersByTime(1000);
      setVisibility('visible');
    });
    expect(mocks.startRingtone).not.toHaveBeenCalled();

    // A new ring arriving while visible is owned by the web ringtone.
    vi.advanceTimersByTime(1000);
    await deliver(client, makeRing('$visible-ring', Date.now()));
    expect(mocks.startRingtone).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
  });

  it('starts no ringtone for a ring caught up after resuming from background', async () => {
    const client = new FakeMatrixClient();
    mocks.mx = client as unknown as MatrixClient;

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Provider store={createStore()}>
          <IncomingCalls />
        </Provider>
      );
    });

    const ringSentWhileHidden = Date.now() + 2_000;
    act(() => {
      setVisibility('hidden');
      vi.advanceTimersByTime(5_000);
      setVisibility('visible');
    });

    // Sync delivers the ring that was sent while the app was hidden.
    await deliver(client, makeRing('$resumed-ring', ringSentWhileHidden));
    expect(
      renderer.root
        .findAllByType('section')
        .filter((node) => node.props['data-incoming-call'] === ROOM_ID)
    ).toHaveLength(1);
    expect(mocks.startRingtone).not.toHaveBeenCalled();

    act(() => renderer.unmount());
  });

  it('starts no ringtone on native iOS for a ring already delivered before mount (cold launch)', async () => {
    const client = new FakeMatrixClient();
    mocks.mx = client as unknown as MatrixClient;
    recordRecentLiveEvents(mocks.mx);

    const earlyRing = makeRing('$cold-launch-ring', Date.now());
    client.emit(RoomEvent.Timeline, earlyRing, client.getRoom(ROOM_ID), false, false, {
      liveEvent: true,
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Provider store={createStore()}>
          <IncomingCalls />
        </Provider>
      );
      await Promise.resolve();
    });

    expect(
      renderer.root
        .findAllByType('section')
        .filter((node) => node.props['data-incoming-call'] === ROOM_ID)
    ).toHaveLength(1);
    expect(mocks.startRingtone).not.toHaveBeenCalled();

    act(() => renderer.unmount());
  });

  it('keeps web ringtone behavior when not on native iOS, even in a hidden tab', async () => {
    mocks.nativeIOS = false;
    const client = new FakeMatrixClient();
    mocks.mx = client as unknown as MatrixClient;
    setVisibility('hidden');

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Provider store={createStore()}>
          <IncomingCalls />
        </Provider>
      );
    });

    await deliver(client, makeRing('$web-hidden-ring', Date.now()));
    expect(mocks.startRingtone).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
  });
});
