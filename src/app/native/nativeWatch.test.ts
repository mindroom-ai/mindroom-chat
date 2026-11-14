import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWatchStatus,
  isNativeWatchAvailable,
  onWatchOpenThread,
  onWatchSignedIn,
  sendWatchCredentials,
  sendWatchSecrets,
  signOutWatch,
} from './nativeWatch';

const plugin = vi.hoisted(() => ({
  status: vi.fn(),
  sendCredentials: vi.fn(),
  sendSecrets: vi.fn(),
  signOut: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => plugin),
}));

const setAvailable = (available: boolean) => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(available);
  vi.mocked(Capacitor.getPlatform).mockReturnValue(available ? 'ios' : 'web');
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(available);
};

const credentials = {
  v: 1 as const,
  kind: 'credentials' as const,
  homeserverUrl: 'https://mindroom.chat',
  userId: '@bas:mindroom.chat',
  loginToken: 'tok',
  expiresAt: 1,
};

describe('native watch plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAvailable(false);
  });

  it('is only there in the iOS app', () => {
    expect(isNativeWatchAvailable()).toBe(false);
    setAvailable(true);
    expect(isNativeWatchAvailable()).toBe(true);
  });

  it('reports no watch outside the iOS app without calling native code', async () => {
    await expect(getWatchStatus()).resolves.toEqual({
      paired: false,
      installed: false,
      reachable: false,
    });
    await sendWatchCredentials(credentials);
    await signOutWatch();
    expect(plugin.status).not.toHaveBeenCalled();
    expect(plugin.sendCredentials).not.toHaveBeenCalled();
    expect(plugin.signOut).not.toHaveBeenCalled();
  });

  it('forwards to the plugin in the iOS app', async () => {
    setAvailable(true);
    plugin.status.mockResolvedValue({
      paired: true,
      installed: true,
      reachable: false,
      device: { userId: '@bas:mindroom.chat', deviceId: 'WATCH' },
    });
    await expect(getWatchStatus()).resolves.toMatchObject({ device: { deviceId: 'WATCH' } });
    await sendWatchCredentials(credentials);
    expect(plugin.sendCredentials).toHaveBeenCalledWith(credentials);
    const secrets = { v: 1 as const, kind: 'secrets' as const, userId: '@bas:mindroom.chat', bundle: '{}' };
    await sendWatchSecrets(secrets);
    expect(plugin.sendSecrets).toHaveBeenCalledWith(secrets);
    await signOutWatch();
    expect(plugin.signOut).toHaveBeenCalled();
  });

  it('passes sign-ins from the watch to the listener and removes it', async () => {
    setAvailable(true);
    const remove = vi.fn();
    plugin.addListener.mockImplementation(
      async (_event: string, callback: (event: unknown) => void) => {
        callback({ userId: '@bas:mindroom.chat', deviceId: 'WATCH' });
        return { remove };
      }
    );
    const listener = vi.fn();
    const stop = await onWatchSignedIn(listener);
    expect(plugin.addListener).toHaveBeenCalledWith('watchSignedIn', expect.any(Function));
    expect(listener).toHaveBeenCalledWith({ userId: '@bas:mindroom.chat', deviceId: 'WATCH' });
    stop();
    expect(remove).toHaveBeenCalled();
  });

  it('passes threads the watch hands off to the listener', async () => {
    setAvailable(true);
    plugin.addListener.mockImplementation(
      async (_event: string, callback: (event: unknown) => void) => {
        callback({ roomId: '!room:x', threadId: '$root' });
        return { remove: vi.fn() };
      }
    );
    const listener = vi.fn();
    await onWatchOpenThread(listener);
    expect(plugin.addListener).toHaveBeenCalledWith('openThread', expect.any(Function));
    expect(listener).toHaveBeenCalledWith({ roomId: '!room:x', threadId: '$root' });
  });
});
