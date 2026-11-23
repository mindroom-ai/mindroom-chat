import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnownMembership, RoomMemberEvent, RoomStateEvent, type MatrixClient } from 'matrix-js-sdk';
import {
  clearAllNativeNotificationAccounts,
  clearNativeNotificationAccount,
  syncNativeNotificationAccount,
  syncNativeNotificationAvatars,
} from '../../native/nativeNotifications';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  getOrCreateIOSPushProfileTag,
  registerIOSPush,
  setIOSPushEnabled,
  upsertIOSPushPusher,
  type NativePushPermission,
} from './iosPush';
import { collectJoinedMemberAvatars, NativeIOSPushFeature } from './IOSPushFeature';

type RoomMemberStub = {
  userId: string;
  membership: string;
  getMxcAvatarUrl: () => string | null | undefined;
};

type RoomStub = {
  roomId: string;
  getMyMembership: () => string;
  getLastActiveTimestamp?: () => number;
  getJoinedMembers: () => RoomMemberStub[];
};

type PushConfigStub = { appId: string; format: 'full' | 'event_id_only'; profileTag?: string };

const joinedMember = (userId: string, mxcUrl: string | null = null): RoomMemberStub => ({
  userId,
  membership: KnownMembership.Join,
  getMxcAvatarUrl: () => mxcUrl,
});

const state = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const storedTags = new Map<string, string>();
  const activeSession: { sessionId: string; accessToken?: string } | undefined = {
    sessionId: 's1',
    accessToken: 'session-token-v1',
  };
  // Typed wider than their first values, which tests replace.
  const push: { pushConfig: PushConfigStub | undefined; permission: NativePushPermission } = {
    pushConfig: {
      appId: 'chat.example',
      format: 'full',
      profileTag: 'shared-deployment-profile-tag',
    },
    permission: 'granted',
  };
  return {
    ...push,
    signInRequired: true,
    pushAllowed: true,
    pushEnabled: true,
    hasCloudflareAccess: false,
    hasCompletedInitialSync: false,
    activeSession,
    // A permission check that has not answered yet.
    permissionPending: undefined as Promise<void> | undefined,
    // Storage that is full or blocked: a new tag is handed out but not kept.
    tagStorageFails: false,
    onRegistration: undefined as ((token: { value: string }) => void) | undefined,
    onAppStateChange: undefined as ((appState: { isActive: boolean }) => void) | undefined,
    rooms: [] as RoomStub[],
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

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(
      async (event: string, listener: (appState: { isActive: boolean }) => void) => {
        if (event === 'appStateChange') state.onAppStateChange = listener;
        return { remove: vi.fn(async () => undefined) };
      }
    ),
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, listener: (token: { value: string }) => void) => {
      if (event === 'registration') state.onRegistration = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  },
}));

