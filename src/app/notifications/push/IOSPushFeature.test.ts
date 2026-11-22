import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnownMembership, RoomMemberEvent, UserEvent } from 'matrix-js-sdk';
import {
  syncNativeNotificationAccount,
  syncNativeNotificationAvatars,
} from '../../native/nativeNotifications';
import {
  disableIOSPushPusher,
  registerIOSPush,
  setIOSPushEnabled,
  upsertIOSPushPusher,
} from './iosPush';
import { NativeIOSPushFeature } from './IOSPushFeature';

type RoomMemberStub = {
  userId: string;
  membership: string;
  getMxcAvatarUrl: () => string | null | undefined;
};

type RoomStub = {
  getMyMembership: () => string;
  getJoinedMembers: () => RoomMemberStub[];
};

const state = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    signInRequired: true,
    pushAllowed: true,
    hasCloudflareAccess: false,
    hasCompletedInitialSync: false,
    onRegistration: undefined as ((token: { value: string }) => void) | undefined,
    rooms: [] as RoomStub[],
    users: new Map<string, { avatarUrl?: string }>(),
    listeners,
    emit(event: string) {
      listeners.get(event)?.forEach((fn) => fn());
    },
    mx: {
      clientRunning: true,
      getHomeserverUrl: () => 'https://private.example',
      getUserId: () => '@me:private.example',
      getAccessToken: () => 'access-token-123',
      getRooms: () => state.rooms,
      getUser: (userId: string) => state.users.get(userId) ?? null,
      on: vi.fn((event: string, listener: () => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      }),
      removeListener: vi.fn((event: string, listener: () => void) => {
        listeners.get(event)?.delete(listener);
      }),
    },
    clientConfig: {},
  };
});

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, listener: (token: { value: string }) => void) => {
      if (event === 'registration') state.onRegistration = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  },
}));

vi.mock('./iosPush', () => ({
  checkIOSPushPermission: vi.fn(async () => 'granted'),
  disableIOSPushPusher: vi.fn(async () => undefined),
  getOrCreateIOSPushProfileTag: vi.fn(() => 'fallback-tag'),
  isNativeIOSPlatform: () => true,
  registerIOSPush: vi.fn(async () => undefined),
  resolveIOSPushConfig: () => ({ appId: 'chat.example', format: 'full', profileTag: 'profile-tag-1' }),
  setIOSPushEnabled: vi.fn(),
  upsertIOSPushPusher: vi.fn(async () => undefined),
}));

vi.mock('./useIOSPushEnabled', () => ({ useIOSPushEnabled: () => true }));
vi.mock('../../native/cloudflareAccess', () => ({
  cloudflareAccessAllowsPush: () => state.pushAllowed,
  hasCloudflareAccess: () => state.hasCloudflareAccess,
  useCloudflareAccessSignInRequired: () => state.signInRequired,
}));
vi.mock('../../native/nativeNotifications', () => ({
  syncNativeNotificationAccount: vi.fn(async () => undefined),
  syncNativeNotificationAvatars: vi.fn(async () => undefined),
}));
vi.mock('../../matrix/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: state.hasCompletedInitialSync }),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => state.mx }));
vi.mock('../../config/useClientConfig', () => ({ useClientConfig: () => state.clientConfig }));
vi.mock('../../matrix/session/useSessionStore', () => ({
  useActiveSession: () => ({ sessionId: 's1' }),
}));
vi.mock('../../i18n/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));

const mount = async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(NativeIOSPushFeature));
  });
  return renderer;
};

const rerender = (renderer: ReactTestRenderer) =>
  act(async () => renderer.update(React.createElement(NativeIOSPushFeature)));

