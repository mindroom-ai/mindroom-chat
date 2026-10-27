import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerIOSPush, setIOSPushEnabled } from '../native/iosPush';
import { MindroomNativeIOSPushFeature } from './MindroomClientNonUIFeatures';

const access = vi.hoisted(() => ({ signInRequired: true }));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: { addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })) },
}));

vi.mock('../native/iosPush', () => ({
  checkIOSPushPermission: vi.fn(async () => 'granted'),
  disableIOSPushPusher: vi.fn(async () => undefined),
  isNativeIOSPlatform: () => true,
  registerIOSPush: vi.fn(async () => undefined),
  resolveIOSPushConfig: () => ({ appId: 'chat.example', format: 'full' }),
  setIOSPushEnabled: vi.fn(),
  unregisterIOSPush: vi.fn(async () => undefined),
  upsertIOSPushPusher: vi.fn(async () => undefined),
}));

vi.mock('../native/useIOSPushEnabled', () => ({ useIOSPushEnabled: () => true }));
vi.mock('../native/cloudflareAccess', () => ({
  useCloudflareAccessSignInRequired: () => access.signInRequired,
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getHomeserverUrl: () => 'https://private.example' }),
}));
vi.mock('../../hooks/useClientConfig', () => ({ useClientConfig: () => ({}) }));
vi.mock('../../hooks/useSessionStore', () => ({ useActiveSession: () => ({ sessionId: 's1' }) }));
vi.mock('../../hooks/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));

describe('MindroomNativeIOSPushFeature', () => {
  afterEach(() => {
    access.signInRequired = true;
  });

  it('waits for the Cloudflare Access sign-in instead of turning push off', async () => {
    const element = React.createElement(MindroomNativeIOSPushFeature);
    const renderer = await act(async () => create(element));

    expect(registerIOSPush).not.toHaveBeenCalled();
    expect(setIOSPushEnabled).not.toHaveBeenCalled();

    access.signInRequired = false;
    await act(async () => renderer.update(React.createElement(MindroomNativeIOSPushFeature)));

    expect(registerIOSPush).toHaveBeenCalledTimes(1);
    expect(setIOSPushEnabled).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
