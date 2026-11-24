import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAccessHelperStatus } from '../../src/app/lib/desktopBridge';

const electronMocks = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  return {
    ipcHandlers,
    app: {
      relaunch: vi.fn(),
      exit: vi.fn(),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      setLoginItemSettings: vi.fn(),
    },
    BrowserWindow: vi.fn(),
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/Users/test/Projects'] })),
    },
    ipcMain: {
      handle: vi.fn(
        (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
          ipcHandlers.set(channel, listener);
        }
      ),
    },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown) => ({ template })),
    },
    nativeImage: {
      createFromBuffer: vi.fn(() => ({ setTemplateImage: vi.fn() })),
    },
    screen: {
      getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 25, width: 1440, height: 875 } })),
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
    },
    systemPreferences: {
      isTrustedAccessibilityClient: vi.fn(() => false),
      getMediaAccessStatus: vi.fn(() => 'not-determined'),
    },
    Tray: vi.fn(),
  };
});

vi.mock('electron', () => electronMocks);

import { APP_ORIGIN } from './bundleProtocol';
import {
  MINDROOM_APP_IDS,
  createDesktopAccess,
  registerDesktopAccessHandlers,
  type DesktopBridgeClient,
} from './desktopAccess';
import { loadConsent, setControllerFullAccess } from './desktopAccessConsent';
import { isShellApprovalUrl } from './security';

const tempDirs: string[] = [];
const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-desktop-access-'));
  tempDirs.push(dir);
  return dir;
};

type CallRecord = { action: string; parameters: Record<string, unknown> };

const makeBaseStatus = (
  overrides?: Partial<DesktopAccessHelperStatus>
): DesktopAccessHelperStatus => ({
  config: {
    state: 'ready',
    revision: 1,
    enabled: false,
    controllers: [],
    allowed_app_ids: [],
    file_roots: [],
    shell_enabled: false,
    ...overrides?.config,
  },
  pairing: {
    state: 'unpaired',
    session_state: 'ready',
    homeserver: 'https://mindroom.chat',
    user_id: '@bas:mindroom.chat',
    device_id: 'HELPERDEV1',
    ...overrides?.pairing,
  },
  helper: {
    state: 'running',
    version: '2026.11.568',
    ...overrides?.helper,
  },
  bridge: {
    state: 'stopped',
    active_action: null,
    last_error: null,
    ...overrides?.bridge,
  },
  authority: {
    control_available: false,
    lease_remaining_seconds: 0,
    control_scope: 'saved_apps',
    controllers: {},
    ...overrides?.authority,
  },
  permissions: {
    accessibility: 'missing',
    screen_recording: 'missing',
    gui_permissions_ready: false,
    ...overrides?.permissions,
  },
  shell: {
    enabled: false,
    ready: false,
    pending: null,
    auto_approve_remaining_seconds: 0,
    auto_approve_until_revoked: false,
    active_request_id: null,
    handles: [],
    controllers: {},
    ...overrides?.shell,
  },
});

