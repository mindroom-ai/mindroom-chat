import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNativeNotificationAccount,
  isNativeNotificationsAvailable,
  syncNativeNotificationAccount,
  syncNativeNotificationAvatars,
} from './nativeNotifications';

const plugin = vi.hoisted(() => ({
  syncAccount: vi.fn(),
  syncAvatars: vi.fn(),
  clearAccount: vi.fn(),
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

    expect(plugin.syncAccount).not.toHaveBeenCalled();
    expect(plugin.syncAvatars).not.toHaveBeenCalled();
    expect(plugin.clearAccount).not.toHaveBeenCalled();
  });

  it('forwards account sync, avatar sync, and account cleanup on native iOS', async () => {
    setAvailable(true, 'ios');
    plugin.syncAccount.mockResolvedValue(undefined);
    plugin.syncAvatars.mockResolvedValue(undefined);
    plugin.clearAccount.mockResolvedValue(undefined);

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
        { roomId: '!room:mindroom.chat', sender: '@none:mindroom.chat', mxcUrl: null },
      ],
    };

    await syncNativeNotificationAccount(account);
    await syncNativeNotificationAvatars(avatarSync);
    await clearNativeNotificationAccount('  tag-1  ');
    await clearNativeNotificationAccount('   ');

    expect(plugin.syncAccount).toHaveBeenCalledWith(account);
    expect(plugin.syncAvatars).toHaveBeenCalledWith(avatarSync);
    expect(plugin.clearAccount).toHaveBeenCalledTimes(1);
    expect(plugin.clearAccount).toHaveBeenCalledWith({ accountTag: 'tag-1' });
  });
});
