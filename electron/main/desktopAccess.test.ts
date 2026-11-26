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
import { DesktopHelperError } from './desktopBridgeProcess';
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
    enabled: Boolean(overrides?.config?.shell_enabled),
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
      if (action === 'grant_shell' || action === 'revoke_shell') {
        if (!status.shell.enabled) {
          throw new DesktopHelperError('shell_denied', 'Shell access is disabled.');
        }
        emitStatus();
        return { status: structuredClone(status) };
      }
      if (action === 'remove_controller') {
        if (parameters.expected_revision !== status.config.revision) {
          throw new Error(
            `revision mismatch: expected ${String(parameters.expected_revision)}, actual ${status.config.revision}`
          );
        }
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
    currentStatus: () => structuredClone(status),
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
    expect(actions).toEqual([
      'upsert_controller',
      'pair',
      'grant_control',
      'grant_shell',
      'request_permission',
    ]);
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
      {
        action: 'remove_controller',
        parameters: {
          expected_revision: 5,
          controller_key: paired.value.controllerKey,
        },
      },
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

    // Main chat window cannot decide pending shell commands even with a fresh main-window gesture.
    access.noteGesture();
    expect(await decideHandler?.(mainEvent, { commandId: 'cmd-1', approved: true })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });

    // Shell approval window can read status and decide shell (only after an approval-window gesture), but cannot revokeAll.
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
      'request_permission',
    ]);
    expect(fake.calls[4]?.parameters).toEqual({
      until_revoked: true,
      scope: 'computer',
      controller_key: 'ctrl-a',
    });
    expect(loadConsent(userDataDir).managedLoginItem).toBe(false);

    // Tray shows Full Access label and clicking Revoke All Access works without a renderer gesture.
    const lastMenuCall = electronMocks.Menu.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{
      label?: string;
      click?: () => void;
    }>;
    expect(lastMenuCall?.[0]?.label).toBe('MindRoom · Full Access (Alpha)');
    expect(lastMenuCall?.[1]?.label).toBe('Revoke All Access');

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

  it('opens setup authorization with beginSetup from one gesture, so login, pair, and finishSetup still pass after a slow setup offer', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    let now = 7_000_000;
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
    const login = { homeserver: 'https://mindroom.chat', method: 'sso' as const, loginToken: 't' };
    const pair = {
      controller: { userId: '@agent:mindroom.chat', deviceId: 'AG1', ed25519: 'ed1' },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['general'],
      code: 'PAIR-1',
    };

    // Without a gesture nothing opens, and login stays closed.
    expect(await access.beginSetup()).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
    expect(await access.login(login)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

    // One click: beginSetup consumes the gesture, so nothing else rides on it.
    access.noteGesture();
    expect(await access.beginSetup()).toEqual({ ok: true, value: undefined });
    expect(await access.revokeAll()).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
    expect(await access.beginSetup()).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

    // The agent's setup offer takes 15 s: login, pair, and finishSetup still pass without a click.
    now += 15_000;
    expect((await access.login(login)).ok).toBe(true);
    now += 15_000;
    const paired = await access.pair(pair);
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    // Once a controller is bound, the authorization signs nobody else in.
    expect(await access.login(login)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
    now += 15_000;
    const { controllerKey } = paired.value;
    expect((await access.finishSetup({ controllerKey, mode: 'full' })).ok).toBe(true);
    expect(await access.finishSetup({ controllerKey, mode: 'full' })).toEqual({
      ok: false,
      code: 'NO_USER_GESTURE',
    });

    // A helper that is already signed in pairs straight after the slow offer.
    access.noteGesture();
    expect((await access.beginSetup()).ok).toBe(true);
    now += 15_000;
    const again = await access.pair(pair);
    expect(again.ok).toBe(true);
    expect((await access.finishSetup({ controllerKey, mode: 'restricted' })).ok).toBe(true);

    // The authorization runs out after 3 minutes.
    access.noteGesture();
    expect((await access.beginSetup()).ok).toBe(true);
    now += 180_001;
    expect(await access.login(login)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
    expect(await access.pair(pair)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
  });

  it('moves the setup authorization forward only: one sign-in per click, then pair, then finishSetup', async () => {
    const fake = createFakeBridgeClient(makeBaseStatus());
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });
    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir: makeTempDir(),
      storagePath: makeTempDir(),
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
    const login = { homeserver: 'https://mindroom.chat', method: 'sso' as const, loginToken: 't' };
    const pair = {
      controller: { userId: '@agent:mindroom.chat', deviceId: 'AG1', ed25519: 'ed1' },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['general'],
      code: 'PAIR-1',
    };
    const refused = { ok: false, code: 'NO_USER_GESTURE' };
    const loginCalls = (): number => fake.calls.filter((call) => call.action === 'login').length;

    // One click signs the helper in once: a second sign-in is refused, pairing goes on.
    access.noteGesture();
    expect((await access.beginSetup()).ok).toBe(true);
    expect((await access.login(login)).ok).toBe(true);
    expect(await access.login({ ...login, replace: true })).toEqual(refused);
    expect(loginCalls()).toBe(1);
    const paired = await access.pair(pair);
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    const { controllerKey } = paired.value;

    // After pairing only finishSetup for that controller is left.
    expect(await access.login(login)).toEqual(refused);
    expect(await access.pair(pair)).toEqual(refused);
    expect(await access.finishSetup({ controllerKey: 'another-key', mode: 'full' })).toEqual(
      refused
    );
    expect((await access.finishSetup({ controllerKey, mode: 'full' })).ok).toBe(true);
    expect(await access.finishSetup({ controllerKey, mode: 'full' })).toEqual(refused);
    expect(loginCalls()).toBe(1);

    // A sign-in that fails spends the authorization: nothing is left to retry on.
    access.noteGesture();
    expect((await access.beginSetup()).ok).toBe(true);
    vi.mocked(fake.client.request).mockRejectedValueOnce(new Error('sign-in refused'));
    expect(await access.login(login)).toMatchObject({ ok: false, message: 'sign-in refused' });
    expect(await access.login(login)).toEqual(refused);
    expect(await access.pair(pair)).toEqual(refused);
  });

  it('takes desktop:access-begin-setup from the main window only, without arguments', async () => {
    const access = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir: makeTempDir(),
      storagePath: makeTempDir(),
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: () => createFakeBridgeClient(makeBaseStatus()).client,
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });
    const frame = { url: `${APP_ORIGIN}/`, origin: APP_ORIGIN };
    const mainWc = {
      mainFrame: frame,
      isDestroyed: () => false,
    } as unknown as Electron.WebContents;
    const otherFrame = { url: `${APP_ORIGIN}/shell-approval/`, origin: APP_ORIGIN };
    const otherWc = { mainFrame: otherFrame, isDestroyed: () => false };
    registerDesktopAccessHandlers(
      () => [mainWc],
      () => [otherWc as unknown as Electron.WebContents],
      access
    );
    const beginSetup = electronMocks.ipcHandlers.get('desktop:access-begin-setup');
    expect(beginSetup).toBeDefined();

    access.noteGesture();
    // The shell approval window may not open a setup, and a refusal leaves the gesture unspent.
    expect(await beginSetup?.({ sender: otherWc, senderFrame: otherFrame })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    const mainEvent = { sender: mainWc, senderFrame: frame };
    expect(await beginSetup?.(mainEvent, 'extra')).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(await beginSetup?.(mainEvent)).toEqual({ ok: true, value: undefined });
    expect(await beginSetup?.(mainEvent)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
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
      { action: 'request_permission', parameters: { permission: 'accessibility' } },
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

  it('durably removes all saved controllers on revokeAll so relaunch never auto-starts the bridge', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    fs.mkdirSync(path.join(storagePath, 'desktop_bridge'), { recursive: true });
    fs.writeFileSync(path.join(storagePath, 'desktop_bridge', 'native_config.json'), '{}');

    const fake1 = createFakeBridgeClient(makeBaseStatus());
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const access1 = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake1.setOnStatus(onStatus);
        return fake1.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    // Pair two controllers (Full Access + Restricted) so revision advances across multiple removals.
    access1.noteGesture();
    const pair1 = await access1.pair({
      controller: { userId: '@mindroom_general:mindroom.chat', deviceId: 'D1', ed25519: 'k1' },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['general'],
      code: 'C1',
    });
    expect(pair1.ok).toBe(true);
    if (!pair1.ok) return;

    access1.noteGesture();
    const finish1 = await access1.finishSetup({
      controllerKey: pair1.value.controllerKey,
      agentName: 'General',
      mode: 'full',
    });
    expect(finish1.ok).toBe(true);

    access1.noteGesture();
    const pair2 = await access1.pair({
      controller: { userId: '@mindroom_code:mindroom.chat', deviceId: 'D2', ed25519: 'k2' },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['code'],
      code: 'C2',
    });
    expect(pair2.ok).toBe(true);
    if (!pair2.ok) return;

    access1.noteGesture();
    const finish2 = await access1.finishSetup({
      controllerKey: pair2.value.controllerKey,
      agentName: 'Code',
      mode: 'restricted',
      allowedAppIds: ['primary-screen'],
      shellEnabled: true,
    });
    expect(finish2.ok).toBe(true);
    expect(fake1.currentStatus().config.controllers).toHaveLength(2);

    // Revoke All Access, then shut down the first DesktopAccess instance.
    fake1.calls.length = 0;
    access1.noteGesture();
    const revoked = await access1.revokeAll();
    expect(revoked.ok).toBe(true);
    expect(fake1.currentStatus().config.controllers).toEqual([]);
    expect(fake1.currentStatus().bridge.state).toBe('stopped');
    expect(loadConsent(userDataDir).controllers).toEqual({});
    expect(fake1.calls.filter((c) => c.action === 'remove_controller')).toHaveLength(2);

    await access1.stop();

    // Relaunch a brand-new DesktopAccess instance against the same userDataDir and persisted helper state.
    const persistedStatus = fake1.currentStatus();
    const fake2 = createFakeBridgeClient(persistedStatus);
    const access2 = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake2.setOnStatus(onStatus);
        return fake2.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    await access2.start();
    const statusAfterRelaunch = await access2.getStatus();
    expect(statusAfterRelaunch.ok).toBe(true);
    if (!statusAfterRelaunch.ok) return;
    expect(statusAfterRelaunch.value.consent).toEqual({});
    expect(statusAfterRelaunch.value.status?.config.controllers).toEqual([]);
    expect(statusAfterRelaunch.value.status?.bridge.state).toBe('stopped');
    expect(fake2.calls.map((c) => c.action)).not.toContain('start');
    expect(fake2.calls.map((c) => c.action)).not.toContain('grant_control');
    expect(fake2.calls.map((c) => c.action)).not.toContain('grant_shell');
    await access2.stop();
  });

  it('returns ok: false from revokeAll when the helper refuses remove_controller and leaves a controller behind', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
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
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    access.noteGesture();
    const paired = await access.pair({
      controller: { userId: '@mindroom_general:mindroom.chat', deviceId: 'D1', ed25519: 'k1' },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['general'],
      code: 'C1',
    });
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;

    access.noteGesture();
    expect(
      (
        await access.finishSetup({
          controllerKey: paired.value.controllerKey,
          agentName: 'General',
          mode: 'full',
        })
      ).ok
    ).toBe(true);

    // Simulate helper refusing remove_controller while leaving the controller persisted in status.
    const originalRequest = fake.client.request;
    fake.client.request = vi.fn(
      async (action: string, parameters: Record<string, unknown> = {}) => {
        if (action === 'remove_controller') {
          throw new DesktopHelperError('config_write_failed', 'Cannot persist native_config.json');
        }
        return originalRequest(action, parameters);
      }
    ) as DesktopBridgeClient['request'];

    access.noteGesture();
    const revoked = await access.revokeAll();
    expect(revoked).toEqual({
      ok: false,
      code: 'config_write_failed',
      message: 'Cannot persist native_config.json',
    });
    // Local consent is still cleared and live bridge stopped, while the remaining controller stays reported.
    expect(loadConsent(userDataDir).controllers).toEqual({});
    expect(fake.currentStatus().bridge.state).toBe('stopped');
    expect(fake.currentStatus().config.controllers).toHaveLength(1);
    await access.stop();
  });

  it('isolates configPath and storagePath inside userDataDir when isTestHelper is enabled', async () => {
    const userDataDir = makeTempDir();
    const fakeHelperBin = path.resolve(process.cwd(), 'e2e/helpers/fakeDesktopHelper.mjs');
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const access = createDesktopAccess({
      platform: 'linux',
      arch: 'x64',
      userDataDir,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: fakeHelperBin },
      isTestHelper: true,
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    access.noteGesture();
    const loginRes = await access.login({
      homeserver: 'https://example.test',
      userId: '@demo_user:example.test',
      method: 'auto',
      loginToken: 'demo_token',
    });
    expect(loginRes.ok).toBe(true);

    const expectedSessionFile = path.join(
      userDataDir,
      'desktop-bridge-test',
      'mindroom_data',
      'desktop_bridge',
      'matrix_session.json'
    );
    expect(fs.existsSync(expectedSessionFile)).toBe(true);
    await access.stop();
  });

  it('normalizes real shell.py request_id and command_preview from fakeDesktopHelper end-to-end', async () => {
    const userDataDir = makeTempDir();
    const fakeHelperBin = path.resolve(process.cwd(), 'e2e/helpers/fakeDesktopHelper.mjs');
    const panel = makeFakeBrowserWindow();
    electronMocks.BrowserWindow.mockImplementation(function () {
      return panel;
    });
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const access = createDesktopAccess({
      platform: 'linux',
      arch: 'x64',
      userDataDir,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: fakeHelperBin },
      isTestHelper: true,
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    const storageDir = path.join(userDataDir, 'desktop-bridge-test', 'mindroom_data');
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(
      path.join(storageDir, 'pending-shell.json'),
      JSON.stringify({
        request_id: 'req-real-wire-1',
        requester_id: '@demo:example.test',
        agent_name: 'calendar',
        command: 'ls -la',
        cwd: '/tmp',
        expires_at_ms: Date.now() + 60_000,
        handles: [
          {
            handle: 'sh_9',
            state: 'running',
            command_preview: 'npm test',
            cwd: '/tmp',
            started_at_ms: 1_760_000_000_000,
          },
        ],
      }),
      'utf8'
    );

    access.noteGesture();
    const loginRes = await access.login({
      homeserver: 'https://example.test',
      userId: '@demo:example.test',
      method: 'auto',
      loginToken: 'demo_token',
    });
    expect(loginRes.ok).toBe(true);
    if (!loginRes.ok) return;
    expect(loginRes.value.status?.shell.pending).toEqual({
      command_id: 'req-real-wire-1',
      command: 'ls -la',
      cwd: '/tmp',
      requester_id: '@demo:example.test',
      agent_name: 'calendar',
    });
    expect(loginRes.value.status?.shell.handles).toEqual([
      {
        handle: 'sh_9',
        command: 'npm test',
        state: 'running',
        started_at_ms: 1_760_000_000_000,
      },
    ]);

    access.noteShellApprovalGesture();
    const decided = await access.decideShell({ commandId: 'req-real-wire-1', approved: true });
    expect(decided.ok).toBe(true);
    if (decided.ok) {
      expect(decided.value.status?.shell.pending).toBeNull();
    }
    await access.stop();
  });

  it('honors explicit restricted Choose limits choices for a 2nd agent instead of unioning or OR-merging', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    setControllerFullAccess(userDataDir, 'ctrl-first', { agentName: 'General' });

    const initial = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 4,
        enabled: true,
        controllers: [
          {
            controller_key: 'ctrl-first',
            user_id: '@mindroom_general:mindroom.chat',
            device_id: 'DEV1',
            ed25519: 'key1',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['general'],
          },
        ],
        allowed_app_ids: ['primary-screen', 'com.apple.Safari'],
        file_roots: ['/Users/bas/Docs', '/Users/bas/Code'],
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
    const pairResult = await access.pair({
      controller: {
        userId: '@mindroom_writer:mindroom.chat',
        deviceId: 'DEV2',
        ed25519: 'key2',
      },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['writer'],
      code: 'PAIR-2',
    });
    expect(pairResult.ok).toBe(true);
    if (!pairResult.ok) return;

    const finishResult = await access.finishSetup({
      controllerKey: pairResult.value.controllerKey,
      agentName: 'writer',
      mode: 'restricted',
      allowedAppIds: ['com.apple.Safari'],
      fileRoots: ['/Users/bas/Code'],
      shellEnabled: false,
    });
    expect(finishResult.ok).toBe(true);
    expect(fake.currentStatus().config.allowed_app_ids).toEqual(['com.apple.Safari']);
    expect(fake.currentStatus().config.file_roots).toEqual(['/Users/bas/Code']);
    expect(fake.currentStatus().config.shell_enabled).toBe(false);
    expect(fake.calls.some((c) => c.action === 'grant_shell')).toBe(false);
    expect(fake.calls.some((c) => c.action === 'revoke_shell')).toBe(false);
  });

  it('revokes live shell auto-approve when a restricted controller is re-paired as ask-before-each-command, and never sends revoke_shell when shell.enabled is false', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    // (a) Restricted controller (NO saved Full Access consent) with live shell auto-approve
    const initialWithShell = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 3,
        enabled: true,
        controllers: [
          {
            controller_key: 'ctrl-restricted',
            user_id: '@agent:mindroom.chat',
            device_id: 'D1',
            ed25519: 'k1',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['code'],
          },
        ],
        allowed_app_ids: ['com.apple.Safari'],
        file_roots: [],
        shell_enabled: true,
      },
      bridge: { state: 'control', active_action: null, last_error: null },
      shell: {
        enabled: true,
        ready: true,
        pending: null,
        auto_approve_remaining_seconds: 900,
        auto_approve_until_revoked: false,
        active_request_id: null,
        handles: [],
        controllers: {
          'ctrl-restricted': {
            auto_approve_remaining_seconds: 900,
            auto_approve_until_revoked: false,
          },
        },
      },
    });
    const fake1 = createFakeBridgeClient(initialWithShell);
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const access1 = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath,
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake1.setOnStatus(onStatus);
        return fake1.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    await access1.start();
    fake1.calls.length = 0;

    // Re-pair in restricted mode as "Ask before each command" (no shellAutoApproveSeconds).
    access1.noteGesture();
    const repaired = await access1.finishSetup({
      controllerKey: 'ctrl-restricted',
      mode: 'restricted',
      allowedAppIds: ['com.apple.Safari'],
      fileRoots: [],
      shellEnabled: true,
    });
    expect(repaired.ok).toBe(true);
    expect(fake1.calls).toEqual([
      { action: 'revoke_control', parameters: { controller_key: 'ctrl-restricted' } },
      { action: 'revoke_shell', parameters: { controller_key: 'ctrl-restricted' } },
      { action: 'request_permission', parameters: { permission: 'accessibility' } },
    ]);

    // (b) GUI-only bridge with shell.enabled = false: updateLimits and finishSetup must NOT send revoke_shell.
    const initialGuiOnly = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 2,
        enabled: true,
        controllers: [
          {
            controller_key: 'ctrl-gui',
            user_id: '@agent:mindroom.chat',
            device_id: 'D2',
            ed25519: 'k2',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['gui'],
          },
        ],
        allowed_app_ids: ['com.apple.Safari'],
        file_roots: [],
        shell_enabled: false,
      },
      bridge: { state: 'observe_only', active_action: null, last_error: null },
    });
    const fake2 = createFakeBridgeClient(initialGuiOnly);
    const access2 = createDesktopAccess({
      platform: 'darwin',
      arch: 'arm64',
      userDataDir: makeTempDir(),
      storagePath: makeTempDir(),
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      createBridgeProcess: ({ onStatus }) => {
        fake2.setOnStatus(onStatus);
        return fake2.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    await access2.start();
    fake2.calls.length = 0;

    access2.noteGesture();
    const updated = await access2.updateLimits({
      controllerKey: 'ctrl-gui',
      mode: 'restricted',
      allowedAppIds: ['com.apple.Safari'],
      shellEnabled: false,
      controlDurationSeconds: 300,
    });
    expect(updated.ok).toBe(true);
    expect(fake2.calls).toEqual([
      {
        action: 'grant_control',
        parameters: { duration_seconds: 300, controller_key: 'ctrl-gui' },
      },
    ]);

    fake2.calls.length = 0;
    access2.noteGesture();
    const finishGui = await access2.finishSetup({
      controllerKey: 'ctrl-gui',
      mode: 'restricted',
      allowedAppIds: ['com.apple.Safari'],
      shellEnabled: false,
    });
    expect(finishGui.ok).toBe(true);
    expect(fake2.calls).toEqual([
      { action: 'revoke_control', parameters: { controller_key: 'ctrl-gui' } },
      { action: 'request_permission', parameters: { permission: 'accessibility' } },
    ]);
  });

  it('rolls back newly-added controllers on pair or abortSetup failure while preserving already-paired controllers', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    let now = 5_000_000;
    const fake = createFakeBridgeClient(makeBaseStatus());
    const panel = makeFakeBrowserWindow();
    electronMocks.BrowserWindow.mockImplementation(function () {
      return panel;
    });
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

    const mainFrame = { url: `${APP_ORIGIN}/`, origin: APP_ORIGIN };
    const mainWc = { mainFrame, isDestroyed: () => false } as unknown as Electron.WebContents;
    const mainEvent = { sender: mainWc, senderFrame: mainFrame };
    registerDesktopAccessHandlers(
      () => [mainWc],
      () => {
        const wc = access.shellApprovalContents();
        return wc ? [wc] : [];
      },
      access
    );
    const abortHandler = electronMocks.ipcHandlers.get('desktop:access-abort-setup');
    expect(abortHandler).toBeDefined();

    const pairReq = {
      controller: { userId: '@mindroom_writer:mindroom.chat', deviceId: 'W1', ed25519: 'kw1' },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['writer'],
      code: 'CODE-1',
    };

    // 1. Failed helper pair on a first-time controller rolls back via remove_controller.
    const originalRequest = fake.client.request;
    let failNextPair = true;
    fake.client.request = vi.fn(
      async (action: string, parameters: Record<string, unknown> = {}) => {
        if (action === 'pair' && failNextPair) {
          failNextPair = false;
          throw new DesktopHelperError('invalid_code', 'Pairing code expired.');
        }
        return originalRequest(action, parameters);
      }
    ) as DesktopBridgeClient['request'];

    access.noteGesture();
    const failedPair = await access.pair(pairReq);
    expect(failedPair).toEqual({
      ok: false,
      code: 'invalid_code',
      message: 'Pairing code expired.',
    });
    expect(fake.currentStatus().config.controllers).toEqual([]);

    // 2. Successful first-time pair followed by abortSetup removes the newly-added controller and clears setupAuth.
    access.noteGesture();
    const paired1 = await access.pair(pairReq);
    expect(paired1.ok).toBe(true);
    if (!paired1.ok) return;
    const key = paired1.value.controllerKey;
    expect(fake.currentStatus().config.controllers).toHaveLength(1);

    // Wrong controllerKey is refused and does not clear setupAuth.
    expect(await abortHandler?.(mainEvent, 'wrong-key')).toEqual({
      ok: false,
      code: 'NO_USER_GESTURE',
    });
    expect(fake.currentStatus().config.controllers).toHaveLength(1);

    // Correct controllerKey removes the newly-added controller and consumes setupAuth.
    const aborted1 = await abortHandler?.(mainEvent, key);
    expect(aborted1).toMatchObject({ ok: true });
    expect(fake.currentStatus().config.controllers).toEqual([]);
    expect(await access.abortSetup(key)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
    expect(await access.finishSetup({ controllerKey: key, mode: 'full' })).toEqual({
      ok: false,
      code: 'NO_USER_GESTURE',
    });

    // 3. Complete a full pairing so the controller already exists.
    access.noteGesture();
    const paired2 = await access.pair(pairReq);
    expect(paired2.ok).toBe(true);
    expect((await access.finishSetup({ controllerKey: key, mode: 'full' })).ok).toBe(true);
    expect(fake.currentStatus().config.controllers).toHaveLength(1);

    // Re-pair fails at helper pair RPC: existing controller MUST remain intact.
    fake.calls.length = 0;
    failNextPair = true;
    access.noteGesture();
    const failedRepair = await access.pair(pairReq);
    expect(failedRepair).toMatchObject({ ok: false, code: 'invalid_code' });
    expect(fake.currentStatus().config.controllers).toHaveLength(1);
    expect(fake.calls.some((c) => c.action === 'remove_controller')).toBe(false);

    // Re-pair succeeds at helper pair RPC, then abortSetup clears setupAuth WITHOUT removing existing controller.
    fake.calls.length = 0;
    access.noteGesture();
    expect((await access.pair(pairReq)).ok).toBe(true);
    const abortedRepair = await access.abortSetup(key);
    expect(abortedRepair).toMatchObject({ ok: true });
    expect(fake.currentStatus().config.controllers).toHaveLength(1);
    expect(fake.calls.some((c) => c.action === 'remove_controller')).toBe(false);
    expect(await access.finishSetup({ controllerKey: key, mode: 'full' })).toEqual({
      ok: false,
      code: 'NO_USER_GESTURE',
    });

    // Expired setupAuth cannot call abortSetup.
    access.noteGesture();
    expect((await access.pair(pairReq)).ok).toBe(true);
    now += 180_001;
    expect(await access.abortSetup(key)).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
  });

  it('skips grant_control on a shell-only bridge and restores or applies grant_shell cleanly', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    setControllerFullAccess(userDataDir, 'ctrl-shell-only', { agentName: 'ShellBot' });
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const shellOnlyStatus = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 4,
        enabled: true,
        controllers: [
          {
            controller_key: 'ctrl-shell-only',
            user_id: '@agent:mindroom.chat',
            device_id: 'DEV_SH',
            ed25519: 'ed_sh',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['shellbot'],
          },
        ],
        allowed_app_ids: [],
        file_roots: [],
        shell_enabled: true,
      },
      bridge: { state: 'stopped', active_action: null, last_error: null },
      shell: {
        enabled: true,
        ready: true,
        pending: null,
        auto_approve_remaining_seconds: 0,
        auto_approve_until_revoked: false,
        active_request_id: null,
        handles: [],
        controllers: {},
      },
    });
    const fake = createFakeBridgeClient(shellOnlyStatus);
    const baseRequest = fake.client.request;
    fake.client.request = vi.fn(async (action: string, params?: Record<string, unknown>) => {
      if (action === 'grant_control' && fake.currentStatus().config.allowed_app_ids.length === 0) {
        throw new DesktopHelperError('gui_unavailable', 'Desktop GUI is unavailable.');
      }
      return baseRequest(action, params);
    }) as typeof fake.client.request;

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

    // Boot auto-start restores grant_shell without calling grant_control.
    await access.start();
    expect(fake.calls.map((c) => c.action)).toEqual(['status', 'start', 'grant_shell']);
    expect(fake.calls[2]?.parameters).toEqual({
      until_revoked: true,
      controller_key: 'ctrl-shell-only',
    });

    // Restricted updateLimits on a shell-only bridge skips grant_control and applies grant_shell.
    fake.calls.length = 0;
    access.noteGesture();
    const updated = await access.updateLimits({
      controllerKey: 'ctrl-shell-only',
      mode: 'restricted',
      allowedAppIds: [],
      shellEnabled: true,
      controlDurationSeconds: 900,
      shellAutoApproveSeconds: 900,
    });
    expect(updated.ok).toBe(true);
    expect(fake.calls).toEqual([
      {
        action: 'grant_shell',
        parameters: { duration_seconds: 900, controller_key: 'ctrl-shell-only' },
      },
    ]);
  });

  it('respects explicit fileRoots in finishSetup even when mode is full and preserves them when omitted', async () => {
    const userDataDir = makeTempDir();
    const storagePath = makeTempDir();
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });

    const existing = makeBaseStatus({
      config: {
        state: 'ready',
        revision: 2,
        enabled: true,
        controllers: [
          {
            controller_key: 'ctrl-full-roots',
            user_id: '@agent:mindroom.chat',
            device_id: 'DEV_R',
            ed25519: 'ed_r',
            allowed_requester_ids: ['@bas:mindroom.chat'],
            allowed_agent_names: ['code'],
          },
        ],
        allowed_app_ids: ['primary-screen'],
        file_roots: ['/Users/demo/old'],
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
    const fake = createFakeBridgeClient(existing);
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

    // Explicit fileRoots replaces existing roots instead of unioning.
    access.noteGesture();
    const replaced = await access.finishSetup({
      controllerKey: 'ctrl-full-roots',
      agentName: 'Code',
      mode: 'full',
      fileRoots: ['/Users/demo/new'],
    });
    expect(replaced.ok).toBe(true);
    expect(fake.currentStatus().config.file_roots).toEqual(['/Users/demo/new']);

    // Omitting fileRoots preserves the existing roots.
    access.noteGesture();
    const preserved = await access.finishSetup({
      controllerKey: 'ctrl-full-roots',
      agentName: 'Code',
      mode: 'full',
    });
    expect(preserved.ok).toBe(true);
    expect(fake.currentStatus().config.file_roots).toEqual(['/Users/demo/new']);
  });

  const makeAutoPermHarness = (opts?: {
    platform?: NodeJS.Platform;
    isTestHelper?: boolean;
    allowedAppIds?: string[];
    axTrusted?: boolean;
    screenRecording?: 'granted' | 'missing';
    diskScreenStatus?: string;
    fullConsent?: boolean;
  }) => {
    let now = 1_000_000;
    let axTrusted = opts?.axTrusted ?? false;
    const openExternal = vi.fn(async () => undefined);
    const userDataDir = makeTempDir();
    if (opts?.fullConsent) {
      setControllerFullAccess(userDataDir, 'ctrl-demo', { agentName: 'Demo' });
    }
    electronMocks.Tray.mockImplementation(function () {
      return makeFakeTrayInstance();
    });
    const fake = createFakeBridgeClient(
      makeBaseStatus({
        config: {
          state: 'ready',
          revision: 2,
          enabled: true,
          controllers: [
            {
              controller_key: 'ctrl-demo',
              user_id: '@demo_agent:example.test',
              device_id: 'DEMO1',
              ed25519: 'demo-key',
              allowed_requester_ids: ['@demo_user:example.test'],
              allowed_agent_names: ['demo'],
            },
          ],
          allowed_app_ids: opts?.allowedAppIds ?? ['primary-screen'],
          file_roots: [],
          shell_enabled: true,
        },
        bridge: { state: 'observe_only', active_action: null, last_error: null },
        permissions: {
          accessibility: axTrusted ? 'granted' : 'missing',
          screen_recording: opts?.screenRecording ?? 'missing',
          gui_permissions_ready: axTrusted && opts?.screenRecording === 'granted',
        },
      })
    );
    const access = createDesktopAccess({
      platform: opts?.platform ?? 'darwin',
      arch: 'arm64',
      userDataDir,
      storagePath: makeTempDir(),
      preload: '/app/preload.cjs',
      isQuitting: () => false,
      isTestHelper: opts?.isTestHelper ?? false,
      resolution: { availability: 'available', binaryPath: '/fake/helper' },
      now: () => now,
      isTrustedAccessibilityClient: () => axTrusted,
      getScreenMediaAccessStatus: () => opts?.diskScreenStatus ?? 'not-determined',
      openExternal,
      createBridgeProcess: ({ onStatus }) => {
        fake.setOnStatus(onStatus);
        return fake.client;
      },
      onStatusChange: vi.fn(),
      onOpenMainWindow: vi.fn(),
      onOpenSettings: vi.fn(),
    });
    return {
      access,
      fake,
      openExternal,
      setNow: (v: number) => (now = v),
      setAx: (v: boolean) => (axTrusted = v),
      permCalls: () => fake.calls.filter((c) => c.action === 'request_permission'),
    };
  };

  it('stages Accessibility then auto-advances one-shot to Screen Recording on finishSetup, and skips granted permissions', async () => {
    const h = makeAutoPermHarness({ axTrusted: false, screenRecording: 'missing' });
    h.access.noteGesture();
    expect((await h.access.finishSetup({ controllerKey: 'ctrl-demo', mode: 'full' })).ok).toBe(
      true
    );
    expect(h.permCalls()).toEqual([
      { action: 'request_permission', parameters: { permission: 'accessibility' } },
    ]);
    expect(h.openExternal).toHaveBeenCalledTimes(1);
    expect(h.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    );

    // Still missing -> does not advance; granted within 180 s -> advances once to Screen Recording.
    await h.access.getStatus();
    expect(h.permCalls()).toHaveLength(1);
    h.setAx(true);
    h.setNow(1_005_000);
    await h.access.getStatus();
    await vi.waitFor(() => expect(h.permCalls()).toHaveLength(2));
    expect(h.permCalls()[1]?.parameters).toEqual({ permission: 'screen_recording' });
    expect(h.openExternal).toHaveBeenLastCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    );
    // Automatic Screen Recording leaves relaunchRequired false if dismissed; manual click sets it true.
    const snap = await h.access.getStatus();
    expect(snap.ok && snap.value.relaunchRequired).toBe(false);
    // Strictly one-shot across further polls and status pushes.
    h.fake.pushStatus({
      permissions: {
        accessibility: 'granted',
        screen_recording: 'missing',
        gui_permissions_ready: false,
      },
    });
    await Promise.resolve();
    expect(h.permCalls()).toHaveLength(2);

    // Accessibility already granted -> straight to Screen Recording without trapping on Relaunch; manual click still sets relaunchRequired.
    const h2 = makeAutoPermHarness({ axTrusted: true, screenRecording: 'missing' });
    h2.access.noteGesture();
    const res2 = await h2.access.finishSetup({ controllerKey: 'ctrl-demo', mode: 'full' });
    expect(res2.ok && res2.value.relaunchRequired).toBe(false);
    expect(h2.permCalls()).toEqual([
      { action: 'request_permission', parameters: { permission: 'screen_recording' } },
    ]);
    h2.access.noteGesture();
    const manualRes = await h2.access.requestPermission('screen_recording');
    expect(manualRes.ok && manualRes.value.relaunchRequired).toBe(true);

    // Already granted on disk (relaunchRequired: true) -> skip reopening Screen Recording Settings.
    const hRelaunch = makeAutoPermHarness({
      axTrusted: true,
      screenRecording: 'missing',
      diskScreenStatus: 'granted',
    });
    hRelaunch.access.noteGesture();
    const resRelaunch = await hRelaunch.access.finishSetup({
      controllerKey: 'ctrl-demo',
      mode: 'full',
    });
    expect(resRelaunch.ok && resRelaunch.value.relaunchRequired).toBe(true);
    expect(hRelaunch.permCalls()).toEqual([]);
    expect(hRelaunch.openExternal).not.toHaveBeenCalled();

    const h3 = makeAutoPermHarness({ axTrusted: true, screenRecording: 'granted' });
    h3.access.noteGesture();
    expect((await h3.access.finishSetup({ controllerKey: 'ctrl-demo', mode: 'full' })).ok).toBe(
      true
    );
    expect(h3.permCalls()).toEqual([]);
    expect(h3.openExternal).not.toHaveBeenCalled();
  });

  it('handles updateLimits, helper-pushed auto-advance, TTL expiry, cancellations, errors, and platform/testHelper guards', async () => {
    // Shell-only finishSetup skips permissions; enabling GUI apps in updateLimits stages + auto-advances on helper push.
    const h = makeAutoPermHarness({ allowedAppIds: [] });
    h.access.noteGesture();
    expect(
      (
        await h.access.finishSetup({
          controllerKey: 'ctrl-demo',
          mode: 'restricted',
          allowedAppIds: [],
        })
      ).ok
    ).toBe(true);
    expect(h.permCalls()).toEqual([]);

    h.access.noteGesture();
    expect(
      (
        await h.access.updateLimits({
          controllerKey: 'ctrl-demo',
          mode: 'restricted',
          allowedAppIds: ['com.example.Browser'],
        })
      ).ok
    ).toBe(true);
    expect(h.permCalls().map((c) => c.parameters)).toEqual([{ permission: 'accessibility' }]);

    h.setAx(true);
    h.fake.pushStatus({
      permissions: {
        accessibility: 'granted',
        screen_recording: 'missing',
        gui_permissions_ready: false,
      },
    });
    await vi.waitFor(() => expect(h.permCalls()).toHaveLength(2));
    expect(h.permCalls()[1]?.parameters).toEqual({ permission: 'screen_recording' });

    // Folder-only save on an already-full controller neither prompts nor arms auto-advance; upgrading restricted -> full does.
    const fullH = makeAutoPermHarness({ fullConsent: true });
    fullH.access.noteGesture();
    expect(
      (
        await fullH.access.updateLimits({
          controllerKey: 'ctrl-demo',
          mode: 'full',
          fileRoots: ['/Users/demo/Projects'],
        })
      ).ok
    ).toBe(true);
    expect(fullH.permCalls()).toEqual([]);
    expect(fullH.openExternal).not.toHaveBeenCalled();
    fullH.setAx(true);
    await fullH.access.getStatus();
    await Promise.resolve();
    expect(fullH.permCalls()).toEqual([]);

    const upgradeH = makeAutoPermHarness({ allowedAppIds: ['com.example.Browser'] });
    upgradeH.access.noteGesture();
    expect(
      (await upgradeH.access.updateLimits({ controllerKey: 'ctrl-demo', mode: 'full' })).ok
    ).toBe(true);
    expect(upgradeH.permCalls().map((c) => c.parameters)).toEqual([
      { permission: 'accessibility' },
    ]);

    // Expiry (180 s), stop(), revokeAll(), removeController(), and clearing GUI apps all cancel auto-advance.
    for (const cancel of ['expire', 'stop', 'revokeAll', 'removeController', 'clearGui'] as const) {
      const c = makeAutoPermHarness();
      c.access.noteGesture();
      expect((await c.access.finishSetup({ controllerKey: 'ctrl-demo', mode: 'full' })).ok).toBe(
        true
      );
      if (cancel === 'expire') c.setNow(1_180_000);
      else if (cancel === 'stop') await c.access.stop();
      else if (cancel === 'revokeAll') {
        c.access.noteGesture();
        await c.access.revokeAll();
      } else if (cancel === 'removeController') {
        c.access.noteGesture();
        await c.access.removeController('ctrl-demo');
      } else {
        c.access.noteGesture();
        await c.access.updateLimits({
          controllerKey: 'ctrl-demo',
          mode: 'restricted',
          allowedAppIds: [],
        });
      }
      c.setAx(true);
      await c.access.getStatus();
      await Promise.resolve();
      expect(c.permCalls()).toHaveLength(1);
    }

    // Permission prompt failure never fails setup and does not open System Settings or arm auto-advance.
    const errH = makeAutoPermHarness();
    const baseImpl = vi.mocked(errH.fake.client.request).getMockImplementation()!;
    vi.mocked(errH.fake.client.request).mockImplementation(async (action, params, timeoutMs) => {
      if (action === 'request_permission') {
        throw new DesktopHelperError('permission_failed', 'Prompt unavailable.');
      }
      return baseImpl(action, params, timeoutMs);
    });
    errH.access.noteGesture();
    expect((await errH.access.finishSetup({ controllerKey: 'ctrl-demo', mode: 'full' })).ok).toBe(
      true
    );
    expect(errH.openExternal).not.toHaveBeenCalled();

    // Non-darwin and isTestHelper never auto-request permissions.
    for (const guard of [{ platform: 'linux' as const }, { isTestHelper: true }]) {
      const g = makeAutoPermHarness(guard);
      g.access.noteGesture();
      expect((await g.access.finishSetup({ controllerKey: 'ctrl-demo', mode: 'full' })).ok).toBe(
        true
      );
      expect(g.permCalls()).toEqual([]);
      expect(g.openExternal).not.toHaveBeenCalled();
    }
  });
});