describe('NativeIOSPushFeature', () => {
  afterEach(() => {
    state.signInRequired = true;
    state.pushAllowed = true;
    state.hasCloudflareAccess = false;
    state.hasCompletedInitialSync = false;
    state.onRegistration = undefined;
    state.rooms = [];
    state.users.clear();
    state.listeners.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('waits for the Cloudflare Access sign-in instead of turning push off', async () => {
    const renderer = await mount();
    expect(registerIOSPush).not.toHaveBeenCalled();

    state.signInRequired = false;
    await rerender(renderer);
    await act(async () => state.onRegistration?.({ value: 'apns-token' }));

    expect(upsertIOSPushPusher).toHaveBeenCalledWith(
      state.mx,
      expect.anything(),
      'apns-token',
      's1'
    );
    expect(setIOSPushEnabled).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('keeps push on when a registration fails because the Access token expired meanwhile', async () => {
    state.signInRequired = false;
    let rejectUpsert: (error: Error) => void = () => undefined;
    vi.mocked(upsertIOSPushPusher).mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectUpsert = reject;
      })
    );
    const renderer = await mount();
    await act(async () => state.onRegistration?.({ value: 'apns-token' }));

    state.signInRequired = true;
    await rerender(renderer);
    await act(async () => rejectUpsert(new TypeError('Load failed')));

    expect(setIOSPushEnabled).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('only removes the pusher when the server turns push off', async () => {
    state.signInRequired = false;
    state.pushAllowed = false;
    vi.mocked(disableIOSPushPusher).mockRejectedValueOnce(new TypeError('Load failed'));
    const renderer = await mount();
    // A token from a registration started earlier, for instance by another account.
    await act(async () => state.onRegistration?.({ value: 'apns-token' }));

    expect(disableIOSPushPusher).toHaveBeenCalledWith(state.mx, expect.anything(), 's1');
    expect(registerIOSPush).not.toHaveBeenCalled();
    expect(upsertIOSPushPusher).not.toHaveBeenCalled();
    expect(setIOSPushEnabled).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('syncs account credentials and omits accessToken for Cloudflare Access homeservers', async () => {
    const renderer = await mount();
    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'profile-tag-1',
      homeserverUrl: 'https://private.example',
      userId: '@me:private.example',
      accessToken: 'access-token-123',
    });

    vi.mocked(syncNativeNotificationAccount).mockClear();
    state.hasCloudflareAccess = true;
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'profile-tag-1',
      homeserverUrl: 'https://private.example',
      userId: '@me:private.example',
    });
    renderer.unmount();
  });

  it('syncs joined member avatars after initial sync and debounces member/avatar updates', async () => {
    vi.useFakeTimers();
    state.rooms = [
      {
        getMyMembership: () => KnownMembership.Join,
        getJoinedMembers: () => [
          {
            userId: '@me:private.example',
            membership: KnownMembership.Join,
            getMxcAvatarUrl: () => 'mxc://private.example/me',
          },
          {
            userId: '@agent:private.example',
            membership: KnownMembership.Join,
            getMxcAvatarUrl: () => null,
          },
          {
            userId: '@bob:private.example',
            membership: KnownMembership.Join,
            getMxcAvatarUrl: () => null,
          },
        ],
      },
      {
        getMyMembership: () => KnownMembership.Join,
        getJoinedMembers: () => [
          {
            userId: '@agent:private.example',
            membership: KnownMembership.Join,
            getMxcAvatarUrl: () => 'mxc://private.example/agent-v1',
          },
        ],
      },
      {
        getMyMembership: () => KnownMembership.Leave,
        getJoinedMembers: () => [
          {
            userId: '@left:private.example',
            membership: KnownMembership.Join,
            getMxcAvatarUrl: () => 'mxc://private.example/left',
          },
        ],
      },
    ];

    const renderer = await mount();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    state.hasCompletedInitialSync = true;
    await rerender(renderer);

    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'profile-tag-1',
      avatars: [
        { sender: '@agent:private.example', mxcUrl: 'mxc://private.example/agent-v1' },
        { sender: '@bob:private.example', mxcUrl: null },
      ],
    });

    // Unchanged event should not re-invoke syncNativeNotificationAvatars
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    await act(async () => {
      state.emit(RoomMemberEvent.Membership);
      vi.advanceTimersByTime(1100);
    });
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    // Changed avatar triggers a single debounced sync
    state.users.set('@bob:private.example', { avatarUrl: 'mxc://private.example/bob-v1' });
    await act(async () => {
      state.emit(UserEvent.AvatarUrl);
      state.emit(RoomMemberEvent.Membership);
      vi.advanceTimersByTime(1100);
    });
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'profile-tag-1',
      avatars: [
        { sender: '@agent:private.example', mxcUrl: 'mxc://private.example/agent-v1' },
        { sender: '@bob:private.example', mxcUrl: 'mxc://private.example/bob-v1' },
      ],
    });

    renderer.unmount();
  });
});
