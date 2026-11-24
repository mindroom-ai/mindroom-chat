import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, shell, systemPreferences } from 'electron';
import type {
  DesktopAccessFinishSetupRequest,
  DesktopAccessHelperStatus,
  DesktopAccessLoginRequest,
  DesktopAccessPairRequest,
  DesktopAccessPairResult,
  DesktopAccessPermissionState,
  DesktopAccessSnapshot,
  DesktopAccessUpdateLimitsRequest,
  DesktopResult,
  DesktopShellDecisionRequest,
  InstalledMacApp,
} from '../../src/app/lib/desktopBridge';
import {
  MINDROOM_APP_IDS,
  normalizeInstalledApps,
  scanInstalledMacApps,
} from './desktopAccessApps';
import {
  clearAllConsent,
  clearControllerConsent,
  loadConsent,
  setControllerFullAccess,
  setManagedLoginItem,
} from './desktopAccessConsent';
import { registerDesktopAccessHandlers, type DesktopAccessOperations } from './desktopAccessIpc';
import {
  applyFinishSetup,
  applyUpdateLimits,
  hasLocalCapability,
  isBridgeRunning,
  reapplyConsentedGrants,
  type DesktopBridgeClient,
  type PolicyContext,
} from './desktopAccessPolicy';
import { createDesktopAccessTray } from './desktopAccessTray';
import {
  DesktopBridgeProcess,
  DesktopHelperError,
  type DesktopHelperResolution,
} from './desktopBridgeProcess';
import { createShellApprovalWindow } from './shellApprovalWindow';

export { MINDROOM_APP_IDS, registerDesktopAccessHandlers };
export type { DesktopBridgeClient };

const GESTURE_WINDOW_MS = 10_000;
const SETUP_AUTH_TTL_MS = 180_000;
const LOGIN_TIMEOUT_MS = 120_000;
const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
const SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/**
 * What one consent click still authorizes, in the order a setup runs. It only moves forward:
 * a sign-in or a pairing, then a pairing, then finishing the setup of the controller that paired.
 */
type SetupAuth = { expiresAt: number } & (
  { stage: 'login_or_pair' | 'pair_only' } | { stage: 'finish'; controllerKey: string }
);

export type DesktopAccessOptions = {
  platform?: NodeJS.Platform;
  arch?: string;
  userDataDir: string;
  configPath?: string;
  storagePath?: string;
  preload: string;
  isQuitting: () => boolean;
  getMainWindow?: () => Electron.BrowserWindow | undefined;
  resolution: DesktopHelperResolution;
  isTestHelper?: boolean;
  enableLoginItem?: boolean;
  now?: () => number;
  isTrustedAccessibilityClient?: () => boolean;
  getScreenMediaAccessStatus?: () => string;
  openExternal?: (url: string) => Promise<void>;
  readInstalledApps?: () => Promise<InstalledMacApp[]>;
  createBridgeProcess?: (callbacks: {
    onStatus: (status: DesktopAccessHelperStatus) => void;
    onExit: (info: {
      code: number | null;
      signal: NodeJS.Signals | null;
      unexpected: boolean;
    }) => void;
  }) => DesktopBridgeClient;
  onStatusChange: () => void;
  onOpenMainWindow: () => void;
  onOpenSettings: () => void;
};

export type DesktopAccessHandle = DesktopAccessOperations & {
  isAvailable(): boolean;
  noteGesture(): void;
  noteShellApprovalGesture(): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  shellApprovalContents(): Electron.WebContents | undefined;
};

const toError = <T>(error: unknown): DesktopResult<T> =>
  error instanceof DesktopHelperError
    ? { ok: false, code: error.code, message: error.message }
    : {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };

