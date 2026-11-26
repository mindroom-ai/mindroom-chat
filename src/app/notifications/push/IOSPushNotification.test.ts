import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import en from '../../i18n/englishResources';

const nativeState = vi.hoisted(() => ({
  native: false,
  android: false,
  failed: false,
  pushAllowed: true,
  toggle: vi.fn<(enabled: boolean) => Promise<void>>(),
}));

vi.mock('../../ui/SequenceCard', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('section', null, children),
}));

vi.mock('../../ui/SettingTile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title?: React.ReactNode;
    description: React.ReactNode;
    after: React.ReactNode;
  }) => React.createElement('div', { 'data-renderer': 'setting-tile' }, title, description, after),
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

vi.mock('../../lib/hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Error: 'error',
    Loading: 'loading',
  },
  useAsyncCallback: () => [
    {
      status: nativeState.failed ? 'error' : 'idle',
      error: new Error('Internal native registration error'),
    },
    nativeState.toggle,
  ],
}));

vi.mock('./useIOSPushEnabled', () => ({
  useIOSPushEnabled: () => false,
}));

vi.mock('./iosPush', () => ({
  checkIOSPushPermission: vi.fn().mockResolvedValue('prompt'),
  disableIOSPushPusher: vi.fn().mockResolvedValue(undefined),
  isNativeAndroidPushPlatform: () => nativeState.native && nativeState.android,
  isNativeIOSPlatform: () => nativeState.native && !nativeState.android,
  isNativePushPlatform: () => nativeState.native,
  registerIOSPush: vi.fn().mockResolvedValue(undefined),
  requestIOSPushPermission: vi.fn().mockResolvedValue('prompt'),
  resolveIOSPushConfig: vi.fn(() => (nativeState.native ? {} : undefined)),
  setIOSPushEnabled: vi.fn(),
}));

describe('IOSPushNotification', () => {
  it('does not render outside native iOS', async () => {
    const { IOSPushNotification } = await import('./IOSPushNotification');

    const renderer = create(React.createElement(IOSPushNotification));

    expect(renderer.toJSON()).toBeNull();

    renderer.unmount();
  });

  it('does not render for a server that turns push off', async () => {
    const { IOSPushNotification } = await import('./IOSPushNotification');
    nativeState.native = true;
    nativeState.pushAllowed = false;
    let renderer: ReturnType<typeof create> | undefined;
    try {
      renderer = create(React.createElement(IOSPushNotification));

      expect(renderer.toJSON()).toBeNull();
    } finally {
      act(() => renderer?.unmount());
      nativeState.native = false;
      nativeState.pushAllowed = true;
    }
  });
});

it.each([new Error('Native permission registration failed'), 'Matrix pusher request failed'])(
  'retains the toggle failure for diagnostics without retrying: %s',
  async (failure) => {
    const { IOSPushNotification } = await import('./IOSPushNotification');
    const { checkIOSPushPermission } = await import('./iosPush');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    nativeState.native = true;
    nativeState.failed = false;
    nativeState.toggle.mockReset().mockRejectedValueOnce(failure);
    vi.mocked(checkIOSPushPermission).mockClear();
    let renderer!: ReturnType<typeof create>;
    try {
      await act(async () => {
        renderer = create(React.createElement(IOSPushNotification));
      });
      await act(async () => {
        renderer.root.findByType('button').props.onClick();
      });

      expect(nativeState.toggle).toHaveBeenCalledTimes(1);
      expect(nativeState.toggle).toHaveBeenCalledWith(true);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        '[IOSPushNotification] Failed to update native push settings:',
        failure
      );
      expect(checkIOSPushPermission).toHaveBeenCalledTimes(2);
    } finally {
      act(() => renderer?.unmount());
      errorLog.mockRestore();
      nativeState.native = false;
    }
  }
);

it('renders a localized native failure and refreshes it after a language change', async () => {
  const { IOSPushNotification } = await import('./IOSPushNotification');
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      de: {
        translation: {
          mindroomUi: {
            native: {
              iOSPushNotification: {
                failedToUpdateNativePushSettings:
                  'Push-Einstellungen konnten nicht aktualisiert werden.',
              },
            },
          },
        },
      },
    },
  });
  nativeState.native = true;
  nativeState.failed = true;
  let renderer: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(
        React.createElement(
          I18nextProvider,
          { i18n: language },
          React.createElement(IOSPushNotification)
        )
      );
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Failed to update native push settings.');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Internal native');
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'Push-Einstellungen konnten nicht aktualisiert werden.'
    );
    act(() => renderer!.unmount());
  } finally {
    nativeState.native = false;
    nativeState.failed = false;
  }
});

it('renders Android push copy on native Android while keeping iOS copy unchanged', async () => {
  const { IOSPushNotification } = await import('./IOSPushNotification');
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
  });
  nativeState.native = true;
  nativeState.android = true;
  let renderer: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      renderer = create(
        React.createElement(
          I18nextProvider,
          { i18n: language },
          React.createElement(IOSPushNotification)
        )
      );
    });
    const androidJson = JSON.stringify(renderer!.toJSON());
    expect(androidJson).toContain('Push Notifications');
    expect(androidJson).toContain(
      'Allow Android push notifications for background message alerts.'
    );
    expect(androidJson).not.toContain('iOS Push Notifications');
    act(() => renderer!.unmount());

    nativeState.android = false;
    await act(async () => {
      renderer = create(
        React.createElement(
          I18nextProvider,
          { i18n: language },
          React.createElement(IOSPushNotification)
        )
      );
    });
    const iosJson = JSON.stringify(renderer!.toJSON());
    expect(iosJson).toContain('iOS Push Notifications');
    expect(iosJson).toContain('Allow native iOS push notifications for background message alerts.');
    act(() => renderer!.unmount());
  } finally {
    nativeState.native = false;
    nativeState.android = false;
  }
});
