// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopAccessBridge,
  DesktopAccessSnapshot,
  DesktopBridge,
  DesktopShellEvent,
  InstalledMacApp,
} from '../lib/desktopBridge';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { MAC_APP_BREW_COMMAND, MAC_APP_RELEASES_URL } from '../native/macApp';
import { desktopAccessModalAtom } from '../navigation/desktopAccessModal';
import type { MacDeviceEntry } from './desktopPairingProtocol';
import type { RelayPairState } from './browserPairRelay';
import type { IncomingPairInvite } from './macPairInvite';

const mocks = vi.hoisted(() => ({
  bridge: undefined as DesktopBridge | undefined,
  shellListeners: new Set<(event: DesktopShellEvent) => void>(),
  mx: undefined as unknown as MatrixClient,
  pairAgentOnThisMac: vi.fn(),
  disconnectAgentFromThisMac: vi.fn(),
  macDevices: [] as MacDeviceEntry[],
  relayPairToMac: vi.fn(),
  approveIncomingPairInvite: vi.fn(),
  declineIncomingPairInvite: vi.fn(),
  downloadUrl: 'https://github.com/mindroom-ai/mindroom-chat/releases',
  copyToClipboard: vi.fn(async () => true),
}));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../lib/nativeShell', () => ({
  desktopBridge: () => mocks.bridge,
  isDesktopAccessAvailable: () => Boolean(mocks.bridge?.desktopAccess),
}));

vi.mock('../lib/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dom')>();
  return { ...actual, copyToClipboard: mocks.copyToClipboard };
});

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.mx,
}));

vi.mock('../native/macApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../native/macApp')>();
  return { ...actual, useMacAppDownloadUrl: () => mocks.downloadUrl };
});

vi.mock('./desktopAccessController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./desktopAccessController')>();
  return {
    ...actual,
    pairAgentOnThisMac: mocks.pairAgentOnThisMac,
    disconnectAgentFromThisMac: mocks.disconnectAgentFromThisMac,
  };
});

vi.mock('./browserPairRelay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browserPairRelay')>();
  return {
    ...actual,
    useRegisteredMacDevices: () => mocks.macDevices,
    relayPairToMac: mocks.relayPairToMac,
  };
});

vi.mock('./macPairInvite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./macPairInvite')>();
  return {
    ...actual,
    approveIncomingPairInvite: mocks.approveIncomingPairInvite,
    declineIncomingPairInvite: mocks.declineIncomingPairInvite,
  };
});

import { DesktopAccessModalRenderer } from './DesktopAccessModal';
import { IncomingPairInviteModal } from './IncomingPairInviteModal';
import { incomingPairInviteAtom } from './macPairInvite';

type SnapshotOverrides = {
  accessibility?: 'granted' | 'missing' | 'unknown';
  screenRecording?: 'granted' | 'missing' | 'unknown';
  relaunchRequired?: boolean;
  controllers?: Array<{
    controller_key: string;
    user_id: string;
    device_id: string;
    ed25519: string;
    allowed_requester_ids: string[];
    allowed_agent_names: string[];
  }>;
  consent?: DesktopAccessSnapshot['consent'];
  allowedAppIds?: string[];
  fileRoots?: string[];
  shellEnabled?: boolean;
  shellReady?: boolean;
  bridgeState?: 'stopped' | 'observe_only' | 'control' | 'stopping' | 'faulted';
};

