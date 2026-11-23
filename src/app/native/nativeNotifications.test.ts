import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllNativeNotificationAccounts,
  clearNativeNotificationAccount,
  isNativeNotificationsAvailable,
  syncNativeNotificationAccount,
  syncNativeNotificationAvatars,
} from './nativeNotifications';

const plugin = vi.hoisted(() => ({
  syncAccount: vi.fn(),
  syncAvatars: vi.fn(),
  clearAccount: vi.fn(),
  clearAllAccounts: vi.fn(),
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

describe('native notifications plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAvailable(false);
  });

  it('is available only on native iOS when the plugin is registered', () => {
    expect(isNativeNotificationsAvailable()).toBe(false);
    setAvailable(true, 'android');
    expect(isNativeNotificationsAvailable()).toBe(false);
    setAvailable(true, 'ios');
    expect(isNativeNotificationsAvailable()).toBe(true);
  });

  it('is a no-op outside the iOS app without calling native code', async () => {
    await syncNativeNotificationAccount({
      accountTag: 'tag-1',
      homeserverUrl: 'https://mindroom.chat',
      userId: '@bas:mindroom.chat',
      accessToken: 'tok',
    });
    await syncNativeNotificationAvatars({
      accountTag: 'tag-1',
      avatars: [
        {
          roomId: '!room:mindroom.chat',
          sender: '@dev:mindroom.chat',
          mxcUrl: 'mxc://mindroom.chat/a1',
        },
      ],
    });
    await clearNativeNotificationAccount('tag-1');
    await clearAllNativeNotificationAccounts();

    expect(plugin.syncAccount).not.toHaveBeenCalled();
    expect(plugin.syncAvatars).not.toHaveBeenCalled();
    expect(plugin.clearAccount).not.toHaveBeenCalled();
    expect(plugin.clearAllAccounts).not.toHaveBeenCalled();
  });

  it('forwards account sync, avatar sync, and account cleanup on native iOS', async () => {
    setAvailable(true, 'ios');
    plugin.syncAccount.mockResolvedValue(undefined);
    plugin.syncAvatars.mockResolvedValue(undefined);
    plugin.clearAccount.mockResolvedValue(undefined);
    plugin.clearAllAccounts.mockResolvedValue(undefined);

    const account = {
      accountTag: 'tag-1',
      homeserverUrl: 'https://mindroom.chat',
      userId: '@bas:mindroom.chat',
      accessToken: 'tok',
    };
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

    await syncNativeNotificationAccount(account);
    await syncNativeNotificationAvatars(avatarSync);
    await clearNativeNotificationAccount('  tag-1  ');
    await clearNativeNotificationAccount('   ');
    await clearAllNativeNotificationAccounts();

    expect(plugin.syncAccount).toHaveBeenCalledWith(account);
    expect(plugin.syncAvatars).toHaveBeenCalledWith(avatarSync);
    expect(plugin.clearAccount).toHaveBeenCalledTimes(1);
    expect(plugin.clearAccount).toHaveBeenCalledWith({ accountTag: 'tag-1' });
    expect(plugin.clearAllAccounts).toHaveBeenCalledTimes(1);
  });

  describe('the order of account changes', () => {
    const account = {
      accountTag: 'tag-1',
      homeserverUrl: 'https://mindroom.chat',
      userId: '@bas:mindroom.chat',
      accessToken: 'tok',
    };
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
      plugin.syncAccount.mockResolvedValue(undefined);
      plugin.syncAvatars.mockResolvedValue(undefined);
      plugin.clearAccount.mockResolvedValue(undefined);
      plugin.clearAllAccounts.mockResolvedValue(undefined);
    });

    it('asks the app for a sync only once the clear asked for before it is done', async () => {
      // The clear answers late: it is still deleting what Siri keeps of the account.
      const clearing = heldAnswer();
      plugin.clearAccount.mockReturnValueOnce(clearing.answer);

      const cleared = clearNativeNotificationAccount('tag-1');
      const synced = syncNativeNotificationAccount(account);
      let syncAnswered = false;
      synced.then(
        () => {
          syncAnswered = true;
        },
        () => undefined
      );
      await settle();

      expect(plugin.clearAccount).toHaveBeenCalledTimes(1);
      // Stored now, the account would lose to the rest of the clear.
      expect(plugin.syncAccount).not.toHaveBeenCalled();
      expect(syncAnswered).toBe(false);

      clearing.resolve();
      await cleared;
      await synced;
      expect(plugin.syncAccount).toHaveBeenCalledTimes(1);
      expect(plugin.syncAccount).toHaveBeenCalledWith(account);
      expect(plugin.clearAccount.mock.invocationCallOrder[0]).toBeLessThan(
        plugin.syncAccount.mock.invocationCallOrder[0] ?? 0
      );
    });

    it('keeps a sync behind a clear of every account too, and a clear behind a sync', async () => {
      const clearingAll = heldAnswer();
      const syncing = heldAnswer();
      plugin.clearAllAccounts.mockReturnValueOnce(clearingAll.answer);
      plugin.syncAccount.mockReturnValueOnce(syncing.answer);

      const clearedAll = clearAllNativeNotificationAccounts();
      const synced = syncNativeNotificationAccount(account);
      const cleared = clearNativeNotificationAccount('tag-1');
      await settle();
      expect(plugin.clearAllAccounts).toHaveBeenCalledTimes(1);
      expect(plugin.syncAccount).not.toHaveBeenCalled();
      expect(plugin.clearAccount).not.toHaveBeenCalled();

      clearingAll.resolve();
      await clearedAll;
      await settle();
      expect(plugin.syncAccount).toHaveBeenCalledTimes(1);
      expect(plugin.clearAccount).not.toHaveBeenCalled();

      syncing.resolve();
      await synced;
      await cleared;
      expect(plugin.clearAccount).toHaveBeenCalledTimes(1);
    });

    it('goes on with the next change after one that the app refused, and hands the refusal to its caller', async () => {
      const clearing = heldAnswer();
      plugin.clearAccount.mockReturnValueOnce(clearing.answer);

      const cleared = clearNativeNotificationAccount('tag-1');
      const synced = syncNativeNotificationAccount(account);
      await settle();
      expect(plugin.syncAccount).not.toHaveBeenCalled();

      clearing.reject(new Error('INTENTS_ERROR'));
      await expect(cleared).rejects.toThrow('INTENTS_ERROR');
      await expect(synced).resolves.toBeUndefined();
      expect(plugin.syncAccount).toHaveBeenCalledTimes(1);
    });

    it('does not hold an avatar sync back, which changes no account', async () => {
      const clearing = heldAnswer();
      plugin.clearAccount.mockReturnValueOnce(clearing.answer);

      const cleared = clearNativeNotificationAccount('tag-1');
      await syncNativeNotificationAvatars({ accountTag: 'tag-2', avatars: [] });

      expect(plugin.syncAvatars).toHaveBeenCalledTimes(1);
      clearing.resolve();
      await cleared;
    });
  });
});
