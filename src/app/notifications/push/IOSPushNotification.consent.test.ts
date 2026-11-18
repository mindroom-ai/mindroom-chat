import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';

const nativeState = vi.hoisted(() => ({ pushAllowed: true }));

vi.mock('../../ui/SequenceCard', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('section', null, children),
}));

vi.mock('../../ui/SettingTile', () => ({
  SettingTile: ({ description, after }: { description: React.ReactNode; after: React.ReactNode }) =>
    React.createElement('div', { 'data-renderer': 'setting-tile' }, description, after),
}));

vi.mock('../../ui/settings/styles.css', () => ({
  SequenceCardStyle: 'sequence-card',
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getHomeserverUrl: () => 'https://hs.example' }),
}));

vi.mock('../../native/cloudflareAccess', () => ({
  cloudflareAccessAllowsPush: () => nativeState.pushAllowed,
}));

vi.mock('../../config/useClientConfig', () => ({
  useClientConfig: () => ({}),
}));

vi.mock('../../matrix/session/useSessionStore', () => ({
  useActiveSession: () => ({ sessionId: 'session-a' }),
}));

// The first tap on a fresh install: push is already on by default, notifications not yet allowed.
vi.mock('./useIOSPushEnabled', () => ({ useIOSPushEnabled: () => true }));

vi.mock('./iosPush', () => ({
  checkIOSPushPermission: vi.fn().mockResolvedValue('prompt'),
  disableIOSPushPusher: vi.fn().mockResolvedValue(undefined),
  isNativeIOSPlatform: () => true,
  registerIOSPush: vi.fn().mockResolvedValue(undefined),
  requestIOSPushPermission: vi.fn().mockResolvedValue('granted'),
  resolveIOSPushConfig: vi.fn(() => ({})),
  setIOSPushEnabled: vi.fn(),
}));

it('registers with APNs as soon as the first tap is granted permission', async () => {
  const { IOSPushNotification } = await import('./IOSPushNotification');
  const { registerIOSPush, setIOSPushEnabled } = await import('./iosPush');
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(IOSPushNotification));
  });
  await act(async () => {
    renderer.root.findByType('button').props.onClick();
  });

  expect(setIOSPushEnabled).toHaveBeenCalledWith(true, 'session-a');
  expect(registerIOSPush).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});
