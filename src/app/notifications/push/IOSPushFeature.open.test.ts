import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeIOSPushOpenFeature } from './IOSPushFeature';

type ActionListener = (action: { notification: { data: unknown } }) => void;

const state = vi.hoisted(() => ({
  hasCompletedInitialSync: true,
  onAction: undefined as ActionListener | undefined,
  navigateRoom: vi.fn(),
  mx: {
    getRoom: (roomId: string) => {
      if (roomId === '!joined:example') return { getMyMembership: () => 'join' };
      if (roomId === '!left:example') return { getMyMembership: () => 'leave' };
      return null;
    },
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, listener: ActionListener) => {
      if (event === 'pushNotificationActionPerformed') state.onAction = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  },
}));

vi.mock('./iosPush', () => ({ isNativeIOSPlatform: () => true }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => state.mx }));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: state.navigateRoom }),
}));
vi.mock('../../matrix/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: state.hasCompletedInitialSync }),
}));

const tap = (data: unknown) => act(async () => state.onAction?.({ notification: { data } }));

describe('NativeIOSPushOpenFeature', () => {
  afterEach(() => {
    state.hasCompletedInitialSync = true;
    state.onAction = undefined;
    vi.clearAllMocks();
  });

  it('opens the event of a tapped push, once the first sync is done', async () => {
    state.hasCompletedInitialSync = false;
    const renderer = await act(async () =>
      create(React.createElement(NativeIOSPushOpenFeature))
    );
    await tap({ aps: {}, room_id: '!joined:example', event_id: '$reply' });
    expect(state.navigateRoom).not.toHaveBeenCalled();

    state.hasCompletedInitialSync = true;
    await act(async () => renderer.update(React.createElement(NativeIOSPushOpenFeature)));

    expect(state.navigateRoom).toHaveBeenCalledTimes(1);
    expect(state.navigateRoom).toHaveBeenCalledWith('!joined:example', '$reply');
    renderer.unmount();
  });

  it("leaves another account's push, a left room and a push without a room alone", async () => {
    const renderer = await act(async () =>
      create(React.createElement(NativeIOSPushOpenFeature))
    );
    await tap({ aps: {}, room_id: '!elsewhere:example', event_id: '$event' });
    await tap({ aps: {}, room_id: '!left:example', event_id: '$event' });
    await tap({ aps: {} });

    expect(state.navigateRoom).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