const makeSnapshot = (overrides: SnapshotOverrides = {}): DesktopAccessSnapshot => {
  const accessibility = overrides.accessibility ?? 'missing';
  const screenRecording = overrides.screenRecording ?? 'missing';
  const guiPermissionsReady = accessibility === 'granted' && screenRecording === 'granted';
  const shellEnabled = overrides.shellEnabled ?? true;
  const shellReady = overrides.shellReady ?? shellEnabled;
  return {
    availability: 'available',
    helperRunning: true,
    helperError: null,
    status: {
      config: {
        state: 'ready',
        revision: 1,
        enabled: true,
        controllers: overrides.controllers ?? [],
        allowed_app_ids: overrides.allowedAppIds ?? ['primary-screen'],
        file_roots: overrides.fileRoots ?? [],
        shell_enabled: shellEnabled,
      },
      pairing: {
        state: 'ready',
        session_state: 'ready',
        homeserver: 'https://matrix.example.org',
        user_id: '@alice:example.org',
        device_id: 'HELPERDEV',
      },
      helper: { state: 'running', version: '1.2.3' },
      bridge: {
        state: overrides.bridgeState ?? 'control',
        active_action: null,
        last_error: null,
      },
      authority: {
        control_available: true,
        lease_remaining_seconds: 0,
        control_scope: 'computer',
        controllers: {},
      },
      permissions: {
        accessibility,
        screen_recording: screenRecording,
        gui_permissions_ready: guiPermissionsReady,
      },
      shell: {
        enabled: shellEnabled,
        ready: shellReady,
        pending: null,
        auto_approve_remaining_seconds: 0,
        auto_approve_until_revoked: false,
        active_request_id: null,
        handles: [],
        controllers: {},
      },
    },
    consent: overrides.consent ?? {},
    permissions: {
      accessibility,
      screen_recording: screenRecording,
      gui_permissions_ready: guiPermissionsReady,
    },
    relaunchRequired: overrides.relaunchRequired ?? false,
  };
};

