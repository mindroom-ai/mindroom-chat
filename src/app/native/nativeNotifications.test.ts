import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNativeNotificationAvatarCache,
  isNativeNotificationsAvailable,
  reconcileNativeNotificationAccounts,
  storeNativeNotificationAvatar,
  syncNativeNotificationAccount,
  syncNativeNotificationAvatars,
} from './nativeNotifications';

const plugin = vi.hoisted(() => ({
  syncAccount: vi.fn(),
  reconcileAccounts: vi.fn(),
  syncAvatars: vi.fn(),
  storeAvatar: vi.fn(),
  clearAvatarCache: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => plugin),
}));

const setAvailable = (
  available: boolean,
  platform: 'ios' | 'web' | 'android' = available ? 'ios' : 'web'
) => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(available);
  vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(available);
};

const account = { accountTag: 'tag-1', userId: '@bas:mindroom.chat' };
const avatarSync = {
  accountTag: 'tag-1',
  avatars: [
    {
      roomId: '!room:mindroom.chat',
      sender: '@dev:mindroom.chat',
      mxcUrl: 'mxc://mindroom.chat/a1',
    },
    {
      roomId: '!other:mindroom.chat',
      sender: '@dev:mindroom.chat',
      mxcUrl: 'mxc://mindroom.chat/a2',
    },
  ],
};
const avatar = {
  accountTag: 'tag-1',
  syncGeneration: 3,
  mxcUrl: 'mxc://mindroom.chat/a1',
  entries: [{ roomId: '!room:mindroom.chat', sender: '@dev:mindroom.chat' }],
  base64Data: 'iVBORw0KGgo=',
};