const createFakeBridgeClient = (initialStatus: DesktopAccessHelperStatus) => {
  let running = false;
  let status = structuredClone(initialStatus);
  let onStatusCb: ((next: DesktopAccessHelperStatus) => void) | undefined;
  const calls: CallRecord[] = [];

  const emitStatus = (): void => {
    onStatusCb?.(structuredClone(status));
  };

  const client: DesktopBridgeClient = {
    start: vi.fn(async () => {
      running = true;
      emitStatus();
    }),
    stop: vi.fn(async () => {
      running = false;
    }),
    isRunning: () => running,
    lastStatus: () => (running ? structuredClone(status) : null),
    request: vi.fn(async (action: string, parameters: Record<string, unknown> = {}) => {
      calls.push({ action, parameters: structuredClone(parameters) });
      if (action === 'status') {
        return { status: structuredClone(status) };
      }
      if (action === 'upsert_controller') {
        const ctrl = parameters.controller as {
          user_id: string;
          device_id: string;
          ed25519: string;
        };
        const controllerKey = `${ctrl.user_id}:${ctrl.device_id}`;
        status.config.revision += 1;
        status.config.controllers = [
          ...status.config.controllers.filter((c) => c.controller_key !== controllerKey),
          {
            controller_key: controllerKey,
            user_id: ctrl.user_id,
            device_id: ctrl.device_id,
            ed25519: ctrl.ed25519,
            allowed_requester_ids: parameters.allowed_requester_ids as string[],
            allowed_agent_names: parameters.allowed_agent_names as string[],
          },
        ];
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'pair') {
        return {
          device_id: status.pairing.device_id ?? 'HELPERDEV1',
          device_ed25519: 'helper-ed25519',
          verification: 'VERIFY-123',
          confirmation_command: '!desktop confirm CODE VERIFY-123',
          agent_confirmation_command: '!desktop confirm code CODE VERIFY-123',
          status: structuredClone(status),
        };
      }
      if (action === 'set_allowed_apps') {
        status.config.revision += 1;
        status.config.allowed_app_ids = [...(parameters.allowed_app_ids as string[])];
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'set_local_access') {
        const files = parameters.files as { roots: string[] };
        const shell = parameters.shell as { enabled: boolean };
        status.config.revision += 1;
        status.config.file_roots = [...files.roots];
        status.config.shell_enabled = shell.enabled;
        status.shell.enabled = shell.enabled;
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'finish_setup') {
        status.config.revision += 1;
        status.config.enabled = true;
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'start') {
        status.bridge.state = 'observe_only';
        status.shell.ready = status.config.shell_enabled;
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'stop') {
        status.bridge.state = 'stopped';
        status.shell.ready = false;
        status.shell.pending = null;
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'grant_control') {
        status.bridge.state = 'control';
        status.authority.control_available = true;
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'revoke_control') {
        status.authority.control_available = false;
        if (status.bridge.state === 'control') status.bridge.state = 'observe_only';
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'remove_controller') {
        const key = parameters.controller_key as string;
        status.config.revision += 1;
        status.config.controllers = status.config.controllers.filter(
          (c) => c.controller_key !== key
        );
        if (status.config.controllers.length === 0) status.bridge.state = 'stopped';
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'decide_shell') {
        status.shell.pending = null;
        emitStatus();
        return { status: structuredClone(status) };
      }
      return { status: structuredClone(status) };
    }) as DesktopBridgeClient['request'],
  };

  return {
    client,
    calls,
    setOnStatus(cb: (next: DesktopAccessHelperStatus) => void) {
      onStatusCb = cb;
    },
    pushStatus(patch: Partial<DesktopAccessHelperStatus>) {
      status = makeBaseStatus({ ...status, ...patch });
      emitStatus();
    },
  };
};

const makeFakeTrayInstance = () => ({
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  destroy: vi.fn(),
  isDestroyed: vi.fn(() => false),
});

const makeFakeBrowserWindow = () => {
  let visible = false;
  const emitter = new EventEmitter();
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: `${APP_ORIGIN}/shell-approval/`, origin: APP_ORIGIN },
    isDestroyed: vi.fn(() => false),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
  });
  return Object.assign(emitter, {
    webContents,
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    show: vi.fn(() => {
      visible = true;
    }),
    focus: vi.fn(),
    showInactive: vi.fn(() => {
      visible = true;
    }),
    hide: vi.fn(() => {
      visible = false;
    }),
    destroy: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
  });
};

