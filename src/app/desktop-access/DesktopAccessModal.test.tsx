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

import { findPairedController, resolveRoomAgents } from './desktopAccessHelpers';
import { DesktopAccessModalRenderer } from './DesktopAccessModal';
import { IncomingPairInviteModal } from './IncomingPairInviteModal';
import { incomingPairInviteAtom } from './macPairInvite';
import * as css from './desktopAccess.css';

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
    abortSetup: vi.fn(async () => ({ ok: true as const, value: initialSnapshot })),
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

const makeRoomClient = (
  members: Array<{ userId: string; name?: string; rawDisplayName?: string }>,
  options?: { viewerUserId?: string; roomId?: string }
): MatrixClient => {
  const viewerUserId = options?.viewerUserId ?? '@alice:example.org';
  const targetRoomId = options?.roomId ?? '!room:example.org';
  return {
    getUserId: () => viewerUserId,
    getHomeserverUrl: () => 'https://matrix.example.org',
    getRoom: (roomId: string) =>
      roomId === targetRoomId
        ? {
            getJoinedMembers: () =>
              members.map((m) => ({
                userId: m.userId,
                name: m.name ?? m.userId,
                ...(m.rawDisplayName !== undefined ? { rawDisplayName: m.rawDisplayName } : {}),
                membership: 'join',
              })),
          }
        : null,
  } as unknown as MatrixClient;
};

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

    expect(await screen.findByText('Allow Code full access to this Mac?')).toBeTruthy();
    expect(
      screen.getByText(
        'Code can see your screen, control every app, and run shell commands as your macOS user without asking, including after restart. Stop anytime from the menu bar.'
      )
    ).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
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

    expect(await screen.findByText('Allow Research full access to this Mac?')).toBeTruthy();
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
      within(perAgentSection).getByText('Control & shell approval for Code (per-agent)')
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

    expect(await screen.findByText("Code is now paired with Bas's MacBook Pro.")).toBeTruthy();
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
    expect(downloadLink.style.textDecoration).toBe('none');
    expect(screen.getByText(MAC_APP_BREW_COMMAND)).toBeTruthy();
  });

  it('matches paired controllers strictly on exact Matrix user ID and requester ID without falling back to agent name', () => {
    const snapshot = makeSnapshot({
      controllers: [
        {
          controller_key: 'ctrl:server-a',
          user_id: '@mindroom_assistant:server-a.test',
          device_id: 'DEV_A',
          ed25519: 'KEY_A',
          allowed_requester_ids: ['@alice:server-a.test'],
          allowed_agent_names: ['assistant'],
        },
      ],
    });

    // Different homeserver sharing the same agent name "assistant" must NOT match.
    expect(
      findPairedController(snapshot, '@mindroom_assistant:server-b.test', '@alice:server-a.test')
    ).toBeUndefined();

    // Same agent user ID but different requester must NOT match.
    expect(
      findPairedController(snapshot, '@mindroom_assistant:server-a.test', '@bob:server-a.test')
    ).toBeUndefined();

    // Exact agent user ID + allowed requester ID matches cleanly.
    expect(
      findPairedController(snapshot, '@mindroom_assistant:server-a.test', '@alice:server-a.test')
        ?.controller_key
    ).toBe('ctrl:server-a');
  });

  it('keeps Full screen off when reopening a shell-only config and drops GUI control to Observe only when turning Full screen off with no apps', async () => {
    const shellOnly = makeSnapshot({
      allowedAppIds: [],
      fileRoots: [],
      shellEnabled: true,
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
    });
    const access = makeDesktopAccessMock(shellOnly);
    vi.mocked(access.updateLimits).mockResolvedValueOnce({ ok: true, value: shellOnly });
    mocks.mx = makeRoomClient([]);

    const store = createStore();
    store.set(desktopAccessModalAtom, {
      agentUserId: '@mindroom_code:example.org',
      agentName: 'code',
    });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit limits...' }));
    const perAgentSection = await screen.findByTestId('limits-per-agent-section');
    const sharedSection = screen.getByTestId('limits-shared-section');

    const fullScreenSwitch = within(sharedSection).getByRole('switch', {
      name: 'Full screen (primary-screen)',
    });
    expect(fullScreenSwitch.getAttribute('aria-checked')).toBe('false');

    // Selecting Full Access turns Full screen on; turning Full screen back off with no apps drops GUI control to Observe only.
    fireEvent.click(
      within(perAgentSection).getByRole('radio', { name: 'Full Access until revoked' })
    );
    expect(fullScreenSwitch.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(fullScreenSwitch);
    expect(fullScreenSwitch.getAttribute('aria-checked')).toBe('false');
    expect(
      within(perAgentSection)
        .getByRole('radio', { name: 'Observe only' })
        .getAttribute('aria-checked')
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => {
      expect(access.updateLimits).toHaveBeenCalledWith({
        controllerKey: 'ctrl:code',
        agentName: 'code',
        mode: 'restricted',
        allowedAppIds: [],
        fileRoots: [],
        shellEnabled: true,
        shellAutoApproveUntilRevoked: true,
      });
    });
  });

  it('keeps shell-only initial GUI choice as Observe only even when controller has Full Access consent and preserves allowedAppIds=[] on immediate save', async () => {
    const shellOnlyWithFullConsent = makeSnapshot({
      allowedAppIds: [],
      fileRoots: [],
      shellEnabled: true,
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
    const access = makeDesktopAccessMock(shellOnlyWithFullConsent);
    vi.mocked(access.updateLimits).mockResolvedValueOnce({
      ok: true,
      value: shellOnlyWithFullConsent,
    });
    mocks.mx = makeRoomClient([]);

    const store = createStore();
    store.set(desktopAccessModalAtom, {
      agentUserId: '@mindroom_code:example.org',
      agentName: 'code',
    });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit limits...' }));
    const perAgentSection = await screen.findByTestId('limits-per-agent-section');
    const sharedSection = screen.getByTestId('limits-shared-section');

    expect(
      within(perAgentSection)
        .getByRole('radio', { name: 'Observe only' })
        .getAttribute('aria-checked')
    ).toBe('true');
    expect(
      within(sharedSection)
        .getByRole('switch', { name: 'Full screen (primary-screen)' })
        .getAttribute('aria-checked')
    ).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => {
      expect(access.updateLimits).toHaveBeenCalledWith({
        controllerKey: 'ctrl:code',
        agentName: 'code',
        mode: 'restricted',
        allowedAppIds: [],
        fileRoots: [],
        shellEnabled: true,
        shellAutoApproveUntilRevoked: true,
      });
    });
  });

  it('passes stored controller allowed_agent_names[0] when disconnecting a namespaced agent', async () => {
    const paired = makeSnapshot({
      controllers: [
        {
          controller_key: 'ctrl:writer',
          user_id: '@mindroom_writer_ab12:example.org',
          device_id: 'DEV1',
          ed25519: 'KEY1',
          allowed_requester_ids: ['@alice:example.org'],
          allowed_agent_names: ['writer'],
        },
      ],
    });
    makeDesktopAccessMock(paired);
    mocks.disconnectAgentFromThisMac.mockResolvedValueOnce(makeSnapshot());
    mocks.mx = makeRoomClient([]);

    const store = createStore();
    store.set(desktopAccessModalAtom, {
      agentUserId: '@mindroom_writer_ab12:example.org',
      agentName: 'writer_ab12',
    });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() => {
      expect(mocks.disconnectAgentFromThisMac).toHaveBeenCalledWith(
        mocks.mx,
        'ctrl:writer',
        '@mindroom_writer_ab12:example.org',
        'writer'
      );
    });
  });

  it('excludes a namespaced router with a sibling agent and opens directly on the clean rawDisplayName', async () => {
    const initial = makeSnapshot({ accessibility: 'granted', screenRecording: 'granted' });
    const paired = makeSnapshot({
      accessibility: 'granted',
      screenRecording: 'granted',
      controllers: [
        {
          controller_key: 'ctrl:helper',
          user_id: '@mindroom_helper_t528831bc:matrix.localhost',
          device_id: 'DEV1',
          ed25519: 'KEY1',
          allowed_requester_ids: ['@alice:matrix.localhost'],
          allowed_agent_names: ['helper_t528831bc'],
        },
      ],
      consent: {
        'ctrl:helper': { mode: 'full', grantedAt: 1000, agentName: 'helper_t528831bc' },
      },
    });
    makeDesktopAccessMock(initial);
    mocks.pairAgentOnThisMac.mockResolvedValueOnce(paired);
    mocks.mx = makeRoomClient(
      [
        { userId: '@alice:matrix.localhost', name: 'Alice', rawDisplayName: 'Alice' },
        {
          userId: '@mindroom_helper_t528831bc:matrix.localhost',
          name: 'Helper (@mindroom_helper_t528831bc:matrix.localhost)',
          rawDisplayName: 'Helper',
        },
        {
          userId: '@mindroom_router_t528831bc:matrix.localhost',
          name: 'Router',
          rawDisplayName: 'Router',
        },
      ],
      { viewerUserId: '@alice:matrix.localhost', roomId: '!room:matrix.localhost' }
    );

    const store = createStore();
    store.set(desktopAccessModalAtom, { roomId: '!room:matrix.localhost' });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    expect(await screen.findByText('Allow Helper full access to this Mac?')).toBeTruthy();
    expect(screen.queryByText(/router/i)).toBeNull();
    expect(
      screen.getByText(
        'Helper can see your screen, control every app, and run shell commands as your macOS user without asking, including after restart. Stop anytime from the menu bar.'
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Allow Full Access' }));

    await waitFor(() => {
      expect(mocks.pairAgentOnThisMac).toHaveBeenCalledWith(
        mocks.mx,
        {
          agentUserId: '@mindroom_helper_t528831bc:matrix.localhost',
          agentName: 'helper_t528831bc',
          mode: 'full',
        },
        expect.any(Function),
        expect.any(Function),
        expect.any(AbortSignal)
      );
    });

    // Post-pair view with gui_permissions_ready renders a single Full Access active banner (no duplicate pill).
    expect(await screen.findByText('Helper on this Mac')).toBeTruthy();
    expect(screen.getAllByText('Full Access active')).toHaveLength(1);
  });

  it('resolves clean displayName from room members when opened with preselected agentUserId and roomId', async () => {
    makeDesktopAccessMock(makeSnapshot());
    mocks.mx = makeRoomClient(
      [
        {
          userId: '@mindroom_helper_t528831bc:matrix.localhost',
          name: 'Helper (@mindroom_helper_t528831bc:matrix.localhost)',
          rawDisplayName: 'Helper',
        },
        {
          userId: '@mindroom_router_t528831bc:matrix.localhost',
          name: 'Router',
          rawDisplayName: 'Router',
        },
      ],
      { viewerUserId: '@alice:matrix.localhost', roomId: '!room:matrix.localhost' }
    );

    const store = createStore();
    store.set(desktopAccessModalAtom, {
      roomId: '!room:matrix.localhost',
      agentUserId: '@mindroom_helper_t528831bc:matrix.localhost',
      agentName: 'helper_t528831bc',
    });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    expect(await screen.findByText('Allow Helper full access to this Mac?')).toBeTruthy();
  });

  it('keeps a standalone mindroom_router_<ns> agent and falls back to agentName when display names equal userId', () => {
    const resolved = resolveRoomAgents(
      [
        {
          userId: '@mindroom_router_foo1:example.org',
          name: '@mindroom_router_foo1:example.org',
          rawDisplayName: '@mindroom_router_foo1:example.org',
          membership: 'join',
        },
        {
          userId: '@mindroom_code:example.org',
          name: 'Code',
          rawDisplayName: '   ',
          membership: 'join',
        },
      ],
      '@alice:example.org'
    );

    expect(resolved).toEqual([
      { userId: '@mindroom_code:example.org', agentName: 'code', displayName: 'Code' },
      {
        userId: '@mindroom_router_foo1:example.org',
        agentName: 'router_foo1',
        displayName: 'router_foo1',
      },
    ]);
  });

  it('renders Edit limits with a separate scrollable body, pinned footer, plain label app rows, and status bar errors', async () => {
    const paired = makeSnapshot({
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
    });
    const access = makeDesktopAccessMock(paired);
    vi.mocked(access.updateLimits).mockResolvedValueOnce({
      ok: false,
      code: 'helper_error',
      message: 'Helper rejected limits',
    });
    mocks.mx = makeRoomClient([]);

    const store = createStore();
    store.set(desktopAccessModalAtom, {
      agentUserId: '@mindroom_code:example.org',
      agentName: 'code',
    });
    renderWithStore(<DesktopAccessModalRenderer />, store);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit limits...' }));
    const perAgentSection = await screen.findByTestId('limits-per-agent-section');
    const sharedSection = screen.getByTestId('limits-shared-section');
    await within(sharedSection).findByRole('checkbox', { name: 'Safari' });

    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains(css.ModalDialogLimits)).toBe(true);

    const bodies = Array.from(dialog.getElementsByClassName(css.ModalBody));
    const footers = Array.from(dialog.getElementsByClassName(css.ModalFooter));
    expect(bodies).toHaveLength(1);
    expect(footers).toHaveLength(1);

    const body = bodies[0] as HTMLElement;
    const footer = footers[0] as HTMLElement;
    expect(body.contains(perAgentSection)).toBe(true);
    expect(body.contains(sharedSection)).toBe(true);
    expect(body.contains(footer)).toBe(false);
    expect(within(body).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(within(body).queryByRole('button', { name: 'Save limits' })).toBeNull();
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(footer).getByRole('button', { name: 'Save limits' })).toBeTruthy();

    const appRows = Array.from(sharedSection.querySelectorAll('label'));
    expect(appRows.length).toBeGreaterThanOrEqual(2);
    for (const row of appRows) {
      expect(row.tagName).toBe('LABEL');
      expect(row.className).toBe(css.ChecklistRow);
    }

    fireEvent.click(within(footer).getByRole('button', { name: 'Save limits' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Helper rejected limits');
    const statusBars = Array.from(dialog.getElementsByClassName(css.ModalStatusBar));
    expect(statusBars).toHaveLength(1);
    expect(statusBars[0]?.contains(alert)).toBe(true);
    expect(body.contains(alert)).toBe(false);
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

  it('renders Choose limits with a separate scrollable body, pinned footer, and plain label app rows', async () => {
    makeDesktopAccessMock(makeSnapshot());
    mocks.mx = makeRoomClient([]);

    const store = createStore();
    store.set(incomingPairInviteAtom, sampleIncoming);
    renderWithStore(<IncomingPairInviteModal />, store);

    fireEvent.click(await screen.findByRole('button', { name: 'Choose limits...' }));
    const perAgentSection = await screen.findByTestId('limits-per-agent-section');
    const sharedSection = screen.getByTestId('limits-shared-section');
    await within(sharedSection).findByRole('checkbox', { name: 'Safari' });

    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains(css.ModalDialogLimits)).toBe(true);

    const bodies = Array.from(dialog.getElementsByClassName(css.ModalBody));
    const footers = Array.from(dialog.getElementsByClassName(css.ModalFooter));
    expect(bodies).toHaveLength(1);
    expect(footers).toHaveLength(1);

    const body = bodies[0] as HTMLElement;
    const footer = footers[0] as HTMLElement;
    expect(body.contains(perAgentSection)).toBe(true);
    expect(body.contains(sharedSection)).toBe(true);
    expect(body.contains(footer)).toBe(false);
    expect(within(body).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(within(body).queryByRole('button', { name: 'Allow with limits' })).toBeNull();
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(footer).getByRole('button', { name: 'Allow with limits' })).toBeTruthy();

    const appRows = Array.from(sharedSection.querySelectorAll('label'));
    expect(appRows.length).toBeGreaterThanOrEqual(2);
    for (const row of appRows) {
      expect(row.tagName).toBe('LABEL');
      expect(row.className).toBe(css.ChecklistRow);
    }
  });
});