describe('native notifications plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAvailable(false);
    Object.values(plugin).forEach((method) => method.mockReset());
    plugin.syncAccount.mockResolvedValue(undefined);
    plugin.reconcileAccounts.mockResolvedValue(undefined);
    plugin.syncAvatars.mockResolvedValue({ missingMxcUrls: [], syncGeneration: 1 });
    plugin.storeAvatar.mockResolvedValue(undefined);
    plugin.clearAvatarCache.mockResolvedValue(undefined);
  });

  it('is available only on native iOS when the plugin is registered', () => {
    expect(isNativeNotificationsAvailable()).toBe(false);
    setAvailable(true, 'android');
    expect(isNativeNotificationsAvailable()).toBe(false);
    setAvailable(true, 'ios');
    expect(isNativeNotificationsAvailable()).toBe(true);
    // The Mac app is native iOS to Capacitor, but registers no such plugin.
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    expect(isNativeNotificationsAvailable()).toBe(false);
  });

  it('is a no-op outside the iOS app without calling native code', async () => {
    await syncNativeNotificationAccount(account);
    await reconcileNativeNotificationAccounts(['tag-1']);
    // Nothing is missing where nothing is kept.
    await expect(syncNativeNotificationAvatars(avatarSync)).resolves.toEqual({
      missingMxcUrls: [],
      syncGeneration: 0,
    });
    await storeNativeNotificationAvatar(avatar);
    await clearNativeNotificationAvatarCache();

    Object.values(plugin).forEach((method) => expect(method).not.toHaveBeenCalled());
  });

  it('forwards every call on native iOS, and never an access token', async () => {
    setAvailable(true, 'ios');
    plugin.syncAvatars.mockResolvedValue({
      missingMxcUrls: ['mxc://mindroom.chat/a2'],
      syncGeneration: 3,
    });

    await syncNativeNotificationAccount(account);
    await reconcileNativeNotificationAccounts(['tag-1', 'tag-2']);
    await expect(syncNativeNotificationAvatars(avatarSync)).resolves.toEqual({
      missingMxcUrls: ['mxc://mindroom.chat/a2'],
      syncGeneration: 3,
    });
    await storeNativeNotificationAvatar(avatar);
    await clearNativeNotificationAvatarCache();
    // No account is allowed: an empty list, which removes them all.
    await reconcileNativeNotificationAccounts([]);

    expect(plugin.syncAccount.mock.calls).toEqual([[account]]);
    expect(plugin.reconcileAccounts.mock.calls).toEqual([
      [{ allowedAccountTags: ['tag-1', 'tag-2'] }],
      [{ allowedAccountTags: [] }],
    ]);
    expect(plugin.syncAvatars.mock.calls).toEqual([[avatarSync]]);
    expect(plugin.storeAvatar.mock.calls).toEqual([[avatar]]);
    expect(plugin.clearAvatarCache).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(Object.values(plugin).map((method) => method.mock.calls));
    expect(sent).not.toMatch(/token|homeserver/i);
  });

  describe('the order of changes', () => {
    /** Lets everything run that needs no answer of the app. */
    const settle = async () => {
      for (let turn = 0; turn < 10; turn += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
      }
    };
    /** An answer of the app that the test gives when it chooses. */
    const heldAnswer = () => {
      let resolve: () => void = () => undefined;
      let reject: (error: Error) => void = () => undefined;
      const answer = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      return { answer, resolve: () => resolve(), reject: (error: Error) => reject(error) };
    };

    beforeEach(() => {
      setAvailable(true, 'ios');
    });

    it('asks the app for a sync only once the reconcile asked for before it is done', async () => {
      // The reconcile answers late: it is still deleting what Siri keeps of an account.
      const reconciling = heldAnswer();
      plugin.reconcileAccounts.mockReturnValueOnce(reconciling.answer);

      const reconciled = reconcileNativeNotificationAccounts([]);
      const synced = syncNativeNotificationAccount(account);
      let syncAnswered = false;
      synced.then(
        () => {
          syncAnswered = true;
        },
        () => undefined
      );
      await settle();

      expect(plugin.reconcileAccounts).toHaveBeenCalledTimes(1);
      // Stored now, the account would lose to the rest of the reconcile.
      expect(plugin.syncAccount).not.toHaveBeenCalled();
      expect(syncAnswered).toBe(false);

      reconciling.resolve();
      await reconciled;
      await synced;
      expect(plugin.syncAccount.mock.calls).toEqual([[account]]);
      expect(plugin.reconcileAccounts.mock.invocationCallOrder[0]).toBeLessThan(
        plugin.syncAccount.mock.invocationCallOrder[0] ?? 0
      );
    });

    it('keeps a reconcile behind a sync, and a clear of the avatar cache behind both', async () => {
      const syncing = heldAnswer();
      const reconciling = heldAnswer();
      plugin.syncAccount.mockReturnValueOnce(syncing.answer);
      plugin.reconcileAccounts.mockReturnValueOnce(reconciling.answer);

      const synced = syncNativeNotificationAccount(account);
      const reconciled = reconcileNativeNotificationAccounts(['tag-1']);
      const cleared = clearNativeNotificationAvatarCache();
      await settle();
      expect(plugin.syncAccount).toHaveBeenCalledTimes(1);
      expect(plugin.reconcileAccounts).not.toHaveBeenCalled();
      expect(plugin.clearAvatarCache).not.toHaveBeenCalled();

      syncing.resolve();
      await synced;
      await settle();
      expect(plugin.reconcileAccounts).toHaveBeenCalledTimes(1);
      expect(plugin.clearAvatarCache).not.toHaveBeenCalled();

      reconciling.resolve();
      await reconciled;
      await cleared;
      expect(plugin.clearAvatarCache).toHaveBeenCalledTimes(1);
    });

    it('goes on with the next change after one that the app refused, and hands the refusal to its caller', async () => {
      const reconciling = heldAnswer();
      plugin.reconcileAccounts.mockReturnValueOnce(reconciling.answer);

      const reconciled = reconcileNativeNotificationAccounts([]);
      const synced = syncNativeNotificationAccount(account);
      await settle();
      expect(plugin.syncAccount).not.toHaveBeenCalled();

      reconciling.reject(new Error('INTENTS_ERROR'));
      await expect(reconciled).rejects.toThrow('INTENTS_ERROR');
      await expect(synced).resolves.toBeUndefined();
      expect(plugin.syncAccount).toHaveBeenCalledTimes(1);

      // A sync that the app could not store is handed on too, and holds nothing up either.
      plugin.syncAccount.mockRejectedValueOnce(new Error('STORE_ERROR'));
      await expect(syncNativeNotificationAccount(account)).rejects.toThrow('STORE_ERROR');
      await expect(reconcileNativeNotificationAccounts(['tag-1'])).resolves.toBeUndefined();
    });

    it('does not hold the avatars back, which the app puts in order itself', async () => {
      const reconciling = heldAnswer();
      plugin.reconcileAccounts.mockReturnValueOnce(reconciling.answer);

      const reconciled = reconcileNativeNotificationAccounts(['tag-1']);
      await syncNativeNotificationAvatars(avatarSync);
      await storeNativeNotificationAvatar(avatar);

      expect(plugin.syncAvatars).toHaveBeenCalledTimes(1);
      expect(plugin.storeAvatar).toHaveBeenCalledTimes(1);
      reconciling.resolve();
      await reconciled;
    });
  });
});
