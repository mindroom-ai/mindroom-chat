import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnownMembership, RoomMemberEvent, RoomStateEvent, UserEvent } from 'matrix-js-sdk';
import {
  clearNativeNotificationAccount,
  syncNativeNotificationAccount,
  syncNativeNotificationAvatars,
} from '../../native/nativeNotifications';
import {
  disableIOSPushPusher,
  getOrCreateIOSPushProfileTag,
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
  const storedTags = new Map<string, string>();
  const pushConfig:
    | { appId: string; format: 'full' | 'event_id_only'; profileTag?: string }
    | undefined = {
    appId: 'chat.example',
    format: 'full',
    profileTag: 'shared-deployment-profile-tag',
  };
  const activeSession: { sessionId: string; accessToken?: string } | undefined = {
    sessionId: 's1',
    accessToken: 'session-token-v1',
  };
  return {
    signInRequired: true,
    pushAllowed: true,
    pushEnabled: true,
    pushConfig,
    hasCloudflareAccess: false,
    hasCompletedInitialSync: false,
    activeSession,
    onRegistration: undefined as ((token: { value: string }) => void) | undefined,
    rooms: [] as RoomStub[],
    users: new Map<string, { avatarUrl?: string }>(),
    storedTags,
    listeners,
    emit(event: string) {
      listeners.get(event)?.forEach((fn) => fn());
    },
    mx: {
      clientRunning: true,
      getHomeserverUrl: () => 'https://private.example',
      getUserId: () => '@me:private.example',
      getAccessToken: () => 'mx-token-stale',
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
  getStoredIOSPushProfileTag: vi.fn((sessionId?: string) =>
    sessionId ? state.storedTags.get(sessionId) : undefined
  ),
  getOrCreateIOSPushProfileTag: vi.fn((sessionId?: string) => {
    const key = sessionId ?? 'default';
    const existing = state.storedTags.get(key);
    if (existing) return existing;
    const tag = `tag-${key}`;
    state.storedTags.set(key, tag);
    return tag;
  }),
  isNativeIOSPlatform: () => true,
  registerIOSPush: vi.fn(async () => undefined),
  resolveIOSPushConfig: () => state.pushConfig,
  setIOSPushEnabled: vi.fn(),
  upsertIOSPushPusher: vi.fn(async () => undefined),
}));

