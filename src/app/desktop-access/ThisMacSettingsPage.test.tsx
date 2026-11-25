// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopAccessBridge,
  DesktopAccessSnapshot,
  DesktopBridge,
  DesktopShellEvent,
} from '../lib/desktopBridge';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { desktopAccessModalAtom } from '../navigation/desktopAccessModal';

const mocks = vi.hoisted(() => ({
  bridge: undefined as DesktopBridge | undefined,
  shellListeners: new Set<(event: DesktopShellEvent) => void>(),
  mx: {
    getUserId: () => '@alice:example.org',
    getHomeserverUrl: () => 'https://matrix.example.org',
  } as unknown as MatrixClient,
  disconnectAgentFromThisMac: vi.fn(),
}));

vi.mock('../lib/nativeShell', () => ({
  desktopBridge: () => mocks.bridge,
  isDesktopAccessAvailable: () => Boolean(mocks.bridge?.desktopAccess),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.mx,
}));

vi.mock('./desktopAccessController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./desktopAccessController')>();
  return {
    ...actual,
    disconnectAgentFromThisMac: mocks.disconnectAgentFromThisMac,
  };
});

import { ThisMacSettingsPage } from './ThisMacSettingsPage';

const makeSnapshot = (overrides?: Partial<DesktopAccessSnapshot>): DesktopAccessSnapshot => ({
  availability: 'available',
  helperRunning: true,
  helperError: null,
  status: {
    config: {
      state: 'ready',
      revision: 3,
      enabled: true,
      controllers: [
        {
          controller_key: 'ctrl:code',
          user_id: '@mindroom_code:example.org',
          device_id: 'DEV1',
          ed25519: 'ED1',
          allowed_requester_ids: ['@alice:example.org'],
          allowed_agent_names: ['code'],
        },
        {
          controller_key: 'ctrl:research',
          user_id: '@mindroom_research:example.org',
          device_id: 'DEV2',
          ed25519: 'ED2',
          allowed_requester_ids: ['@alice:example.org'],
          allowed_agent_names: ['research'],
        },
      ],
      allowed_app_ids: ['primary-screen'],
      file_roots: ['/Users/alice/Notes'],
      shell_enabled: true,
    },
    pairing: {
      state: 'ready',
      session_state: 'ready',
      homeserver: 'https://matrix.example.org',
      user_id: '@alice:example.org',
      device_id: 'HELPERDEV',
    },
    helper: { state: 'running', version: '2.0.1' },
    bridge: { state: 'control', active_action: null, last_error: 'temporary hiccup' },
    authority: {
      control_available: true,
      lease_remaining_seconds: 0,
      control_scope: 'computer',
      controllers: {},
    },
    permissions: {
      accessibility: 'granted',
      screen_recording: 'missing',
      gui_permissions_ready: false,
    },
    shell: {
      enabled: true,
      ready: true,
      pending: null,
      auto_approve_remaining_seconds: 0,
      auto_approve_until_revoked: true,
      active_request_id: null,
      handles: [
        {
          handle: 'sh-42',
          command: 'npm run dev',
          state: 'running',
          started_at_ms: 1700000000000,
        },
      ],
      controllers: {},
    },
  },
  consent: {
    'ctrl:code': { mode: 'full', grantedAt: 1000, agentName: 'code' },
  },
  permissions: {
    accessibility: 'granted',
    screen_recording: 'missing',
    gui_permissions_ready: false,
  },
  relaunchRequired: false,
  ...overrides,
});

const installDesktopAccess = (snapshot: DesktopAccessSnapshot): DesktopAccessBridge => {
  const access: DesktopAccessBridge = {
    status: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    beginSetup: vi.fn(async () => ({ ok: true as const, value: undefined })),
    login: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    pair: vi.fn(),
    abortSetup: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    finishSetup: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    updateLimits: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    removeController: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    revokeAll: vi.fn(async () => ({
      ok: true as const,
      value: {
        ...snapshot,
        consent: {},
        status: snapshot.status
          ? {
              ...snapshot.status,
              config: { ...snapshot.status.config, controllers: [] },
              bridge: { ...snapshot.status.bridge, state: 'stopped' as const },
              shell: { ...snapshot.status.shell, handles: [] },
            }
          : null,
      },
    })),
    requestPermission: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    relaunch: vi.fn(async () => ({ ok: true as const, value: undefined })),
    listInstalledApps: vi.fn(async () => ({ ok: true as const, value: [] })),
    pickFolder: vi.fn(async () => ({ ok: true as const, value: null })),
    decideShell: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    killShellHandle: vi.fn(async () => ({
      ok: true as const,
      value: {
        ...snapshot,
        status: snapshot.status
          ? { ...snapshot.status, shell: { ...snapshot.status.shell, handles: [] } }
          : null,
      },
    })),
  };
  mocks.bridge = {
    onShellEvent: (listener) => {
      mocks.shellListeners.add(listener);
      return () => mocks.shellListeners.delete(listener);
    },
    setMediaSession: vi.fn(() => ({ ok: true as const, value: undefined })),
    startSignIn: vi.fn(),
    openSignIn: vi.fn(),
    showMainWindow: vi.fn(),
    setBadge: vi.fn(),
    isWindowFocused: () => true,
    screenShare: false,
    appUrl: { addListener: vi.fn(), getLaunchUrl: vi.fn() },
    desktopAccess: access,
  };
  return access;
};