const makeDesktopAccessMock = (
  initialSnapshot: DesktopAccessSnapshot,
  installedApps: InstalledMacApp[] = [
    { bundleId: 'com.apple.Safari', name: 'Safari', path: '/Applications/Safari.app' },
    {
      bundleId: 'com.apple.Terminal',
      name: 'Terminal',
      path: '/System/Applications/Utilities/Terminal.app',
    },
  ]
) => {
  const access: DesktopAccessBridge = {
    status: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
    beginSetup: vi.fn(async () => ({ ok: true as const, value: undefined })),
    login: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
    pair: vi.fn(),
    finishSetup: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
    updateLimits: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
    removeController: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
    revokeAll: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
    requestPermission: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
    relaunch: vi.fn(async () => ({ ok: true as const, value: undefined })),
    listInstalledApps: vi.fn(async () => ({ ok: true as const, value: installedApps })),
    pickFolder: vi.fn(async () => ({ ok: true as const, value: '/Users/alice/Projects' })),
    decideShell: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
    killShellHandle: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
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

const makeRoomClient = (members: Array<{ userId: string; name?: string }>): MatrixClient =>
  ({
    getUserId: () => '@alice:example.org',
    getHomeserverUrl: () => 'https://matrix.example.org',
    getRoom: (roomId: string) =>
      roomId === '!room:example.org'
        ? {
            getJoinedMembers: () =>
              members.map((m) => ({
                userId: m.userId,
                name: m.name ?? m.userId,
                membership: 'join',
              })),
          }
        : null,
  }) as unknown as MatrixClient;

const renderWithStore = (node: React.ReactNode, store = createStore()) =>
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={ScreenSize.Desktop}>{node}</ScreenSizeProvider>
    </Provider>
  );

beforeEach(() => {
  mocks.bridge = undefined;
  mocks.shellListeners.clear();
  mocks.pairAgentOnThisMac.mockReset();
  mocks.disconnectAgentFromThisMac.mockReset();
  mocks.macDevices = [];
  mocks.relayPairToMac.mockReset();
  mocks.approveIncomingPairInvite.mockReset();
  mocks.declineIncomingPairInvite.mockReset();
  mocks.downloadUrl = MAC_APP_RELEASES_URL;
  mocks.copyToClipboard.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('DesktopAccessModal', () => {
  it('opens directly on the Full Access consent sheet for a single-agent room', async () => {
    makeDesktopAccessMock(makeSnapshot());
    mocks.mx = makeRoomClient([
      { userId: '@alice:example.org', name: 'Alice' },
      { userId: '@mindroom_router:example.org', name: 'Router' },
      { userId: '@mindroom_code:example.org', name: 'Code' },
      { userId: '@mindroom_foreign:other.org', name: 'Foreign' },
    ]);

    const store = createStore();
    store.set(desktopAccessModalAtom, { roomId: '!room:example.org' });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    expect(await screen.findByText('Allow code full access to this Mac?')).toBeTruthy();
    expect(
      screen.getByText(
        'code can see your screen, control every app, and run shell commands as your macOS user without asking, including after restart. Stop anytime from the menu bar.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow Full Access' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose limits...' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('shows the multi-agent picker first for multi-agent rooms and advances on click', async () => {
    makeDesktopAccessMock(
      makeSnapshot({
        controllers: [
          {
            controller_key: 'ctrl:1',
            user_id: '@mindroom_code:example.org',
            device_id: 'DEV1',
            ed25519: 'KEY1',
            allowed_requester_ids: ['@alice:example.org'],
            allowed_agent_names: ['code'],
          },
        ],
        consent: { 'ctrl:1': { mode: 'full', grantedAt: 1000, agentName: 'code' } },
        accessibility: 'granted',
        screenRecording: 'granted',
      })
    );
    mocks.mx = makeRoomClient([
      { userId: '@alice:example.org', name: 'Alice' },
      { userId: '@mindroom_code:example.org', name: 'Code' },
      { userId: '@mindroom_research:example.org', name: 'Research' },
    ]);

    const store = createStore();
    store.set(desktopAccessModalAtom, { roomId: '!room:example.org' });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    const codeButton = await screen.findByRole('button', { name: /code/i });
    const researchButton = screen.getByRole('button', { name: /research/i });
    expect(codeButton.textContent).toContain('Full Access active');
    expect(researchButton).toBeTruthy();

    fireEvent.click(researchButton);

    expect(await screen.findByText('Allow research full access to this Mac?')).toBeTruthy();
  });

  it('runs pairAgentOnThisMac on Allow Full Access and shows Shell-ready banner, live Accessibility row, and Screen Recording relaunch button', async () => {
    const initial = makeSnapshot({ accessibility: 'missing', screenRecording: 'missing' });
    const paired = makeSnapshot({
      accessibility: 'missing',
      screenRecording: 'missing',
      relaunchRequired: true,
      controllers: [
        {
          controller_key: 'ctrl:code',
          user_id: '@mindroom_code:example.org',
          device_id: 'DEV1',
          ed25519: 'KEY1',
          allowed_requester_ids: ['@alice:example.org'],
          allowed_agent_names: ['code'],
        },
      ],
      consent: { 'ctrl:code': { mode: 'full', grantedAt: 1000, agentName: 'code' } },
    });
    const pairedWithAx = makeSnapshot({
      accessibility: 'granted',
      screenRecording: 'missing',
      relaunchRequired: true,
      controllers: paired.status!.config.controllers,
      consent: paired.consent,
    });
    const access = makeDesktopAccessMock(initial);
    vi.mocked(access.requestPermission).mockResolvedValueOnce({ ok: true, value: pairedWithAx });
    mocks.pairAgentOnThisMac.mockResolvedValueOnce(paired);
    mocks.mx = makeRoomClient([{ userId: '@mindroom_code:example.org', name: 'Code' }]);

    const store = createStore();
    store.set(desktopAccessModalAtom, { roomId: '!room:example.org' });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    const allowBtn = await screen.findByRole('button', { name: 'Allow Full Access' });
    fireEvent.click(allowBtn);

    await waitFor(() => {
      expect(mocks.pairAgentOnThisMac).toHaveBeenCalledWith(
        mocks.mx,
        { agentUserId: '@mindroom_code:example.org', agentName: 'code', mode: 'full' },
        expect.any(Function),
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    expect(
      await screen.findByText('Shell ready - Waiting for macOS screen & input permissions')
    ).toBeTruthy();

    const axBtn = screen.getByRole('button', { name: 'Allow Accessibility' });
    fireEvent.click(axBtn);
    await waitFor(() => {
      expect(access.requestPermission).toHaveBeenCalledWith('accessibility');
    });
    expect(await screen.findByText('Allowed')).toBeTruthy();

    const relaunchBtn = screen.getByRole('button', {
      name: 'Relaunch to activate screen control',
    });
    fireEvent.click(relaunchBtn);
    await waitFor(() => {
      expect(access.relaunch).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByRole('button', { name: /check again/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('places the Mac-wide shell toggle in the shared section and keeps per-agent approval separate in Choose limits...', async () => {
    const initial = makeSnapshot({
      allowedAppIds: ['primary-screen'],
      fileRoots: [],
      shellEnabled: true,
      consent: { 'ctrl:other': { mode: 'full', grantedAt: 1000, agentName: 'other' } },
    });
    const access = makeDesktopAccessMock(initial);
    mocks.pairAgentOnThisMac.mockResolvedValueOnce(
      makeSnapshot({
        controllers: [
          {
            controller_key: 'ctrl:code',
            user_id: '@mindroom_code:example.org',
            device_id: 'DEV1',
            ed25519: 'KEY1',
            allowed_requester_ids: ['@alice:example.org'],
            allowed_agent_names: ['code'],
          },
        ],
        accessibility: 'granted',
        screenRecording: 'granted',
      })
    );
    mocks.mx = makeRoomClient([{ userId: '@mindroom_code:example.org', name: 'Code' }]);

    const store = createStore();
    store.set(desktopAccessModalAtom, { roomId: '!room:example.org' });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    fireEvent.click(await screen.findByRole('button', { name: 'Choose limits...' }));

    const perAgentSection = await screen.findByTestId('limits-per-agent-section');
    const sharedSection = screen.getByTestId('limits-shared-section');

    expect(
      within(perAgentSection).getByText('Control & shell approval for code (per-agent)')
    ).toBeTruthy();
    expect(within(perAgentSection).queryByRole('radio', { name: 'Off' })).toBeNull();
    expect(
      within(perAgentSection).queryByRole('switch', { name: 'Allow shell commands on this Mac' })
    ).toBeNull();

    expect(
      within(sharedSection).getByText(
        'Shared apps, folders & shell on this Mac (applies to all paired agents)'
      )
    ).toBeTruthy();
    expect(
      within(sharedSection).getByText('Shared with other paired agents on this Mac')
    ).toBeTruthy();
    const shellToggle = within(sharedSection).getByRole('switch', {
      name: 'Allow shell commands on this Mac',
    });
    expect(shellToggle).toBeTruthy();

    expect(await within(sharedSection).findByText('Safari')).toBeTruthy();
    fireEvent.click(within(sharedSection).getByLabelText('Safari'));

    fireEvent.click(
      within(perAgentSection).getByRole('radio', { name: 'Allow control for 15 min' })
    );
    fireEvent.click(
      within(perAgentSection).getByRole('radio', { name: 'Auto-approve for 15 min' })
    );

    fireEvent.click(within(sharedSection).getByRole('button', { name: 'Add folder...' }));
    expect(await within(sharedSection).findByText('/Users/alice/Projects')).toBeTruthy();
    expect(access.pickFolder).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Allow with limits' }));

    await waitFor(() => {
      expect(mocks.pairAgentOnThisMac).toHaveBeenCalledWith(
        mocks.mx,
        {
          agentUserId: '@mindroom_code:example.org',
          agentName: 'code',
          mode: 'restricted',
          limits: {
            allowedAppIds: ['primary-screen', 'com.apple.Safari'],
            fileRoots: ['/Users/alice/Projects'],
            shellEnabled: true,
            controlDurationSeconds: 900,
            shellAutoApproveSeconds: 900,
          },
        },
        expect.any(Function),
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });
  });

  it('disables per-agent shell approval radios and omits shellAutoApproveSeconds when Mac-wide shell toggle is turned off', async () => {
    const initial = makeSnapshot({ allowedAppIds: ['primary-screen'], shellEnabled: true });
    makeDesktopAccessMock(initial);
    mocks.pairAgentOnThisMac.mockResolvedValueOnce(
      makeSnapshot({ accessibility: 'granted', screenRecording: 'granted', shellEnabled: false })
    );
    mocks.mx = makeRoomClient([{ userId: '@mindroom_code:example.org', name: 'Code' }]);

    const store = createStore();
    store.set(desktopAccessModalAtom, { roomId: '!room:example.org' });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    fireEvent.click(await screen.findByRole('button', { name: 'Choose limits...' }));
    const perAgentSection = await screen.findByTestId('limits-per-agent-section');
    const sharedSection = screen.getByTestId('limits-shared-section');

    fireEvent.click(
      within(perAgentSection).getByRole('radio', { name: 'Auto-approve for 15 min' })
    );
    fireEvent.click(
      within(sharedSection).getByRole('switch', { name: 'Allow shell commands on this Mac' })
    );

    const askRadio = within(perAgentSection).getByRole<HTMLButtonElement>('radio', {
      name: 'Ask before each command',
    });
    expect(askRadio.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Allow with limits' }));
    await waitFor(() => {
      expect(mocks.pairAgentOnThisMac).toHaveBeenCalledWith(
        mocks.mx,
        {
          agentUserId: '@mindroom_code:example.org',
          agentName: 'code',
          mode: 'restricted',
          limits: {
            allowedAppIds: ['primary-screen'],
            fileRoots: [],
            shellEnabled: false,
          },
        },
        expect.any(Function),
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });
  });

  it('shows waiting-for-permissions banner without Shell ready when shell is disabled, and shows Full Access disclosure before Switch to Full Access', async () => {
    const restricted = makeSnapshot({
      accessibility: 'missing',
      screenRecording: 'missing',
      shellEnabled: false,
      shellReady: false,
      controllers: [
        {
          controller_key: 'ctrl:code',
          user_id: '@mindroom_code:example.org',
          device_id: 'DEV1',
          ed25519: 'KEY1',
          allowed_requester_ids: ['@alice:example.org'],
          allowed_agent_names: ['code'],
        },
      ],
      consent: {},
    });
    const full = makeSnapshot({
      accessibility: 'granted',
      screenRecording: 'granted',
      controllers: restricted.status!.config.controllers,
      consent: { 'ctrl:code': { mode: 'full', grantedAt: 2000, agentName: 'code' } },
    });
    const access = makeDesktopAccessMock(restricted);
    vi.mocked(access.updateLimits).mockResolvedValueOnce({ ok: true, value: full });
    mocks.disconnectAgentFromThisMac.mockResolvedValueOnce(makeSnapshot());
    mocks.mx = makeRoomClient([]);

    const store = createStore();
    store.set(desktopAccessModalAtom, {
      agentUserId: '@mindroom_code:example.org',
      agentName: 'code',
    });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    expect(await screen.findByText('Restricted')).toBeTruthy();
    expect(screen.getByText('Waiting for macOS screen & input permissions')).toBeTruthy();
    expect(
      screen.queryByText('Shell ready - Waiting for macOS screen & input permissions')
    ).toBeNull();
    expect(
      screen.getByText(
        'code can see your screen, control every app, and run shell commands as your macOS user without asking, including after restart. Stop anytime from the menu bar.'
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Full Access' }));
    await waitFor(() => {
      expect(access.updateLimits).toHaveBeenCalledWith({
        controllerKey: 'ctrl:code',
        agentName: 'code',
        mode: 'full',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => {
      expect(mocks.disconnectAgentFromThisMac).toHaveBeenCalledWith(
        mocks.mx,
        'ctrl:code',
        '@mindroom_code:example.org',
        'code'
      );
    });
  });

  it('in browser mode with a registered Mac sends relay and shows the 6-digit SAS code', async () => {
    mocks.bridge = undefined;
    mocks.macDevices = [{ device_id: 'MAC1', label: "Bas's MacBook Pro", updated_at: 1000 }];
    mocks.mx = makeRoomClient([{ userId: '@mindroom_code:example.org', name: 'Code' }]);

    let finishRelay!: () => void;
    mocks.relayPairToMac.mockImplementation(
      async (
        _mx: MatrixClient,
        _mac: MacDeviceEntry,
        _agentUserId: string,
        _agentName: string,
        onState?: (state: RelayPairState) => void
      ) => {
        onState?.({ phase: 'awaiting_mac', sasCode: '482913' });
        await new Promise<void>((resolve) => {
          finishRelay = resolve;
        });
        onState?.({ phase: 'paired' });
        return { deviceId: 'HELPER1', deviceEd25519: 'ED1' };
      }
    );

    const store = createStore();
    store.set(desktopAccessModalAtom, { roomId: '!room:example.org' });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    const sendBtn = await screen.findByRole('button', { name: "Send to Bas's MacBook Pro" });
    fireEvent.click(sendBtn);

    expect(await screen.findByText('482913')).toBeTruthy();
    expect(
      screen.getByText("Confirm this code on Bas's MacBook Pro to approve access.")
    ).toBeTruthy();

    await act(async () => {
      finishRelay();
    });

    expect(await screen.findByText("code is now paired with Bas's MacBook Pro.")).toBeTruthy();
  });

  it('in browser mode with no registered Mac renders Download MindRoom Chat for Mac and Homebrew command', async () => {
    mocks.bridge = undefined;
    mocks.macDevices = [];
    mocks.downloadUrl =
      'https://github.com/mindroom-ai/mindroom-chat/releases/download/v1/MindRoom-Chat.dmg';
    mocks.mx = makeRoomClient([{ userId: '@mindroom_code:example.org', name: 'Code' }]);

    const store = createStore();
    store.set(desktopAccessModalAtom, { roomId: '!room:example.org' });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    const downloadLink = await screen.findByRole('link', {
      name: 'Download MindRoom Chat for Mac',
    });
    expect(downloadLink.getAttribute('href')).toBe(mocks.downloadUrl);
    expect(screen.getByText(MAC_APP_BREW_COMMAND)).toBeTruthy();
  });
});

describe('IncomingPairInviteModal', () => {
  const sampleIncoming: IncomingPairInvite = {
    invite: {
      v: 1,
      nonce: 'n-1',
      agent_name: 'code',
      agent_user_id: '@mindroom_code:example.org',
      controller: {
        user_id: '@mindroom_code:example.org',
        device_id: 'AGENTDEV',
        ed25519: 'AGENTKEY',
      },
      homeserver: 'https://matrix.example.org',
      user_id: '@alice:example.org',
      code: 'SECRET-CODE',
      cloudflare_access: false,
      requester_label: 'Chrome on Mac',
      sas_code: '654321',
    },
    senderDeviceId: 'BROWSER1',
    senderEd25519: 'BROWSERKEY',
    receivedAt: 1000,
  };

  it('renders requester, 6-digit SAS code, Full Access disclosure, and handles decline', async () => {
    makeDesktopAccessMock(makeSnapshot());
    mocks.mx = makeRoomClient([]);

    const store = createStore();
    store.set(incomingPairInviteAtom, sampleIncoming);
    renderWithStore(<IncomingPairInviteModal />, store);

    expect(await screen.findByText('Pair code from Chrome on Mac?')).toBeTruthy();
    expect(screen.getByText('654321')).toBeTruthy();
    expect(
      screen.getByText(
        'code can see your screen, control every app, and run shell commands as your macOS user without asking, including after restart. Stop anytime from the menu bar.'
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => {
      expect(mocks.declineIncomingPairInvite).toHaveBeenCalledWith(mocks.mx, sampleIncoming);
    });
  });

  it('approves Full Access and renders post-pair permissions row', async () => {
    makeDesktopAccessMock(makeSnapshot());
    mocks.mx = makeRoomClient([]);
    mocks.approveIncomingPairInvite.mockResolvedValueOnce(
      makeSnapshot({ accessibility: 'missing', screenRecording: 'missing' })
    );

    const store = createStore();
    store.set(incomingPairInviteAtom, sampleIncoming);
    renderWithStore(<IncomingPairInviteModal />, store);

    fireEvent.click(await screen.findByRole('button', { name: 'Allow Full Access' }));
    await waitFor(() => {
      expect(mocks.approveIncomingPairInvite).toHaveBeenCalledWith(
        mocks.mx,
        sampleIncoming,
        expect.any(Function),
        'full',
        undefined
      );
    });
    expect(
      await screen.findByText('Shell ready - Waiting for macOS screen & input permissions')
    ).toBeTruthy();
  });
});