afterEach(() => {
  vi.clearAllMocks();
  electronMocks.ipcHandlers.clear();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('desktopAccess', () => {
  it('auto-boots when configured and re-applies grants ONLY for consented controller keys', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    setControllerFullAccess(userDataDir, 'ctrl-full', { agentName: 'General' });

    const initial = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 3,
        enabled: true,
        controllers: [
          {
            controller_key: 'ctrl-full',
            user_id: '@mindroom_general:mindroom.chat',
            device_id: 'DEV1',
            ed25519: 'key1',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['general'],
          },
          {
            controller_key: 'ctrl-restricted',
            user_id: '@mindroom_code:mindroom.chat',
            device_id: 'DEV2',
            ed25519: 'key2',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['code'],
          },
        ],
        allowed_app_ids: ['primary-screen'],
        file_roots: [],
        shell_enabled: true,
      },
    });
    const fake = createFakeBridgeClient(initial);
    const trayInstance = makeFakeTrayInstance();
    electronMocks.Tray.mockImplementation(function () {
      return trayInstance;
    });

    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    await access.start();

    expect(fake.calls.map((c) => c.action)).toEqual([
      'status',
      'start',
      'grant_control',
      'grant_shell',
    ]);
    expect(fake.calls[2]).toEqual({
      action: 'grant_control',
      parameters: { until_revoked: true, scope: 'computer', controller_key: 'ctrl-full' },
    });
    expect(fake.calls[3]).toEqual({
      action: 'grant_shell',
      parameters: { until_revoked: true, controller_key: 'ctrl-full' },
    });
    expect(
      fake.calls.filter(
        (c) =>
          (c.action === 'grant_control' || c.action === 'grant_shell') &&
          c.parameters.controller_key !== 'ctrl-full'
      )
    ).toEqual([]);
  });

  it('pairs a 2nd agent live without stopping or restarting an already-running bridge', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    setControllerFullAccess(userDataDir, '@mindroom_general:mindroom.chat:DEV1', {
      agentName: 'General',
    });

    const initial = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 4,
        enabled: true,
        controllers: [
          {
            controller_key: '@mindroom_general:mindroom.chat:DEV1',
            user_id: '@mindroom_general:mindroom.chat',
            device_id: 'DEV1',
            ed25519: 'key1',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['general'],
          },
        ],
        allowed_app_ids: ['primary-screen'],
        file_roots: [],
        shell_enabled: true,
      },
      bridge: { state: 'control', active_action: null, last_error: null },
      shell: {
        enabled: true,
        ready: true,
        pending: null,
        auto_approve_remaining_seconds: 0,
        auto_approve_until_revoked: true,
        active_request_id: null,
        handles: [],
        controllers: {},
      },
    });
    const fake = createFakeBridgeClient(initial);
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    await access.start();
    fake.calls.length = 0;

    access.noteGesture();
    const pairResult = await access.pair({
      controller: {
        userId: '@mindroom_code:mindroom.chat',
        deviceId: 'DEV2',
        ed25519: 'key2',
      },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['code'],
      code: 'PAIR-CODE-2',
    });
    expect(pairResult.ok).toBe(true);
    if (!pairResult.ok) return;
    expect(pairResult.value.controllerKey).toBe('@mindroom_code:mindroom.chat:DEV2');

    access.noteGesture();
    const finishResult = await access.finishSetup({
      controllerKey: pairResult.value.controllerKey,
      agentName: 'Code',
      mode: 'full',
    });
    expect(finishResult.ok).toBe(true);

    const actions = fake.calls.map((c) => c.action);
    expect(actions).toEqual(['upsert_controller', 'pair', 'grant_control', 'grant_shell']);
    expect(actions).not.toContain('stop');
    expect(actions).not.toContain('start');
    expect(fake.calls[2]?.parameters).toEqual({
      until_revoked: true,
      scope: 'computer',
      controller_key: '@mindroom_code:mindroom.chat:DEV2',
    });
    expect(fake.calls[3]?.parameters).toEqual({
      until_revoked: true,
      controller_key: '@mindroom_code:mindroom.chat:DEV2',
    });
    expect(loadConsent(userDataDir).controllers['@mindroom_code:mindroom.chat:DEV2']?.mode).toBe(
      'full'
    );
  });

  it('configures capabilities, starts bridge, manages login item, and revokes cleanly on revokeAll', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    const fake = createFakeBridgeClient(makeBaseStatus());
    const trayInstance = makeFakeTrayInstance();
    electronMocks.Tray.mockImplementation(function () {
      return trayInstance;
    });
    electronMocks.app.getLoginItemSettings.mockReturnValue({ openAtLogin: false });

    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      enableLoginItem: true,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    // No saved config/consent: auto-boot does not spawn helper.
    await access.start();
    expect(fake.client.start).not.toHaveBeenCalled();

    access.noteGesture();
    const paired = await access.pair({
      controller: { userId: '@agent:mindroom.chat', deviceId: 'AG1', ed25519: 'ed1' },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['general'],
      code: 'C1',
    });
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;

    access.noteGesture();
    const finished = await access.finishSetup({
      controllerKey: paired.value.controllerKey,
      agentName: 'General',
      mode: 'full',
    });
    expect(finished.ok).toBe(true);
    expect(electronMocks.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    expect(loadConsent(userDataDir).managedLoginItem).toBe(true);
    expect(electronMocks.Tray).toHaveBeenCalledTimes(1);

    fake.calls.length = 0;
    access.noteGesture();
    const revoked = await access.revokeAll();
    expect(revoked.ok).toBe(true);
    expect(fake.calls).toEqual([
      { action: 'revoke_control', parameters: {} },
      { action: 'revoke_shell', parameters: {} },
      { action: 'stop', parameters: {} },
    ]);
    expect(loadConsent(userDataDir).controllers).toEqual({});
    expect(electronMocks.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
    expect(trayInstance.destroy).toHaveBeenCalledTimes(1);
  });

  it('enforces gesture gating, gesture consumption, and IPC owner isolation across all handlers', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    let now = 1_000_000;
    const fake = createFakeBridgeClient(makeBaseStatus());
    const panel = makeFakeBrowserWindow();
    electronMocks.BrowserWindow.mockImplementation(function () {
      return panel;
    });

    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      now: () => now,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    const mainFrame = { url: `${APP_ORIGIN}/`, origin: APP_ORIGIN };
    const mainWc = {
      mainFrame,
      isDestroyed: () => false,
    } as unknown as Electron.WebContents;
    const mainEvent = { sender: mainWc, senderFrame: mainFrame };

    registerDesktopAccessHandlers(
      () => [mainWc],
      () => {
        const wc = access.shellApprovalContents();
        return wc ? [wc] : [];
      },
      access
    );

    const revokeHandler = electronMocks.ipcHandlers.get('desktop:access-revoke-all');
    const decideHandler = electronMocks.ipcHandlers.get('desktop:access-decide-shell');
    const statusHandler = electronMocks.ipcHandlers.get('desktop:access-status');
    expect(revokeHandler).toBeDefined();
    expect(decideHandler).toBeDefined();
    expect(statusHandler).toBeDefined();

    // Missing gesture rejected with NO_USER_GESTURE.
    expect(await revokeHandler?.(mainEvent)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

    // Gesture expires after 10 s.
    access.noteGesture();
    now += 10_001;
    expect(await revokeHandler?.(mainEvent)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

    // Valid gesture succeeds once and is consumed so immediate second call fails.
    access.noteGesture();
    expect(await revokeHandler?.(mainEvent)).toMatchObject({ ok: true });
    expect(await revokeHandler?.(mainEvent)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

    // Pushing shell.pending opens the floating shell approval window via showInactive() only.
    await fake.client.start();
    fake.pushStatus({
      bridge: { state: 'observe_only', active_action: null, last_error: null },
      shell: {
        enabled: true,
        ready: true,
        pending: { command_id: 'cmd-1', command: 'ls -la', cwd: '/tmp' },
        auto_approve_remaining_seconds: 0,
        auto_approve_until_revoked: false,
        active_request_id: null,
        handles: [],
        controllers: {},
      },
    });
    panel.emit('ready-to-show');
    expect(panel.showInactive).toHaveBeenCalledTimes(1);
    expect(panel.show).not.toHaveBeenCalled();
    expect(panel.focus).not.toHaveBeenCalled();

    const shellEvent = {
      sender: panel.webContents,
      senderFrame: panel.webContents.mainFrame,
    };

    // Shell approval window can read status and decide shell (only after a user gesture), but cannot revokeAll.
    expect(await statusHandler?.(shellEvent)).toMatchObject({ ok: true });
    expect(await revokeHandler?.(shellEvent)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await decideHandler?.(shellEvent, { commandId: 'cmd-1', approved: true })).toEqual({
      ok: false,
      code: 'NO_USER_GESTURE',
    });
    panel.webContents.emit('input-event', {}, { type: 'mouseUp' });
    expect(await decideHandler?.(shellEvent, { commandId: 'cmd-1', approved: true })).toMatchObject(
      { ok: true }
    );
    expect(panel.hide).toHaveBeenCalled();
  });

  it('tracks live Accessibility checks, Screen Recording relaunchRequired, installed app filtering, and isShellApprovalUrl', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    const fake = createFakeBridgeClient(makeBaseStatus());
    let axTrusted = false;

    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      isTrustedAccessibilityClient: () => axTrusted,
      readInstalledApps: async () => [
        {
          bundleId: 'chat.mindroom.app',
          name: 'MindRoom Chat',
          path: '/Applications/MindRoom Chat.app',
        },
        { bundleId: 'com.apple.Safari', name: 'Safari', path: '/Applications/Safari.app' },
        { bundleId: 'com.apple.Finder', name: 'Finder', path: '/System/Applications/Finder.app' },
      ],
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    const before = await access.getStatus();
    expect(before.ok && before.value.permissions.accessibility).toBe('missing');
    axTrusted = true;
    const after = await access.getStatus();
    expect(after.ok && after.value.permissions.accessibility).toBe('granted');
    expect(fake.calls).toEqual([]);

    access.noteGesture();
    const permRes = await access.requestPermission('screen_recording');
    expect(permRes.ok).toBe(true);
    if (permRes.ok) {
      expect(permRes.value.relaunchRequired).toBe(true);
    }

    const apps = await access.listInstalledApps();
    expect(apps).toEqual({
      ok: true,
      value: [
        { bundleId: 'com.apple.Finder', name: 'Finder', path: '/System/Applications/Finder.app' },
        { bundleId: 'com.apple.Safari', name: 'Safari', path: '/Applications/Safari.app' },
      ],
    });
    expect(MINDROOM_APP_IDS.has('chat.mindroom.app')).toBe(true);

    expect(isShellApprovalUrl(`${APP_ORIGIN}/shell-approval/`)).toBe(true);
    expect(isShellApprovalUrl(`${APP_ORIGIN}/shell-approval`)).toBe(true);
    expect(isShellApprovalUrl(`${APP_ORIGIN}/`)).toBe(false);
    expect(isShellApprovalUrl('https://example.com/shell-approval/')).toBe(false);
  });
  it('handles updateLimits, removeController, login, pickFolder, killShellHandle, relaunch, and Tray revoke without touching pre-existing login item', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    const initial = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 2,
        enabled: true,
        controllers: [
          {
            controller_key: 'ctrl-a',
            user_id: '@agent_a:mindroom.chat',
            device_id: 'A1',
            ed25519: 'ka',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['alpha'],
          },
          {
            controller_key: 'ctrl-b',
            user_id: '@agent_b:mindroom.chat',
            device_id: 'B1',
            ed25519: 'kb',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['beta'],
          },
        ],
        allowed_app_ids: ['com.apple.Safari'],
        file_roots: [],
        shell_enabled: false,
      },
      bridge: { state: 'observe_only', active_action: null, last_error: null },
    });
    const fake = createFakeBridgeClient(initial);
    const trayInstance = makeFakeTrayInstance();
    electronMocks.Tray.mockImplementation(function () {
      return trayInstance;
    });
    // User already had MindRoom Chat set to open at login before using Computer Access.
    electronMocks.app.getLoginItemSettings.mockReturnValue({ openAtLogin: true });

    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      enableLoginItem: true,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    // Upgrade ctrl-a to full access: restarts bridge to add primary-screen & shell, grants ONLY ctrl-a.
    access.noteGesture();
    const upgraded = await access.updateLimits({
      controllerKey: 'ctrl-a',
      agentName: 'Alpha',
      mode: 'full',
    });
    expect(upgraded.ok).toBe(true);
    expect(fake.calls.map((c) => c.action)).toEqual([
      'stop',
      'set_allowed_apps',
      'set_local_access',
      'start',
      'grant_control',
      'grant_shell',
    ]);
    expect(fake.calls[4]?.parameters).toEqual({
      until_revoked: true,
      scope: 'computer',
      controller_key: 'ctrl-a',
    });
    expect(loadConsent(userDataDir).managedLoginItem).toBe(false);

    // Tray shows Full Access label and clicking Revoke Full Access works without a renderer gesture.
    const lastMenuCall = electronMocks.Menu.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{
      label?: string;
      click?: () => void;
    }>;
    expect(lastMenuCall?.[0]?.label).toBe('MindRoom · Full Access (Alpha)');
    expect(lastMenuCall?.[1]?.label).toBe('Revoke Full Access');

    // Downgrade ctrl-a back to restricted with timed control lease.
    fake.calls.length = 0;
    access.noteGesture();
    const restricted = await access.updateLimits({
      controllerKey: 'ctrl-a',
      mode: 'restricted',
      controlDurationSeconds: 300,
    });
    expect(restricted.ok).toBe(true);
    expect(fake.calls).toEqual([
      { action: 'grant_control', parameters: { duration_seconds: 300, controller_key: 'ctrl-a' } },
      { action: 'revoke_shell', parameters: { controller_key: 'ctrl-a' } },
    ]);

    // Remove ctrl-b clears its grants and calls remove_controller.
    fake.calls.length = 0;
    access.noteGesture();
    expect((await access.removeController('ctrl-b')).ok).toBe(true);
    expect(fake.calls.map((c) => c.action)).toEqual([
      'revoke_control',
      'revoke_shell',
      'remove_controller',
    ]);

    // Login maps camelCase request fields to strict helper snake_case keys.
    fake.calls.length = 0;
    access.noteGesture();
    expect(
      (
        await access.login({
          homeserver: 'https://mindroom.chat',
          userId: '@bas:mindroom.chat',
          method: 'sso',
          loginToken: 'tok-123',
          replace: true,
          cloudflareAccess: false,
        })
      ).ok
    ).toBe(true);
    expect(fake.calls).toEqual([
      { action: 'stop', parameters: {} },
      {
        action: 'login',
        parameters: {
          homeserver: 'https://mindroom.chat',
          user_id: '@bas:mindroom.chat',
          method: 'sso',
          login_token: 'tok-123',
          replace: true,
          cloudflare_access: false,
        },
      },
    ]);

    // pickFolder, killShellHandle, and relaunch.
    access.noteGesture();
    expect(await access.pickFolder()).toEqual({ ok: true, value: '/Users/test/Projects' });

    fake.calls.length = 0;
    access.noteGesture();
    expect((await access.killShellHandle('h-9')).ok).toBe(true);
    expect(fake.calls).toEqual([{ action: 'kill_shell_handle', parameters: { handle: 'h-9' } }]);

    // Pre-existing openAtLogin: true is never disabled on revokeAll.
    access.noteGesture();
    await access.revokeAll();
    expect(electronMocks.app.setLoginItemSettings).not.toHaveBeenCalled();

    access.noteGesture();
    expect(await access.relaunch()).toEqual({ ok: true, value: undefined });
    expect(electronMocks.app.relaunch).toHaveBeenCalledTimes(1);
    expect(electronMocks.app.exit).toHaveBeenCalledWith(0);
  });
  it('authorizes single-click login -> pair -> finishSetup across >10s within 3m, scoped strictly to paired controllerKey', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    let now = 5_000_000;
    const fake = createFakeBridgeClient(makeBaseStatus());
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      now: () => now,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    // Single click on Allow Full Access opens setup authorization across login -> pair -> finishSetup.
    access.noteGesture();
    const loginRes = await access.login({
      homeserver: 'https://mindroom.chat',
      method: 'sso',
      loginToken: 'tok-1',
    });
    expect(loginRes.ok).toBe(true);

    // Other sensitive actions still strictly require a fresh gesture even while setupAuth is active.
    expect(await access.revokeAll()).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
    expect(await access.pickFolder()).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

    // >10s later (e.g. after SSO/UIA), pair succeeds without another click and binds controllerKey.
    now += 45_000;
    const pairRes = await access.pair({
      controller: { userId: '@agent:mindroom.chat', deviceId: 'AG1', ed25519: 'ed1' },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['general'],
      code: 'PAIR-1',
    });
    expect(pairRes.ok).toBe(true);
    if (!pairRes.ok) return;

    // Wrong controllerKey is rejected even while setupAuth is active.
    now += 45_000;
    expect(
      await access.finishSetup({
        controllerKey: '@other:mindroom.chat:EVIL',
        mode: 'full',
      })
    ).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

    // Matching controllerKey succeeds and consumes setupAuth so a replay fails.
    const finishRes = await access.finishSetup({
      controllerKey: pairRes.value.controllerKey,
      agentName: 'General',
      mode: 'full',
    });
    expect(finishRes.ok).toBe(true);
    expect(
      await access.finishSetup({
        controllerKey: pairRes.value.controllerKey,
        mode: 'full',
      })
    ).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
  });

  it('revokes live grants when downgrading a Full Access controller to restricted in finishSetup and never enables Login Item if consent write fails', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    setControllerFullAccess(userDataDir, 'ctrl-full', { agentName: 'General' });

    const initial = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 3,
        enabled: true,
        controllers: [
          {
            controller_key: 'ctrl-full',
            user_id: '@agent:mindroom.chat',
            device_id: 'D1',
            ed25519: 'k1',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['general'],
          },
        ],
        allowed_app_ids: ['primary-screen'],
        file_roots: [],
        shell_enabled: true,
      },
      bridge: { state: 'control', active_action: null, last_error: null },
    });
    const fake = createFakeBridgeClient(initial);
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    await access.start();
    fake.calls.length = 0;

    access.noteGesture();
    const downgraded = await access.finishSetup({
      controllerKey: 'ctrl-full',
      mode: 'restricted',
      allowedAppIds: ['primary-screen'],
      shellEnabled: true,
      controlDurationSeconds: 180,
    });
    expect(downgraded.ok).toBe(true);
    expect(loadConsent(userDataDir).controllers).toEqual({});
    expect(fake.calls).toEqual([
      { action: 'revoke_control', parameters: { controller_key: 'ctrl-full' } },
      { action: 'revoke_shell', parameters: { controller_key: 'ctrl-full' } },
      {
        action: 'grant_control',
        parameters: { duration_seconds: 180, controller_key: 'ctrl-full' },
      },
    ]);

    // If writing desktop-access-consent.json fails, Login Item must never be turned on unrecorded.
    const brokenUserData = makeTempDir();
    fs.mkdirSync(path.join(brokenUserData, 'desktop-access-consent.json'));
    electronMocks.app.getLoginItemSettings.mockReturnValue({ openAtLogin: false });
    const fake2 = createFakeBridgeClient(initial);
    const brokenAccess = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir: brokenUserData,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      enableLoginItem: true,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake2.setOnStatus(onStatus);
        return fake2.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    brokenAccess.noteGesture();
    const failed = await brokenAccess.finishSetup({
      controllerKey: 'ctrl-full',
      agentName: 'General',
      mode: 'full',
    });
    expect(failed.ok).toBe(false);
    expect(electronMocks.app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});
