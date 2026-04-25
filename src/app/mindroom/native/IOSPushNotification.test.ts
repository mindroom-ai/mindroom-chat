import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('section', null, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: () => React.createElement('div', { 'data-renderer': 'setting-tile' }),
}));

vi.mock('../../features/settings/styles.css', () => ({
  SequenceCardStyle: 'sequence-card',
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({}),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: () => ({ sessionId: 'session-a' }),
}));

vi.mock('../../hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Error: 'error',
    Loading: 'loading',
  },
  useAsyncCallback: () => [{ status: 'idle' }, vi.fn()],
}));

vi.mock('./useIOSPushEnabled', () => ({
  useIOSPushEnabled: () => false,
}));

vi.mock('./iosPush', () => ({
  checkIOSPushPermission: vi.fn().mockResolvedValue('prompt'),
  disableIOSPushPusher: vi.fn().mockResolvedValue(undefined),
  isNativeIOSPlatform: () => false,
  requestIOSPushPermission: vi.fn().mockResolvedValue('prompt'),
  resolveIOSPushConfig: vi.fn(() => undefined),
  setIOSPushEnabled: vi.fn(),
  unregisterIOSPush: vi.fn().mockResolvedValue(undefined),
}));

describe('IOSPushNotification', () => {
  it('does not render outside native iOS', async () => {
    const { IOSPushNotification } = await import('./IOSPushNotification');

    const renderer = create(React.createElement(IOSPushNotification));

    expect(renderer.toJSON()).toBeNull();

    renderer.unmount();
  });
});