vi.mock('./iosPush', () => ({
  checkIOSPushPermission: vi.fn(async () => {
    await state.permissionPending;
    return state.permission;
  }),
  disableIOSPushPusher: vi.fn(async () => undefined),
  getStoredIOSPushProfileTag: vi.fn((sessionId?: string) =>
    sessionId ? state.storedTags.get(sessionId) : undefined
  ),
  getOrCreateIOSPushProfileTag: vi.fn((sessionId?: string) => {
    const key = sessionId ?? 'default';
    const existing = state.storedTags.get(key);
    if (existing) return existing;
    const tag = `tag-${key}`;
    if (!state.tagStorageFails) state.storedTags.set(key, tag);
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
  clearAllNativeNotificationAccounts: vi.fn(async () => undefined),
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

const agentRoom = (): RoomStub => ({
  roomId: '!agents:private.example',
  getMyMembership: () => KnownMembership.Join,
  getJoinedMembers: () => [
    joinedMember('@agent:private.example', 'mxc://private.example/agent-v1'),
  ],
});

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
    state.permission = 'granted';
    state.permissionPending = undefined;
    state.tagStorageFails = false;
    state.onRegistration = undefined;
    state.onAppStateChange = undefined;
    state.rooms = [];
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
    state.rooms = [agentRoom()];

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

  it('shares nothing with the notification extension before iOS is asked for the permission, and clears what the account has', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.permission = 'prompt';
    state.storedTags.set('s1', 'tag-s1');

    const renderer = await mount();

    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-s1');
    expect(clearAllNativeNotificationAccounts).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('shares nothing with the notification extension while iOS denies notifications, and clears every account', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.permission = 'denied';
    state.storedTags.set('s1', 'tag-s1');

    const renderer = await mount();

    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(clearAllNativeNotificationAccounts).toHaveBeenCalledTimes(1);
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('clears only the active account when its push is turned off, and both accounts when iOS denies notifications', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];

    // Two accounts on the device, each sharing its own record.
    const renderer = await mount();
    state.activeSession = { sessionId: 's2', accessToken: 'session-token-s2' };
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountTag: 'tag-s1' })
    );
    expect(syncNativeNotificationAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountTag: 'tag-s2' })
    );

    // The switch in the app belongs to the active account: the other one keeps what it shares.
    state.pushEnabled = false;
    await rerender(renderer);
    expect(clearNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-s2');
    expect(clearAllNativeNotificationAccounts).not.toHaveBeenCalled();

    state.pushEnabled = true;
    await rerender(renderer);
    vi.mocked(clearNativeNotificationAccount).mockClear();

    // iOS Settings turn notifications off for the whole app, so for the account that is not
    // active too.
    state.permission = 'denied';
    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(clearAllNativeNotificationAccounts).toHaveBeenCalledTimes(1);
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('leaves the native account alone until the first permission check answers', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.storedTags.set('s1', 'tag-s1');
    let answer: () => void = () => undefined;
    state.permissionPending = new Promise((resolve) => {
      answer = resolve;
    });

    const renderer = await mount();
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    await act(async () => answer());
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('shares nothing for event_id_only pushes, which name no sender, and clears what it has', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.pushConfig = { appId: 'chat.example', format: 'event_id_only' };
    state.storedTags.set('s1', 'tag-s1');

    const renderer = await mount();

    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(clearNativeNotificationAccount).toHaveBeenCalledWith('tag-s1');

    // Full pushes again: the account and its avatars are shared.
    vi.mocked(clearNativeNotificationAccount).mockClear();
    state.pushConfig = { appId: 'chat.example', format: 'full' };
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('follows the iOS permission when the app becomes active again', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.permission = 'prompt';

    const renderer = await mount();
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    // Allowed in iOS Settings (or in the system prompt) while the app was not active.
    state.permission = 'granted';
    const checksBefore = vi.mocked(checkIOSPushPermission).mock.calls.length;
    await act(async () => state.onAppStateChange?.({ isActive: false }));
    expect(checkIOSPushPermission).toHaveBeenCalledTimes(checksBefore);
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();

    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      homeserverUrl: 'https://private.example',
      userId: '@me:private.example',
      accessToken: 'session-token-v1',
    });
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      avatars: [
        {
          roomId: '!agents:private.example',
          sender: '@agent:private.example',
          mxcUrl: 'mxc://private.example/agent-v1',
        },
      ],
    });

    // Withdrawn in iOS Settings: the accounts and their avatars go.
    vi.mocked(syncNativeNotificationAccount).mockClear();
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    vi.mocked(clearNativeNotificationAccount).mockClear();
    state.permission = 'denied';
    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(clearAllNativeNotificationAccounts).toHaveBeenCalledTimes(1);
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    // Allowed once more: both are shared again, the avatars although they did not change.
    state.permission = 'granted';
    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('shares nothing under a tag that storage did not keep, which sign-out could not clear', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.pushConfig = { appId: 'chat.example', format: 'full' };
    state.tagStorageFails = true;

    const renderer = await mount();

    expect(getOrCreateIOSPushProfileTag).toHaveBeenCalledWith('s1');
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(clearNativeNotificationAccount).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('syncs joined member avatars after initial sync and debounces membership, room-state member, and avatar updates', async () => {
    vi.useFakeTimers();
    state.signInRequired = false;
    let bobAvatar: string | null = null;
    state.rooms = [
      {
        roomId: '!one:private.example',
        getMyMembership: () => KnownMembership.Join,
        getJoinedMembers: () => [
          joinedMember('@me:private.example', 'mxc://private.example/me'),
          joinedMember('@agent:private.example'),
          { ...joinedMember('@bob:private.example'), getMxcAvatarUrl: () => bobAvatar },
        ],
      },
      {
        roomId: '!two:private.example',
        getMyMembership: () => KnownMembership.Join,
        getJoinedMembers: () => [
          joinedMember('@agent:private.example', 'mxc://private.example/agent-v1'),
        ],
      },
      {
        roomId: '!left:private.example',
        getMyMembership: () => KnownMembership.Leave,
        getJoinedMembers: () => [
          joinedMember('@left:private.example', 'mxc://private.example/left'),
        ],
      },
    ];

    const renderer = await mount();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    state.hasCompletedInitialSync = true;
    await rerender(renderer);

    // The agent's avatar in room two is not its avatar in room one, where it has none.
    const agentInTwo = {
      roomId: '!two:private.example',
      sender: '@agent:private.example',
      mxcUrl: 'mxc://private.example/agent-v1',
    };
    const agentInOne = {
      roomId: '!one:private.example',
      sender: '@agent:private.example',
      mxcUrl: null,
    };
    const bobInOne = { roomId: '!one:private.example', sender: '@bob:private.example' };
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      avatars: [agentInTwo, agentInOne, { ...bobInOne, mxcUrl: null }],
    });

    // Unchanged event should not re-invoke syncNativeNotificationAvatars
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    await act(async () => {
      state.emit(RoomMemberEvent.Membership);
      vi.advanceTimersByTime(1100);
    });
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    // A changed avatar reported by two events in a row triggers a single debounced sync
    bobAvatar = 'mxc://private.example/bob-v1';
    await act(async () => {
      state.emit(RoomStateEvent.Members);
      state.emit(RoomMemberEvent.Membership);
      vi.advanceTimersByTime(1100);
    });
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      avatars: [{ ...bobInOne, mxcUrl: 'mxc://private.example/bob-v1' }, agentInTwo, agentInOne],
    });

    // Avatar-only update emitted as RoomStateEvent.Members also triggers a debounced sync
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    bobAvatar = 'mxc://private.example/bob-v2';
    await act(async () => {
      state.emit(RoomStateEvent.Members);
      vi.advanceTimersByTime(1100);
    });
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      avatars: [{ ...bobInOne, mxcUrl: 'mxc://private.example/bob-v2' }, agentInTwo, agentInOne],
    });

    renderer.unmount();
  });
});