vi.mock('./useIOSPushEnabled', () => ({ useIOSPushEnabled: () => state.pushEnabled }));
vi.mock('../../native/cloudflareAccess', () => ({
  cloudflareAccessAllowsPush: () => state.pushAllowed,
  hasCloudflareAccess: () => state.hasCloudflareAccess,
  useCloudflareAccessSignInRequired: () => state.signInRequired,
}));
vi.mock('../../native/nativeNotifications', () => ({
  clearNativeNotificationAccount: vi.fn(async () => undefined),
  syncNativeNotificationAccount: vi.fn(async () => undefined),
  syncNativeNotificationAvatars: vi.fn(async () => undefined),
}));
vi.mock('../../matrix/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: state.hasCompletedInitialSync }),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => state.mx }));
vi.mock('../../config/useClientConfig', () => ({ useClientConfig: () => state.clientConfig }));
vi.mock('../../matrix/session/useSessionStore', () => ({
  useActiveSession: () => state.activeSession,
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
    state.pushEnabled = true;
    state.pushConfig = {
      appId: 'chat.example',
      format: 'full',
      profileTag: 'shared-deployment-profile-tag',
    };
    state.hasCloudflareAccess = false;
    state.hasCompletedInitialSync = false;
    state.activeSession = { sessionId: 's1', accessToken: 'session-token-v1' };
    state.onRegistration = undefined;
    state.rooms = [];
    state.users.clear();
    state.storedTags.clear();
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

  it('syncs per-session account tags even when push.ios.profileTag is configured and clears only that account', async () => {
    state.signInRequired = false;
    const renderer = await mount();

    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      homeserverUrl: 'https://private.example',
      userId: '@me:private.example',
      accessToken: 'session-token-v1',
    });

    // Switch to a second account on the same deployment with a shared push.ios.profileTag
    vi.mocked(syncNativeNotificationAccount).mockClear();
    state.activeSession = { sessionId: 's2', accessToken: 'session-token-s2' };
    await rerender(renderer);

    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'tag-s2',
      homeserverUrl: 'https://private.example',
      userId: '@me:private.example',
      accessToken: 'session-token-s2',
    });

    // Disabling push for s2 clears only tag-s2 without touching tag-s1
    state.pushEnabled = false;
    await rerender(renderer);
    expect(clearNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-s2');

    renderer.unmount();
  });

  it('re-syncs credentials when activeSession.accessToken rotates and omits token behind Cloudflare Access', async () => {
    state.signInRequired = false;
    const renderer = await mount();

    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      homeserverUrl: 'https://private.example',
      userId: '@me:private.example',
      accessToken: 'session-token-v1',
    });

    vi.mocked(syncNativeNotificationAccount).mockClear();
    state.activeSession = { sessionId: 's1', accessToken: 'session-token-v2' };
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      homeserverUrl: 'https://private.example',
      userId: '@me:private.example',
      accessToken: 'session-token-v2',
    });

    vi.mocked(syncNativeNotificationAccount).mockClear();
    state.hasCloudflareAccess = true;
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      homeserverUrl: 'https://private.example',
      userId: '@me:private.example',
    });
    renderer.unmount();
  });

  it('gates credential and avatar sync on push eligibility, clears on disable without minting a tag, and re-syncs when re-enabled', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [
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
    ];

    // Push unconfigured with no stored tag: neither syncs nor mints a tag nor clears
    state.pushConfig = undefined;
    const renderer = await mount();
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
    expect(getOrCreateIOSPushProfileTag).not.toHaveBeenCalled();

    // Configure & enable push: syncs account and avatars
    state.pushConfig = { appId: 'chat.example', format: 'full' };
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);

    // Disable push: clears stored native account and stops syncing
    vi.mocked(syncNativeNotificationAccount).mockClear();
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    state.pushEnabled = false;
    await rerender(renderer);
    expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-s1');
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    // Re-enable push: re-syncs both account and avatars (snapshot ref was reset on disable)
    vi.mocked(clearNativeNotificationAccount).mockClear();
    state.pushEnabled = true;
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('syncs joined member avatars after initial sync and debounces membership, room-state member, and avatar updates', async () => {
    vi.useFakeTimers();
    state.signInRequired = false;
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
      accountTag: 'tag-s1',
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

    // Changed avatar via UserEvent.AvatarUrl / RoomMemberEvent.Membership triggers a single debounced sync
    state.users.set('@bob:private.example', { avatarUrl: 'mxc://private.example/bob-v1' });
    await act(async () => {
      state.emit(UserEvent.AvatarUrl);
      state.emit(RoomMemberEvent.Membership);
      vi.advanceTimersByTime(1100);
    });
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      avatars: [
        { sender: '@agent:private.example', mxcUrl: 'mxc://private.example/agent-v1' },
        { sender: '@bob:private.example', mxcUrl: 'mxc://private.example/bob-v1' },
      ],
    });

    // Avatar-only update emitted as RoomStateEvent.Members also triggers a debounced sync
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    state.users.set('@bob:private.example', { avatarUrl: 'mxc://private.example/bob-v2' });
    await act(async () => {
      state.emit(RoomStateEvent.Members);
      vi.advanceTimersByTime(1100);
    });
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      avatars: [
        { sender: '@agent:private.example', mxcUrl: 'mxc://private.example/agent-v1' },
        { sender: '@bob:private.example', mxcUrl: 'mxc://private.example/bob-v2' },
      ],
    });

    renderer.unmount();
  });
});