beforeEach(() => {
  mocks.bridge = undefined;
  mocks.shellListeners.clear();
  mocks.disconnectAgentFromThisMac.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ThisMacSettingsPage', () => {
  it('renders paired agents with Full Access and Restricted badges, permissions row, running shell handles with Stop, and Revoke All Access', async () => {
    const snapshot = makeSnapshot();
    const access = installDesktopAccess(snapshot);
    mocks.disconnectAgentFromThisMac.mockResolvedValueOnce(snapshot);
    const store = createStore();

    render(
      <Provider store={store}>
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <ThisMacSettingsPage requestClose={vi.fn()} />
        </ScreenSizeProvider>
      </Provider>
    );

    expect(await screen.findByText('code')).toBeTruthy();
    expect(screen.getByText('research')).toBeTruthy();
    expect(screen.getByText('Full Access')).toBeTruthy();
    expect(screen.getByText('Restricted')).toBeTruthy();

    expect(screen.getByText('Accessibility')).toBeTruthy();
    expect(screen.getByText('Screen Recording')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow Screen Recording' })).toBeTruthy();

    expect(screen.getByText('npm run dev')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(access.killShellHandle).toHaveBeenCalledWith('sh-42');
    });

    const manageButtons = screen.getAllByRole('button', { name: 'Manage' });
    fireEvent.click(manageButtons[0]!);
    expect(store.get(desktopAccessModalAtom)).toEqual({
      agentUserId: '@mindroom_code:example.org',
      agentName: 'code',
    });

    const disconnectButtons = screen.getAllByRole('button', { name: 'Disconnect' });
    fireEvent.click(disconnectButtons[0]!);
    await waitFor(() => {
      expect(mocks.disconnectAgentFromThisMac).toHaveBeenCalledWith(
        mocks.mx,
        'ctrl:code',
        '@mindroom_code:example.org',
        'code'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }));
    expect(await screen.findByText('2.0.1')).toBeTruthy();
    expect(screen.getByText('HELPERDEV')).toBeTruthy();
    expect(screen.getByText('temporary hiccup')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke All Access' }));
    await waitFor(() => {
      expect(access.revokeAll).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the focusId="thisMacRevokeAll" tile with a disabled button before any agent is paired', async () => {
    installDesktopAccess(
      makeSnapshot({
        consent: {},
        status: {
          ...makeSnapshot().status!,
          config: { ...makeSnapshot().status!.config, enabled: false, controllers: [] },
          bridge: { state: 'stopped', active_action: null, last_error: null },
          shell: { ...makeSnapshot().status!.shell, ready: false, handles: [] },
        },
      })
    );
    const store = createStore();

    render(
      <Provider store={store}>
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <ThisMacSettingsPage requestClose={vi.fn()} />
        </ScreenSizeProvider>
      </Provider>
    );

    expect(await screen.findByText('No agents paired yet')).toBeTruthy();
    const tile = document.querySelector('[data-setting-id="thisMacRevokeAll"]');
    expect(tile).not.toBeNull();
    const revokeBtn = screen.getByRole('button', { name: 'Revoke All Access' });
    expect((revokeBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows Not available on this Mac when desktop access is unavailable', async () => {
    mocks.bridge = undefined;
    const store = createStore();

    render(
      <Provider store={store}>
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <ThisMacSettingsPage requestClose={vi.fn()} />
        </ScreenSizeProvider>
      </Provider>
    );

    expect(await screen.findByText('Not available on this Mac')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke All Access' })).toBeNull();
  });
});