describe('collectJoinedMemberAvatars', () => {
  const collect = (rooms: RoomStub[], userAvatars = new Map<string, string>()) =>
    collectJoinedMemberAvatars({
      getUserId: () => '@me:private.example',
      getRooms: () => rooms,
      getUser: (userId: string) => {
        const avatarUrl = userAvatars.get(userId);
        return avatarUrl ? { avatarUrl } : null;
      },
    } as unknown as MatrixClient);

  const room = (roomId: string, lastActive: number, members: RoomMemberStub[]): RoomStub => ({
    roomId,
    getMyMembership: () => KnownMembership.Join,
    getLastActiveTimestamp: () => lastActive,
    getJoinedMembers: () => members,
  });

  it('keeps the avatar a member has in each room, the most recently active room first', () => {
    const avatars = collect([
      room('!quiet:private.example', 100, [
        joinedMember('@agent:private.example', 'mxc://private.example/agent-quiet'),
      ]),
      room('!busy:private.example', 300, [
        joinedMember('@zoe:private.example', 'mxc://private.example/zoe'),
        joinedMember('@agent:private.example', 'mxc://private.example/agent-busy'),
        joinedMember('@me:private.example', 'mxc://private.example/me'),
        joinedMember('@plain:private.example'),
      ]),
    ]);

    expect(avatars).toEqual([
      {
        roomId: '!busy:private.example',
        sender: '@agent:private.example',
        mxcUrl: 'mxc://private.example/agent-busy',
      },
      {
        roomId: '!busy:private.example',
        sender: '@zoe:private.example',
        mxcUrl: 'mxc://private.example/zoe',
      },
      {
        roomId: '!quiet:private.example',
        sender: '@agent:private.example',
        mxcUrl: 'mxc://private.example/agent-quiet',
      },
      { roomId: '!busy:private.example', sender: '@plain:private.example', mxcUrl: null },
    ]);
  });

  it('gives a member without an avatar in a room none there, whatever avatar the SDK user carries', () => {
    // The SDK copies the avatar of a membership into its `User`, here the one of room A.
    const avatars = collect(
      [
        room('!a:private.example', 200, [
          joinedMember('@agent:private.example', 'mxc://private.example/agent-in-a'),
        ]),
        room('!b:private.example', 100, [joinedMember('@agent:private.example')]),
      ],
      new Map([['@agent:private.example', 'mxc://private.example/agent-in-a']])
    );

    expect(avatars).toEqual([
      {
        roomId: '!a:private.example',
        sender: '@agent:private.example',
        mxcUrl: 'mxc://private.example/agent-in-a',
      },
      { roomId: '!b:private.example', sender: '@agent:private.example', mxcUrl: null },
    ]);
  });

  it('caps the list at 200 entries, keeping avatars of active rooms over the rest', () => {
    const members = (prefix: string, count: number, withAvatar: boolean) =>
      Array.from({ length: count }, (_, index) => {
        const name = `${prefix}${String(index).padStart(3, '0')}`;
        return joinedMember(
          `@${name}:private.example`,
          withAvatar ? `mxc://private.example/${name}` : null
        );
      });

    const avatars = collect([
      room('!older:private.example', 100, members('older', 120, true)),
      room('!newer:private.example', 200, [
        ...members('newer', 150, true),
        ...members('plain', 100, false),
      ]),
      room('!oldest:private.example', 50, members('oldest', 10, true)),
    ]);

    expect(avatars).toHaveLength(200);
    expect(avatars.every((avatar) => avatar.mxcUrl !== null)).toBe(true);
    expect(avatars.filter((avatar) => avatar.roomId === '!newer:private.example')).toHaveLength(
      150
    );
    expect(avatars.slice(150).map((avatar) => avatar.sender)).toEqual(
      Array.from(
        { length: 50 },
        (_, index) => `@older${String(index).padStart(3, '0')}:private.example`
      )
    );
  });
});