export const createDesktopAccess = (options: DesktopAccessOptions): DesktopAccessHandle => {
  const platform = options.platform ?? process.platform;
  const storagePath = options.storagePath ?? path.join(os.homedir(), '.mindroom', 'mindroom_data');
  const configPath = options.configPath ?? path.join(os.homedir(), '.mindroom', 'config.yaml');
  const isTestHelper = Boolean(options.isTestHelper);
  const enableLoginItem = options.enableLoginItem ?? false;
  const now = options.now ?? Date.now;
  const checkAx =
    options.isTrustedAccessibilityClient ??
    (() => systemPreferences.isTrustedAccessibilityClient(false));
  const checkScreen =
    options.getScreenMediaAccessStatus ?? (() => systemPreferences.getMediaAccessStatus('screen'));
  const openExternal = options.openExternal ?? ((url) => shell.openExternal(url));
  const readApps =
    options.readInstalledApps ??
    (() => (platform === 'darwin' ? scanInstalledMacApps() : Promise.resolve([])));

  let gestureAt = -Infinity;
  let shellGestureAt = -Infinity;
  let setupAuth: SetupAuth | undefined;
  let helperError: string | null = null;
  let latestStatus: DesktopAccessHelperStatus | null = null;
  let screenRecordingRequested = false;

  const noteShellApprovalGesture = (): void => {
    shellGestureAt = now();
  };

  const shellWindow = createShellApprovalWindow({
    preload: options.preload,
    isQuitting: options.isQuitting,
    onGesture: noteShellApprovalGesture,
  });
  const tray = createDesktopAccessTray(
    {
      onRevokeAll: () => void revokeAllInternal().catch(() => undefined),
      onOpenMainWindow: options.onOpenMainWindow,
      onOpenSettings: options.onOpenSettings,
    },
    { enabled: platform === 'darwin' }
  );

  const readPermissions = (raw: DesktopAccessHelperStatus | null) => {
    const useDarwinLive = platform === 'darwin' && !isTestHelper;
    let accessibility: DesktopAccessPermissionState = raw?.permissions.accessibility ?? 'unknown';
    let screenRecording: DesktopAccessPermissionState =
      raw?.permissions.screen_recording ?? 'unknown';
    let diskScreenGranted = false;
    if (useDarwinLive) {
      try {
        accessibility = checkAx() ? 'granted' : 'missing';
      } catch {
        // Keep helper permission state if native lookup fails.
      }
      try {
        diskScreenGranted = checkScreen() === 'granted';
        if (raw === null) screenRecording = diskScreenGranted ? 'granted' : 'missing';
      } catch {
        // Ignore screen media check failure.
      }
    }
    if (screenRecording === 'granted') screenRecordingRequested = false;
    const relaunchRequired =
      screenRecording !== 'granted' &&
      (screenRecordingRequested || (useDarwinLive && raw !== null && diskScreenGranted));
    return {
      permissions: {
        accessibility,
        screen_recording: screenRecording,
        gui_permissions_ready: accessibility === 'granted' && screenRecording === 'granted',
      },
      relaunchRequired,
    };
  };

  const buildSnapshot = (): DesktopAccessSnapshot => {
    const consent = loadConsent(options.userDataDir);
    const { permissions, relaunchRequired } = readPermissions(latestStatus);
    return {
      availability: options.resolution.availability,
      helperRunning: Boolean(bridge?.isRunning()),
      helperError,
      status: latestStatus ? { ...latestStatus, permissions } : null,
      consent: consent.controllers,
      permissions,
      relaunchRequired,
    };
  };

  const syncUi = (): DesktopAccessSnapshot => {
    const snapshot = buildSnapshot();
    tray.sync(snapshot);
    shellWindow.syncPending(snapshot.status?.shell.pending ?? null);
    options.onStatusChange();
    return snapshot;
  };

  const bridgeCallbacks = {
    onStatus: (next: DesktopAccessHelperStatus) => {
      latestStatus = next;
      helperError = null;
      syncUi();
    },
    onExit: ({
      unexpected,
    }: {
      code: number | null;
      signal: NodeJS.Signals | null;
      unexpected: boolean;
    }) => {
      if (!unexpected) return;
      helperError = 'MindRoom Desktop Helper exited unexpectedly.';
      syncUi();
    },
  };

  const bridge: DesktopBridgeClient | undefined =
    options.resolution.availability === 'available'
      ? (options.createBridgeProcess?.(bridgeCallbacks) ??
        new DesktopBridgeProcess({
          binaryPath: options.resolution.binaryPath,
          configPath,
          storagePath,
          ...bridgeCallbacks,
        }))
      : undefined;

  const consumeGesture = (): boolean => {
    if (now() - gestureAt > GESTURE_WINDOW_MS) return false;
    gestureAt = -Infinity;
    return true;
  };

  const consumeDecisionGesture = (): boolean => {
    if (now() - shellGestureAt <= GESTURE_WINDOW_MS) {
      shellGestureAt = -Infinity;
      return true;
    }
    return consumeGesture();
  };

  const activeSetupAuth = (): SetupAuth | undefined => {
    if (setupAuth && now() > setupAuth.expiresAt) setupAuth = undefined;
    return setupAuth;
  };

  /** A sign-in rides on a fresh click or on a setup that has not signed in yet, and spends it. */
  const authorizeLogin = (): boolean => {
    const staged = activeSetupAuth()?.stage === 'login_or_pair';
    if (!consumeGesture() && !staged) return false;
    // Spent here, not on success, so a sign-in that fails leaves nothing to try again on.
    setupAuth = undefined;
    return true;
  };

  const authorizePair = (): boolean => {
    if (consumeGesture()) return true;
    const stage = activeSetupAuth()?.stage;
    return stage === 'login_or_pair' || stage === 'pair_only';
  };

  const authorizeFinishSetup = (controllerKey: string): boolean => {
    if (consumeGesture()) return true;
    const auth = activeSetupAuth();
    return auth?.stage === 'finish' && auth.controllerKey === controllerKey;
  };

  const requireBridge = async (): Promise<DesktopBridgeClient> => {
    if (!bridge) throw new DesktopHelperError('UNAVAILABLE', 'Desktop helper is not available.');
    if (!bridge.isRunning()) {
      await bridge.start();
      helperError = null;
    }
    return bridge;
  };

  const runBridge = async <T>(
    authorize: () => boolean,
    fn: (client: DesktopBridgeClient) => Promise<T>
  ): Promise<DesktopResult<T>> => {
    if (!authorize()) return { ok: false, code: 'NO_USER_GESTURE' };
    try {
      return { ok: true, value: await fn(await requireBridge()) };
    } catch (error) {
      return toError(error);
    }
  };

  const fetchStatus = async (client: DesktopBridgeClient): Promise<DesktopAccessHelperStatus> => {
    const res = await client.request<{ status?: DesktopAccessHelperStatus }>('status', {});
    const next = res.status ?? client.lastStatus();
    if (!next) throw new DesktopHelperError('invalid_status', 'Helper returned no status.');
    latestStatus = next;
    return next;
  };

  const restoreLoginItemIfUnused = (wasManaged: boolean): void => {
    if (!enableLoginItem || platform !== 'darwin' || !wasManaged) return;
    if (Object.keys(loadConsent(options.userDataDir).controllers).length > 0) return;
    try {
      app.setLoginItemSettings({ openAtLogin: false });
    } catch {
      // Ignore login item restoration errors.
    }
    setManagedLoginItem(options.userDataDir, false);
  };

  const saveFullConsent = (controllerKey: string, agentName?: string): void => {
    const current = loadConsent(options.userDataDir);
    let shouldEnableLoginItem = false;
    if (enableLoginItem && platform === 'darwin' && !current.managedLoginItem) {
      try {
        shouldEnableLoginItem = !app.getLoginItemSettings().openAtLogin;
      } catch {
        shouldEnableLoginItem = false;
      }
    }
    setControllerFullAccess(options.userDataDir, controllerKey, {
      agentName,
      managedLoginItem: current.managedLoginItem,
    });
    if (!shouldEnableLoginItem) return;
    try {
      app.setLoginItemSettings({ openAtLogin: true });
    } catch {
      return;
    }
    try {
      setManagedLoginItem(options.userDataDir, true);
    } catch (error) {
      try {
        app.setLoginItemSettings({ openAtLogin: false });
      } catch {
        // Ignore rollback errors if macOS rejects the login item update.
      }
      throw error;
    }
  };

  const clearConsent = (controllerKey: string): void => {
    const wasManaged = loadConsent(options.userDataDir).managedLoginItem;
    clearControllerConsent(options.userDataDir, controllerKey);
    restoreLoginItemIfUnused(wasManaged);
  };

  const policyContext = (client: DesktopBridgeClient): PolicyContext => ({
    client,
    getStatus: () => fetchStatus(client),
    getLatest: () => latestStatus,
    loadConsent: () => loadConsent(options.userDataDir),
    saveFullConsent,
    clearConsent,
  });

  const hasSavedState = (): boolean =>
    Object.keys(loadConsent(options.userDataDir).controllers).length > 0 ||
    fs.existsSync(path.join(storagePath, 'desktop_bridge', 'native_config.json')) ||
    fs.existsSync(path.join(storagePath, 'desktop_bridge', 'matrix_session.json'));

  const revokeAllInternal = async (): Promise<DesktopResult<DesktopAccessSnapshot>> => {
    setupAuth = undefined;
    const hadNativeConfig = fs.existsSync(
      path.join(storagePath, 'desktop_bridge', 'native_config.json')
    );
    const { previous } = clearAllConsent(options.userDataDir);
    restoreLoginItemIfUnused(previous.managedLoginItem);
    let removalFailure: unknown;
    if (bridge) {
      if (!bridge.isRunning() && hadNativeConfig) {
        try {
          await bridge.start();
        } catch (error) {
          removalFailure ??= error;
        }
      }
      if (bridge.isRunning()) {
        for (const action of ['revoke_control', 'revoke_shell', 'stop'] as const) {
          const res = await bridge
            .request<{ status?: DesktopAccessHelperStatus }>(action, {})
            .catch(() => undefined);
          if (res?.status) latestStatus = res.status;
        }
        let current: DesktopAccessHelperStatus | null =
          latestStatus ?? (await fetchStatus(bridge).catch(() => null));
        const attempted = new Set<string>();
        while (current) {
          const nextController = current.config.controllers.find(
            (ctrl) => !attempted.has(ctrl.controller_key)
          );
          if (!nextController) break;
          attempted.add(nextController.controller_key);
          try {
            const res = await bridge.request<{ status?: DesktopAccessHelperStatus }>(
              'remove_controller',
              {
                expected_revision: current.config.revision,
                controller_key: nextController.controller_key,
              }
            );
            if (res.status) {
              latestStatus = res.status;
              current = res.status;
            } else {
              current = await fetchStatus(bridge).catch(() => null);
            }
          } catch (error) {
            removalFailure ??= error;
            current = await fetchStatus(bridge).catch(() => null);
          }
        }
        if (removalFailure !== undefined || (latestStatus?.config.controllers.length ?? 0) > 0) {
          await fetchStatus(bridge).catch(() => undefined);
        }
      }
    }
    const snapshot = syncUi();
    if ((latestStatus?.config.controllers.length ?? 0) > 0 || removalFailure !== undefined) {
      return removalFailure !== undefined
        ? toError(removalFailure)
        : {
            ok: false,
            code: 'REVOKE_INCOMPLETE',
            message: 'Some paired controllers could not be removed from this Mac.',
          };
    }
    return { ok: true, value: snapshot };
  };

  return {
    isAvailable: () => options.resolution.availability === 'available',
    noteGesture: () => {
      gestureAt = now();
    },
    noteShellApprovalGesture,
    shellApprovalContents: () => shellWindow.contents(),

    async start(): Promise<void> {
      if (!bridge || !hasSavedState()) {
        tray.sync(buildSnapshot());
        return;
      }
      try {
        await bridge.start();
        const status = await fetchStatus(bridge);
        if (
          status.config.enabled &&
          status.config.controllers.length > 0 &&
          hasLocalCapability(status.config)
        ) {
          if (status.bridge.state === 'stopped') await bridge.request('start', {});
          await reapplyConsentedGrants(
            bridge,
            latestStatus ?? status,
            loadConsent(options.userDataDir)
          );
        }
      } catch (error) {
        helperError = error instanceof Error ? error.message : String(error);
      }
      syncUi();
    },

    async stop(): Promise<void> {
      setupAuth = undefined;
      tray.destroy();
      shellWindow.destroy();
      await bridge?.stop().catch(() => undefined);
    },

    async getStatus(): Promise<DesktopResult<DesktopAccessSnapshot>> {
      if (bridge && !bridge.isRunning() && hasSavedState()) {
        try {
          await bridge.start();
          await fetchStatus(bridge);
        } catch (error) {
          helperError = error instanceof Error ? error.message : String(error);
        }
      }
      return { ok: true, value: buildSnapshot() };
    },

    // The renderer calls this on the consent click, before it waits for the agent's setup offer,
    // which may take longer than a click counts for.
    beginSetup(): Promise<DesktopResult<void>> {
      if (!consumeGesture()) return Promise.resolve({ ok: false, code: 'NO_USER_GESTURE' });
      setupAuth = { expiresAt: now() + SETUP_AUTH_TTL_MS, stage: 'login_or_pair' };
      return Promise.resolve({ ok: true, value: undefined });
    },

    login: (req: DesktopAccessLoginRequest) =>
      runBridge(authorizeLogin, async (client) => {
        if (req.replace && isBridgeRunning(latestStatus)) await client.request('stop', {});
        await client.request(
          'login',
          {
            homeserver: req.homeserver,
            method: req.method,
            ...(req.userId ? { user_id: req.userId } : {}),
            ...(req.loginToken ? { login_token: req.loginToken } : {}),
            ...(req.replace !== undefined ? { replace: req.replace } : {}),
            ...(req.cloudflareAccess !== undefined
              ? { cloudflare_access: req.cloudflareAccess }
              : {}),
          },
          LOGIN_TIMEOUT_MS
        );
        setupAuth = { expiresAt: now() + SETUP_AUTH_TTL_MS, stage: 'pair_only' };
        return syncUi();
      }),

    pair: (req: DesktopAccessPairRequest) =>
      runBridge(authorizePair, async (client): Promise<DesktopAccessPairResult> => {
        const current = latestStatus ?? (await fetchStatus(client));
        const upsertRes = await client.request<{ status?: DesktopAccessHelperStatus }>(
          'upsert_controller',
          {
            expected_revision: current.config.revision,
            controller: {
              user_id: req.controller.userId,
              device_id: req.controller.deviceId,
              ed25519: req.controller.ed25519,
            },
            allowed_requester_ids: req.allowedRequesterIds,
            allowed_agent_names: req.allowedAgentNames,
          }
        );
        const after = upsertRes.status ?? latestStatus ?? (await fetchStatus(client));
        const matched = after.config.controllers.find(
          (c) =>
            c.user_id === req.controller.userId &&
            c.device_id === req.controller.deviceId &&
            c.ed25519 === req.controller.ed25519
        );
        if (!matched)
          throw new DesktopHelperError('controller_missing', 'Upserted controller not found.');
        const res = await client.request<{
          device_id?: string;
          device_ed25519?: string;
          verification?: string;
          confirmation_command?: string;
          agent_confirmation_command?: string;
        }>('pair', {
          code: req.code,
          expected_revision: after.config.revision,
          controller_key: matched.controller_key,
          ...(req.cloudflareAccess !== undefined
            ? { cloudflare_access: req.cloudflareAccess }
            : {}),
        });
        setupAuth = {
          expiresAt: now() + SETUP_AUTH_TTL_MS,
          stage: 'finish',
          controllerKey: matched.controller_key,
        };
        return {
          controllerKey: matched.controller_key,
          deviceId: res.device_id ?? after.pairing.device_id ?? '',
          deviceEd25519: res.device_ed25519 ?? '',
          verification: res.verification ?? '',
          confirmationCommand: res.confirmation_command ?? '',
          ...(res.agent_confirmation_command
            ? { agentConfirmationCommand: res.agent_confirmation_command }
            : {}),
          snapshot: syncUi(),
        };
      }),

    finishSetup: (req: DesktopAccessFinishSetupRequest) =>
      runBridge(
        () => authorizeFinishSetup(req.controllerKey),
        async (client) => {
          await applyFinishSetup(policyContext(client), req);
          setupAuth = undefined;
          return syncUi();
        }
      ),

    updateLimits: (req: DesktopAccessUpdateLimitsRequest) =>
      runBridge(consumeGesture, async (client) => {
        await applyUpdateLimits(policyContext(client), req);
        return syncUi();
      }),

    removeController: (controllerKey: string) =>
      runBridge(consumeGesture, async (client) => {
        clearConsent(controllerKey);
        if (isBridgeRunning(latestStatus)) {
          await client
            .request('revoke_control', { controller_key: controllerKey })
            .catch(() => undefined);
          await client
            .request('revoke_shell', { controller_key: controllerKey })
            .catch(() => undefined);
        }
        const current = latestStatus ?? (await fetchStatus(client));
        await client.request('remove_controller', {
          expected_revision: current.config.revision,
          controller_key: controllerKey,
        });
        return syncUi();
      }),

    revokeAll: async () =>
      consumeGesture() ? revokeAllInternal() : { ok: false, code: 'NO_USER_GESTURE' },

    requestPermission: (permission: 'accessibility' | 'screen_recording') =>
      runBridge(consumeGesture, async (client) => {
        if (
          permission === 'screen_recording' &&
          readPermissions(latestStatus).permissions.screen_recording !== 'granted'
        ) {
          screenRecordingRequested = true;
        }
        await client.request('request_permission', { permission });
        if (platform === 'darwin' && !isTestHelper) {
          const url =
            permission === 'accessibility'
              ? ACCESSIBILITY_SETTINGS_URL
              : SCREEN_RECORDING_SETTINGS_URL;
          await openExternal(url).catch(() => undefined);
        }
        return syncUi();
      }),

    async relaunch(): Promise<DesktopResult<void>> {
      if (!consumeGesture()) return { ok: false, code: 'NO_USER_GESTURE' };
      await this.stop();
      app.relaunch();
      app.exit(0);
      return { ok: true, value: undefined };
    },

    async listInstalledApps(): Promise<DesktopResult<InstalledMacApp[]>> {
      try {
        return { ok: true, value: normalizeInstalledApps(await readApps()) };
      } catch (error) {
        return toError(error);
      }
    },

    async pickFolder(): Promise<DesktopResult<string | null>> {
      if (!consumeGesture()) return { ok: false, code: 'NO_USER_GESTURE' };
      try {
        const win = options.getMainWindow?.();
        const result = win
          ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory'] });
        return { ok: true, value: result.canceled ? null : (result.filePaths[0] ?? null) };
      } catch (error) {
        return toError(error);
      }
    },

    decideShell: (req: DesktopShellDecisionRequest) =>
      runBridge(consumeDecisionGesture, async (client) => {
        await client.request('decide_shell', {
          command_id: req.commandId,
          approved: req.approved,
          auto_approve_seconds: req.autoApproveSeconds ?? 0,
          ...(req.autoApproveUntilRevoked ? { auto_approve_until_revoked: true } : {}),
        });
        return syncUi();
      }),

    killShellHandle: (handleId: string) =>
      runBridge(consumeGesture, async (client) => {
        await client.request('kill_shell_handle', { handle: handleId });
        return syncUi();
      }),
  };
};
