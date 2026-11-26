import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnownMembership, RoomMemberEvent, RoomStateEvent, type MatrixClient } from 'matrix-js-sdk';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import {
  storeNativeNotificationAvatar,
  syncNativeNotificationAccount,
  syncNativeNotificationAvatars,
} from '../../native/nativeNotifications';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  getOrCreateIOSPushProfileTag,
  reconcileIOSPushNativeState,
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

/** A member whose membership event has something else than a string for `avatar_url`. */
const malformedMember = (userId: string, avatarUrl: unknown): RoomMemberStub => ({
  ...joinedMember(userId),
  getMxcAvatarUrl: () => avatarUrl as string,
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
    // False on the Mac app and on Android, which have no iOS notification extension.
    nativeNotificationsAvailable: true,
    nativeAndroid: false,
    hasCompletedInitialSync: false,
    // False for a client that has no token to send to the authenticated media endpoint.
    authenticatedMedia: true,
    activeSession,
    // A permission check that has not answered yet.
    permissionPending: undefined as Promise<void> | undefined,
    // Storage that is full or blocked: a new tag is handed out but not kept.
    tagStorageFails: false,
    onRegistration: undefined as ((token: { value: string }) => void) | undefined,
    onRegistrationError: undefined as ((error: unknown) => void) | undefined,
    appStateListeners: new Set<(appState: { isActive: boolean }) => void>(),
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
      getAccessToken: () => 'mx-token',
      getRooms: vi.fn((): RoomStub[] => state.rooms),
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
        if (event === 'appStateChange') {
          state.appStateListeners.add(listener);
          state.onAppStateChange = (appState) => {
            [...state.appStateListeners].forEach((fn) => fn(appState));
          };
        }
        return {
          remove: vi.fn(async () => {
            if (event === 'appStateChange') {
              state.appStateListeners.delete(listener);
              if (state.appStateListeners.size === 0) state.onAppStateChange = undefined;
            }
          }),
        };
      }
    ),
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, listener: (payload: unknown) => void) => {
      if (event === 'registration') {
        state.onRegistration = listener;
      } else if (event === 'registrationError') {
        state.onRegistrationError = listener;
      }
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
  isNativeAndroidPushPlatform: () => state.nativeAndroid,
  isNativeIOSPlatform: () => !state.nativeAndroid,
  isNativePushPlatform: () => true,
  reconcileIOSPushNativeState: vi.fn(async () => undefined),
  registerIOSPush: vi.fn(async () => undefined),
  resolveEffectiveIOSPushFormat: (pushConfig: { format: 'full' | 'event_id_only' }) =>
    state.hasCloudflareAccess ? 'event_id_only' : pushConfig.format,
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
  isNativeNotificationsAvailable: () => state.nativeNotificationsAvailable,
  storeNativeNotificationAvatar: vi.fn(async () => undefined),
  syncNativeNotificationAccount: vi.fn(async () => undefined),
  // The app has every avatar, unless a test says which ones it lacks.
  syncNativeNotificationAvatars: vi.fn(async () => ({ missingMxcUrls: [], syncGeneration: 1 })),
}));
// The legacy thumbnail URL of an avatar, and the authenticated one it is asked for with the token.
vi.mock('../../matrix/mediaUrl', () => ({
  mxcUrlToHttp: vi.fn(
    (_mx: unknown, mxcUrl: string, _auth: boolean, width: number, height: number, method: string) =>
      `https://private.example/_matrix/media/v3/thumbnail/${mxcUrl.slice(
        'mxc://'.length
      )}?width=${width}&height=${height}&method=${method}`
  ),
}));
vi.mock('../../avatars/avatarMedia', () => ({
  authenticatedAvatarRequest: (_mx: unknown, src: string) =>
    state.authenticatedMedia
      ? {
          url: src.replace('/_matrix/media/v3/', '/_matrix/client/v1/media/'),
          init: { headers: { Authorization: 'Bearer mx-token' } },
        }
      : undefined,
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

/** What the feature asks of `reconcileIOSPushNativeState` when iOS has answered `permission`. */
const reconcileWith = (permission: NativePushPermission) => ({
  clientConfig: state.clientConfig,
  permission,
});

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
    state.nativeNotificationsAvailable = true;
    state.nativeAndroid = false;
    state.onRegistration = undefined;
    state.onRegistrationError = undefined;
    state.hasCompletedInitialSync = false;
    state.authenticatedMedia = true;
    state.activeSession = { sessionId: 's1', accessToken: 'session-token-v1' };
    state.permission = 'granted';
    state.permissionPending = undefined;
    state.tagStorageFails = false;
    state.onRegistration = undefined;
    state.appStateListeners.clear();
    state.onAppStateChange = undefined;
    state.rooms = [];
    state.storedTags.clear();
    state.listeners.clear();
    vi.useRealTimers();
    // Also takes back what a test made a mock answer.
    vi.resetAllMocks();
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

  it('shares each account under its own tag, whatever push.ios.profileTag is configured, and reconciles when its push goes off', async () => {
    state.signInRequired = false;
    const renderer = await mount();

    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      userId: '@me:private.example',
    });

    // Switch to a second account on the same deployment with a shared push.ios.profileTag
    vi.mocked(syncNativeNotificationAccount).mockClear();
    state.activeSession = { sessionId: 's2', accessToken: 'session-token-s2' };
    await rerender(renderer);

    expect(syncNativeNotificationAccount).toHaveBeenCalledWith({
      accountTag: 'tag-s2',
      userId: '@me:private.example',
    });

    // Push goes off for s2: the app is told to keep only the accounts that may still share,
    // which leaves the other account alone. No account is named for removal.
    vi.mocked(syncNativeNotificationAccount).mockClear();
    vi.mocked(reconcileIOSPushNativeState).mockClear();
    state.pushEnabled = false;
    await rerender(renderer);
    expect(reconcileIOSPushNativeState).toHaveBeenCalledTimes(1);
    expect(reconcileIOSPushNativeState).toHaveBeenCalledWith(reconcileWith('granted'));
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('hands the app no access token, and shares nothing anew when the token rotates', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    const renderer = await mount();

    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);

    state.activeSession = { sessionId: 's1', accessToken: 'session-token-v2' };
    await rerender(renderer);

    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    const handedOver = JSON.stringify([
      vi.mocked(syncNativeNotificationAccount).mock.calls,
      vi.mocked(syncNativeNotificationAvatars).mock.calls,
      vi.mocked(reconcileIOSPushNativeState).mock.calls,
    ]);
    expect(handedOver).not.toMatch(/token|https:/i);
    renderer.unmount();
  });

  it('has the app drop the accounts that may no longer share before it shares the account', async () => {
    state.signInRequired = false;
    let answer: () => void = () => undefined;
    vi.mocked(reconcileIOSPushNativeState).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        answer = resolve;
      })
    );

    const renderer = await mount();
    expect(reconcileIOSPushNativeState).toHaveBeenCalledTimes(1);
    expect(reconcileIOSPushNativeState).toHaveBeenCalledWith(reconcileWith('granted'));
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();

    await act(async () => answer());
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('does not share an account whose push went off while the app was reconciling', async () => {
    state.signInRequired = false;
    let answer: () => void = () => undefined;
    vi.mocked(reconcileIOSPushNativeState).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        answer = resolve;
      })
    );
    const renderer = await mount();

    state.pushEnabled = false;
    await rerender(renderer);
    expect(reconcileIOSPushNativeState).toHaveBeenCalledTimes(2);

    // Asked for now, the account would be stored after the reconcile that removes it.
    await act(async () => answer());
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('shares nothing for a server behind Cloudflare Access, whose pushes are event_id_only whatever is configured', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.pushConfig = { appId: 'chat.example', format: 'full' };
    state.hasCloudflareAccess = true;
    state.storedTags.set('s1', 'tag-s1');

    const renderer = await mount();

    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    // What an earlier version of the app shared for the account goes.
    expect(reconcileIOSPushNativeState).toHaveBeenLastCalledWith(reconcileWith('granted'));
    // The pusher itself is registered as before.
    expect(registerIOSPush).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('shares nothing where the app has no notification extension, and registers for pushes all the same', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.nativeNotificationsAvailable = false;
    state.storedTags.set('s1', 'tag-s1');

    const renderer = await mount();
    await act(async () => state.onRegistration?.({ value: 'apns-token' }));

    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(reconcileIOSPushNativeState).not.toHaveBeenCalled();
    // No room's members are gone through for avatars nobody would show.
    expect(state.mx.getRooms).not.toHaveBeenCalled();
    expect(state.onAppStateChange).toBeUndefined();

    expect(registerIOSPush).toHaveBeenCalledTimes(1);
    expect(upsertIOSPushPusher).toHaveBeenCalledWith(
      state.mx,
      expect.anything(),
      'apns-token',
      's1'
    );
    renderer.unmount();
  });

  it('shares the avatars only once the app has stored the account', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    let answer: () => void = () => undefined;
    vi.mocked(syncNativeNotificationAccount).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        answer = resolve;
      })
    );

    // The app keeps avatars only for an account it knows: before it has answered, a list of
    // avatars would be dropped, and not sent again while it stays the same.
    const renderer = await mount();
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    await act(async () => answer());
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith(
      expect.objectContaining({ accountTag: 'tag-s1' })
    );
    renderer.unmount();
  });

  it('shares the avatars of the other members when one has an avatar that is not a string', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [
      {
        roomId: '!agents:private.example',
        getMyMembership: () => KnownMembership.Join,
        getJoinedMembers: () => [
          malformedMember('@broken:private.example', 123),
          malformedMember('@odd:private.example', {}),
          joinedMember('@agent:private.example', 'mxc://private.example/agent-v1'),
        ],
      },
    ];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Thrown in the effect, it would take the whole feature down.
    const renderer = await mount();

    expect(consoleError).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
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
    renderer.unmount();
    consoleError.mockRestore();
  });

  it('tries again, when the app next becomes active, to share an account that the app could not store', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    vi.mocked(syncNativeNotificationAccount).mockRejectedValueOnce(new Error('STORE_ERROR'));

    const renderer = await mount();
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    // Going to the background is no try.
    await act(async () => state.onAppStateChange?.({ isActive: false }));
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);

    // Still refused the next time, and stored the time after that.
    vi.mocked(syncNativeNotificationAccount).mockRejectedValueOnce(new Error('STORE_ERROR'));
    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(2);
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(3);
    expect(syncNativeNotificationAccount).toHaveBeenLastCalledWith({
      accountTag: 'tag-s1',
      userId: '@me:private.example',
    });
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);

    // The account is shared: becoming active again does not re-share the account,
    // while asking native whether any avatars are still missing.
    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(3);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(2);
    renderer.unmount();
    warn.mockRestore();
  });

  it('gates account and avatar sync on push eligibility, reconciles on disable without minting a tag, and re-syncs when re-enabled', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];

    // Push unconfigured with no stored tag: neither syncs nor mints a tag
    state.pushConfig = undefined;
    const renderer = await mount();
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(getOrCreateIOSPushProfileTag).not.toHaveBeenCalled();
    expect(reconcileIOSPushNativeState).toHaveBeenLastCalledWith(reconcileWith('granted'));

    // Configure & enable push: syncs account and avatars
    state.pushConfig = { appId: 'chat.example', format: 'full' };
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);

    // Disable push: the app reconciles its accounts, and nothing is synced
    vi.mocked(syncNativeNotificationAccount).mockClear();
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    vi.mocked(reconcileIOSPushNativeState).mockClear();
    state.pushEnabled = false;
    await rerender(renderer);
    expect(reconcileIOSPushNativeState).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    // Re-enable push: re-syncs both account and avatars (snapshot ref was reset on disable)
    state.pushEnabled = true;
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it.each(['prompt', 'denied'] as const)(
    'shares nothing with the notification extension while the permission of iOS is %s, and has the app reconcile with it',
    async (permission) => {
      state.signInRequired = false;
      state.hasCompletedInitialSync = true;
      state.rooms = [agentRoom()];
      state.permission = permission;
      state.storedTags.set('s1', 'tag-s1');

      const renderer = await mount();

      expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
      expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
      // Without the permission no account may share, also the ones that are not active.
      expect(reconcileIOSPushNativeState).toHaveBeenCalledTimes(1);
      expect(reconcileIOSPushNativeState).toHaveBeenCalledWith(reconcileWith(permission));
      renderer.unmount();
    }
  );

  it('leaves the native accounts alone until the first permission check answers', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.storedTags.set('s1', 'tag-s1');
    let answer: () => void = () => undefined;
    state.permissionPending = new Promise<void>((resolve) => {
      answer = resolve;
    });

    const renderer = await mount();
    expect(reconcileIOSPushNativeState).not.toHaveBeenCalled();
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    await act(async () => answer());
    expect(reconcileIOSPushNativeState).toHaveBeenCalledTimes(1);
    expect(reconcileIOSPushNativeState).toHaveBeenCalledWith(reconcileWith('granted'));
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('shares nothing for event_id_only pushes, which name no sender, and has the app reconcile', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.pushConfig = { appId: 'chat.example', format: 'event_id_only' };
    state.storedTags.set('s1', 'tag-s1');

    const renderer = await mount();

    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    expect(reconcileIOSPushNativeState).toHaveBeenLastCalledWith(reconcileWith('granted'));

    // Full pushes again: the account and its avatars are shared.
    state.pushConfig = { appId: 'chat.example', format: 'full' };
    await rerender(renderer);
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
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
      userId: '@me:private.example',
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

    // Withdrawn in iOS Settings: the app reconciles, which removes every account.
    vi.mocked(syncNativeNotificationAccount).mockClear();
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    vi.mocked(reconcileIOSPushNativeState).mockClear();
    state.permission = 'denied';
    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(reconcileIOSPushNativeState).toHaveBeenCalledTimes(1);
    expect(reconcileIOSPushNativeState).toHaveBeenCalledWith(reconcileWith('denied'));
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();

    // Allowed once more: both are shared again, the avatars although they did not change.
    state.permission = 'granted';
    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(syncNativeNotificationAccount).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('shares nothing under a tag that storage did not keep, which the next reconcile would remove', async () => {
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    state.rooms = [agentRoom()];
    state.pushConfig = { appId: 'chat.example', format: 'full' };
    state.tagStorageFails = true;

    const renderer = await mount();

    expect(getOrCreateIOSPushProfileTag).toHaveBeenCalledWith('s1');
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
    // Nor does it try on every return to the app.
    await act(async () => state.onAppStateChange?.({ isActive: true }));
    expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('takes a member who removes the avatar off the list, also when 200 others still fill it', async () => {
    vi.useFakeTimers();
    state.signInRequired = false;
    state.hasCompletedInitialSync = true;
    let firstAvatar: string | null = 'mxc://private.example/member000';
    const members = [
      { ...joinedMember('@member000:private.example'), getMxcAvatarUrl: () => firstAvatar },
      ...Array.from({ length: 200 }, (_, index) => {
        const name = `member${String(index + 1).padStart(3, '0')}`;
        return joinedMember(`@${name}:private.example`, `mxc://private.example/${name}`);
      }),
    ];
    state.rooms = [
      {
        roomId: '!big:private.example',
        getMyMembership: () => KnownMembership.Join,
        getJoinedMembers: () => members,
      },
    ];

    // 201 members have an avatar: the list holds the first 200, member000 among them.
    const renderer = await mount();
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    const before = vi.mocked(syncNativeNotificationAvatars).mock.calls[0]?.[0].avatars ?? [];
    expect(before).toHaveLength(200);
    expect(before[0]?.sender).toBe('@member000:private.example');
    expect(before[199]?.sender).toBe('@member199:private.example');

    // member000 removes the avatar. The app drops every cached avatar that is not on the list,
    // so the member must be gone from it although the list is as long as before.
    vi.mocked(syncNativeNotificationAvatars).mockClear();
    firstAvatar = null;
    await act(async () => {
      state.emit(RoomStateEvent.Members);
      vi.advanceTimersByTime(1100);
    });
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    const after = vi.mocked(syncNativeNotificationAvatars).mock.calls[0]?.[0].avatars ?? [];
    expect(after).toHaveLength(200);
    expect(after.some((avatar) => avatar.sender === '@member000:private.example')).toBe(false);
    expect(after[199]?.sender).toBe('@member200:private.example');

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

    // The agent has an avatar in room two only: in room one, as Bob, it is not listed.
    const agentInTwo = {
      roomId: '!two:private.example',
      sender: '@agent:private.example',
      mxcUrl: 'mxc://private.example/agent-v1',
    };
    const bobInOne = { roomId: '!one:private.example', sender: '@bob:private.example' };
    expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
    expect(syncNativeNotificationAvatars).toHaveBeenCalledWith({
      accountTag: 'tag-s1',
      avatars: [agentInTwo],
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
      avatars: [{ ...bobInOne, mxcUrl: 'mxc://private.example/bob-v1' }, agentInTwo],
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
      avatars: [{ ...bobInOne, mxcUrl: 'mxc://private.example/bob-v2' }, agentInTwo],
    });

    renderer.unmount();
  });

  describe('the avatars the app lacks', () => {
    const MEDIA = 'https://private.example/_matrix/media/v3/thumbnail/private.example/';
    const AUTHENTICATED_MEDIA =
      'https://private.example/_matrix/client/v1/media/thumbnail/private.example/';
    const THUMBNAIL = '?width=128&height=128&method=crop';
    const MAX_BYTES = 512 * 1024;
    const withToken = {
      headers: { Authorization: 'Bearer mx-token' },
      signal: expect.any(AbortSignal) as AbortSignal,
    };
    const withoutToken = { signal: expect.any(AbortSignal) as AbortSignal };
    const fetchMock = vi.fn<typeof fetch>();

    const mxc = (mediaId: string) => `mxc://private.example/${mediaId}`;
    const image = (bytes: number[] | Uint8Array, init?: ResponseInit) =>
      new Response(new Uint8Array(bytes), init);
    /** A room whose members are named after the avatars they have. */
    const roomOf = (roomId: string, ...mediaIds: string[]): RoomStub => ({
      roomId,
      getMyMembership: () => KnownMembership.Join,
      getJoinedMembers: () =>
        mediaIds.map((mediaId) => joinedMember(`@${mediaId}:private.example`, mxc(mediaId))),
    });
    /** The app answers that it lacks these avatars, for a sync whose generation is 7. */
    const appLacks = (...mediaIds: string[]) => {
      vi.mocked(syncNativeNotificationAvatars).mockResolvedValue({
        missingMxcUrls: mediaIds.map(mxc),
        syncGeneration: 7,
      });
    };
    const storedMxcUrls = () =>
      vi.mocked(storeNativeNotificationAvatar).mock.calls.map(([avatar]) => avatar.mxcUrl);
    const fetchedUrls = () => fetchMock.mock.calls.map(([input]) => String(input));
    /** A download that the test answers when it chooses. */
    const heldDownloads = () => {
      const answers: ((response: Response) => void)[] = [];
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            answers.push(resolve);
          })
      );
      return answers;
    };

    beforeEach(() => {
      state.signInRequired = false;
      state.hasCompletedInitialSync = true;
      fetchMock.mockReset();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('downloads each of them once and hands it to the app for every room that shows it', async () => {
      state.rooms = [
        roomOf('!one:private.example', 'agent', 'bob'),
        roomOf('!two:private.example', 'agent', 'cached'),
      ];
      appLacks('agent', 'bob');
      fetchMock.mockImplementation(async (input) =>
        image(String(input).includes('/agent?') ? [1, 2, 3] : [4, 5])
      );

      const renderer = await mount();
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(2));

      // A 128 pixel thumbnail, asked of the authenticated endpoint with the token in a header.
      expect(mxcUrlToHttp).toHaveBeenCalledWith(state.mx, mxc('agent'), false, 128, 128, 'crop');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(`${AUTHENTICATED_MEDIA}agent${THUMBNAIL}`, withToken);
      expect(fetchMock).toHaveBeenCalledWith(`${AUTHENTICATED_MEDIA}bob${THUMBNAIL}`, withToken);
      // Nothing is downloaded that the app has.
      expect(fetchedUrls().some((url) => url.includes('cached'))).toBe(false);

      expect(storeNativeNotificationAvatar).toHaveBeenCalledWith({
        accountTag: 'tag-s1',
        syncGeneration: 7,
        mxcUrl: mxc('agent'),
        entries: [
          { roomId: '!one:private.example', sender: '@agent:private.example' },
          { roomId: '!two:private.example', sender: '@agent:private.example' },
        ],
        base64Data: 'AQID',
      });
      expect(storeNativeNotificationAvatar).toHaveBeenCalledWith({
        accountTag: 'tag-s1',
        syncGeneration: 7,
        mxcUrl: mxc('bob'),
        entries: [{ roomId: '!one:private.example', sender: '@bob:private.example' }],
        base64Data: 'BAU=',
      });
      // The token went to the homeserver only.
      expect(JSON.stringify(vi.mocked(storeNativeNotificationAvatar).mock.calls)).not.toMatch(
        /token/i
      );
      renderer.unmount();
    });

    it('asks a server without authenticated media again for the legacy thumbnail, without the token', async () => {
      state.rooms = [roomOf('!one:private.example', 'missing', 'unrecognized', 'forbidden')];
      appLacks('missing', 'unrecognized', 'forbidden');
      fetchMock.mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith(MEDIA)) return image([9]);
        if (url.includes('/missing?')) return new Response(null, { status: 404 });
        if (url.includes('/unrecognized?')) {
          return Response.json({ errcode: 'M_UNRECOGNIZED' }, { status: 400 });
        }
        return Response.json({ errcode: 'M_FORBIDDEN' }, { status: 403 });
      });

      const renderer = await mount();
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(2));

      expect(fetchMock).toHaveBeenCalledWith(`${MEDIA}missing${THUMBNAIL}`, withoutToken);
      expect(fetchMock).toHaveBeenCalledWith(`${MEDIA}unrecognized${THUMBNAIL}`, withoutToken);
      // A server that has the endpoint and refuses is not asked again.
      expect(fetchedUrls()).not.toContain(`${MEDIA}forbidden${THUMBNAIL}`);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(storedMxcUrls().sort()).toEqual([mxc('missing'), mxc('unrecognized')]);
      renderer.unmount();
    });

    it('asks for the legacy thumbnail at once when there is no token to send', async () => {
      state.authenticatedMedia = false;
      state.rooms = [roomOf('!one:private.example', 'agent')];
      appLacks('agent');
      fetchMock.mockImplementation(async () => image([9]));

      const renderer = await mount();
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(1));

      expect(fetchMock.mock.calls).toEqual([[`${MEDIA}agent${THUMBNAIL}`, withoutToken]]);
      renderer.unmount();
    });

    it('leaves out an avatar that is too large, empty or cannot be loaded, and goes on with the others', async () => {
      const mediaIds = ['announced-large', 'large', 'empty', 'refused', 'unreachable', 'largest'];
      state.rooms = [roomOf('!one:private.example', ...mediaIds, 'small')];
      appLacks(...mediaIds, 'small');
      fetchMock.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/announced-large?')) {
          return image([1], { headers: { 'content-length': String(MAX_BYTES + 1) } });
        }
        if (url.includes('/large?')) return image(new Uint8Array(MAX_BYTES + 1));
        if (url.includes('/empty?')) return image([]);
        if (url.includes('/refused?')) return new Response(null, { status: 500 });
        if (url.includes('/unreachable?')) throw new TypeError('Load failed');
        if (url.includes('/largest?')) return image(new Uint8Array(MAX_BYTES));
        return image([1]);
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const renderer = await mount();
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(2));

      expect(fetchMock).toHaveBeenCalledTimes(7);
      expect(storedMxcUrls().sort()).toEqual([mxc('largest'), mxc('small')]);
      // The list reached the app: it is not sent again for the avatars that were left out.
      expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
      renderer.unmount();
      warn.mockRestore();
    });

    it('goes on with the others when the app does not take one', async () => {
      state.rooms = [roomOf('!one:private.example', 'agent', 'bob')];
      appLacks('agent', 'bob');
      fetchMock.mockImplementation(async () => image([9]));
      vi.mocked(storeNativeNotificationAvatar).mockRejectedValueOnce(new Error('INVALID'));

      const renderer = await mount();
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(2));

      expect(storedMxcUrls().sort()).toEqual([mxc('agent'), mxc('bob')]);
      renderer.unmount();
    });

    it('downloads four of them at a time', async () => {
      const mediaIds = Array.from({ length: 10 }, (_, index) => `member${index}`);
      state.rooms = [roomOf('!one:private.example', ...mediaIds)];
      appLacks(...mediaIds);
      let underWay = 0;
      let mostUnderWay = 0;
      let holding = true;
      const held: (() => void)[] = [];
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            underWay += 1;
            mostUnderWay = Math.max(mostUnderWay, underWay);
            const answer = () => {
              underWay -= 1;
              resolve(image([9]));
            };
            if (holding) held.push(answer);
            else answer();
          })
      );

      const renderer = await mount();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
      expect(storeNativeNotificationAvatar).not.toHaveBeenCalled();

      // One answer makes room for one more.
      held.shift()?.();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
      expect(underWay).toBe(4);

      holding = false;
      held.splice(0).forEach((answer) => answer());
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(10));
      expect(mostUnderWay).toBe(4);
      expect(storedMxcUrls().sort()).toEqual(mediaIds.map(mxc).sort());
      renderer.unmount();
    });

    it('stops the downloads of a list once a newer list replaces it', async () => {
      vi.useFakeTimers();
      let agentAvatar = mxc('agent-v1');
      state.rooms = [
        {
          roomId: '!one:private.example',
          getMyMembership: () => KnownMembership.Join,
          getJoinedMembers: () => [joinedMember('@agent:private.example', agentAvatar)],
        },
      ];
      appLacks('agent-v1');
      const answers = heldDownloads();

      const renderer = await mount();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;
      expect(firstSignal?.aborted).toBe(false);

      // The agent changes its avatar while the old one is still downloading.
      agentAvatar = mxc('agent-v2');
      vi.mocked(syncNativeNotificationAvatars).mockResolvedValue({
        missingMxcUrls: [mxc('agent-v2')],
        syncGeneration: 8,
      });
      await act(async () => {
        state.emit(RoomStateEvent.Members);
        vi.advanceTimersByTime(1100);
      });
      expect(firstSignal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondSignal = fetchMock.mock.calls[1]?.[1]?.signal;
      expect(secondSignal?.aborted).toBe(false);

      // The old avatar arrives all the same: it is not handed to the app.
      await act(async () => answers[0]?.(image([1])));
      expect(storeNativeNotificationAvatar).not.toHaveBeenCalled();

      await act(async () => answers[1]?.(image([2])));
      expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(1);
      expect(storeNativeNotificationAvatar).toHaveBeenCalledWith(
        expect.objectContaining({ syncGeneration: 8, mxcUrl: mxc('agent-v2') })
      );
      renderer.unmount();
    });

    it('stops the downloads when push goes off, and when the feature goes away', async () => {
      state.rooms = [roomOf('!one:private.example', 'agent')];
      appLacks('agent');
      const answers = heldDownloads();

      const renderer = await mount();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;
      expect(firstSignal?.aborted).toBe(false);

      state.pushEnabled = false;
      await rerender(renderer);
      expect(firstSignal?.aborted).toBe(true);
      await act(async () => answers[0]?.(image([1])));
      expect(storeNativeNotificationAvatar).not.toHaveBeenCalled();

      // On again, the list is sent again and the avatar downloaded anew.
      state.pushEnabled = true;
      await rerender(renderer);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const secondSignal = fetchMock.mock.calls[1]?.[1]?.signal;
      expect(secondSignal?.aborted).toBe(false);

      await act(async () => renderer.unmount());
      expect(secondSignal?.aborted).toBe(true);
    });

    it('sends the list again after its downloads were cut off, and not after they were done', async () => {
      state.rooms = [roomOf('!one:private.example', 'agent')];
      appLacks('agent');
      const answers = heldDownloads();
      const renderer = await mount();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      // The client starts over while the avatar is downloading.
      state.hasCompletedInitialSync = false;
      await rerender(renderer);
      state.hasCompletedInitialSync = true;
      await rerender(renderer);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(2);

      await act(async () => answers[1]?.(image([1])));
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(1));

      // Done this time: the same list is not sent a third time.
      state.hasCompletedInitialSync = false;
      await rerender(renderer);
      state.hasCompletedInitialSync = true;
      await rerender(renderer);
      expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(2);
      renderer.unmount();
    });

    it('sends the list again with the next change when it did not reach the app', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      state.rooms = [agentRoom()];
      vi.mocked(syncNativeNotificationAvatars).mockRejectedValueOnce(new Error('no answer'));

      const renderer = await mount();
      expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);

      // The members are as they were, and the list is sent all the same.
      await act(async () => {
        state.emit(RoomMemberEvent.Membership);
        vi.advanceTimersByTime(1100);
      });
      expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(2);
      expect(fetchMock).not.toHaveBeenCalled();
      renderer.unmount();
      warn.mockRestore();
    });

    it('cancels oversized streaming avatar and error responses without buffering unboundedly', async () => {
      const makeStream = (chunkSize: number) => {
        const tracker = { pulls: 0, cancelled: false };
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            tracker.pulls += 1;
            controller.enqueue(new Uint8Array(chunkSize));
          },
          cancel() {
            tracker.cancelled = true;
          },
        });
        return { stream, tracker };
      };
      const avatarStream = makeStream(128 * 1024);
      const errorStream = makeStream(2048);

      state.rooms = [roomOf('!one:private.example', 'stream-large', 'stream-error', 'small')];
      appLacks('stream-large', 'stream-error', 'small');
      fetchMock.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/stream-large?'))
          return new Response(avatarStream.stream, { status: 200 });
        if (url.includes('/stream-error?'))
          return new Response(errorStream.stream, { status: 400 });
        return image([7]);
      });

      const renderer = await mount();
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => {
        expect(avatarStream.tracker.cancelled).toBe(true);
        expect(errorStream.tracker.cancelled).toBe(true);
      });

      expect(storedMxcUrls()).toEqual([mxc('small')]);
      expect(avatarStream.tracker.pulls).toBeLessThanOrEqual(6);
      expect(errorStream.tracker.pulls).toBeLessThanOrEqual(6);
      renderer.unmount();
    });

    it('retries missing avatars on foreground and online events with an unchanged member list', async () => {
      const onlineTarget = new EventTarget();
      vi.stubGlobal('window', onlineTarget);
      state.rooms = [roomOf('!one:private.example', 'agent', 'bob')];
      appLacks('agent', 'bob');
      let allowAgent = false;
      let allowBob = false;
      fetchMock.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/agent?') && allowAgent) return image([1, 2]);
        if (url.includes('/bob?') && allowBob) return image([3, 4]);
        throw new TypeError('offline');
      });

      const renderer = await mount();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(1);
      expect(storeNativeNotificationAvatar).not.toHaveBeenCalled();

      // Returning to foreground retries missing avatars even though the member list did not change.
      allowAgent = true;
      await act(async () => state.onAppStateChange?.({ isActive: true }));
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(1));
      expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(2);
      expect(storedMxcUrls()).toEqual([mxc('agent')]);

      // Coming back online retries whatever native still reports as missing.
      appLacks('bob');
      allowBob = true;
      await act(async () => {
        onlineTarget.dispatchEvent(new Event('online'));
      });
      await vi.waitFor(() => expect(storeNativeNotificationAvatar).toHaveBeenCalledTimes(2));
      expect(syncNativeNotificationAvatars).toHaveBeenCalledTimes(3);
      expect(storedMxcUrls()).toEqual([mxc('agent'), mxc('bob')]);
      renderer.unmount();
    });
  });

  describe('on native Android', () => {
    it('registers FCM and upserts the pusher without calling iOS notification extension APIs', async () => {
      state.nativeAndroid = true;
      state.nativeNotificationsAvailable = false;
      state.signInRequired = false;
      state.hasCompletedInitialSync = true;
      state.rooms = [agentRoom()];

      const renderer = await mount();

      expect(registerIOSPush).toHaveBeenCalledTimes(1);
      await act(async () => state.onRegistration?.({ value: 'fcm-token-abc' }));

      expect(upsertIOSPushPusher).toHaveBeenCalledWith(
        state.mx,
        expect.anything(),
        'fcm-token-abc',
        's1'
      );
      expect(syncNativeNotificationAccount).not.toHaveBeenCalled();
      expect(syncNativeNotificationAvatars).not.toHaveBeenCalled();
      expect(reconcileIOSPushNativeState).not.toHaveBeenCalled();
      renderer.unmount();
    });

    it('logs platform context and keeps push enabled when FCM registration fails', async () => {
      state.nativeAndroid = true;
      state.nativeNotificationsAvailable = false;
      state.signInRequired = false;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.mocked(registerIOSPush).mockRejectedValueOnce(
        new Error('Default FirebaseApp is not initialized')
      );

      const renderer = await mount();
      await act(async () => state.onRegistrationError?.({ error: 'SERVICE_NOT_AVAILABLE' }));

      expect(warn).toHaveBeenCalledWith(
        '[android-push] could not register with FCM',
        expect.any(Error)
      );
      expect(warn).toHaveBeenCalledWith('[android-push] FCM registration failed', {
        error: 'SERVICE_NOT_AVAILABLE',
      });
      expect(setIOSPushEnabled).not.toHaveBeenCalled();

      warn.mockRestore();
      renderer.unmount();
    });
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

  it('lists the avatar a member has in each room, the most recently active room first, and no member without one', () => {
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
    ]);
  });

  it('leaves a member out of a room where it has no avatar, whatever avatar the SDK user carries', () => {
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
    ]);
  });

  it('caps the list at 200 entries, keeping the avatars of the most active rooms', () => {
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

  it('passes over an avatar that is not a string, as a malformed membership event can carry it', () => {
    const rooms = [
      room('!a:private.example', 100, [
        malformedMember('@number:private.example', 123),
        malformedMember('@object:private.example', {}),
        malformedMember('@list:private.example', ['mxc://private.example/in-a-list']),
        joinedMember('@http:private.example', 'https://private.example/avatar.png'),
        joinedMember('@valid:private.example', 'mxc://private.example/valid'),
        joinedMember('@zoe:private.example', 'mxc://private.example/zoe'),
      ]),
    ];

    expect(() => collect(rooms)).not.toThrow();
    expect(collect(rooms)).toEqual([
      {
        roomId: '!a:private.example',
        sender: '@valid:private.example',
        mxcUrl: 'mxc://private.example/valid',
      },
      {
        roomId: '!a:private.example',
        sender: '@zoe:private.example',
        mxcUrl: 'mxc://private.example/zoe',
      },
    ]);
  });
});
