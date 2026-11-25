import type {
  DesktopAccessFinishSetupRequest,
  DesktopAccessHelperStatus,
  DesktopAccessUpdateLimitsRequest,
} from '../../src/app/lib/desktopBridge';
import { isControllerFullAccess, type DesktopAccessConsentStore } from './desktopAccessConsent';
import { DesktopHelperError } from './desktopBridgeProcess';

export type DesktopBridgeClient = {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  lastStatus(): DesktopAccessHelperStatus | null;
  request<T = Record<string, unknown>>(
    action: string,
    parameters?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<T>;
};

export type PolicyContext = {
  client: DesktopBridgeClient;
  getStatus: () => Promise<DesktopAccessHelperStatus>;
  getLatest: () => DesktopAccessHelperStatus | null;
  loadConsent: () => DesktopAccessConsentStore;
  saveFullConsent: (controllerKey: string, agentName?: string) => void;
  clearConsent: (controllerKey: string) => void;
};

export const isBridgeRunning = (status: DesktopAccessHelperStatus | null): boolean =>
  status?.bridge.state === 'observe_only' || status?.bridge.state === 'control';

export const hasLocalCapability = (config: DesktopAccessHelperStatus['config']): boolean =>
  config.allowed_app_ids.length > 0 || config.file_roots.length > 0 || config.shell_enabled;

const unique = (items: readonly string[]): string[] => [...new Set(items)];

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const sA = new Set(a);
  const sB = new Set(b);
  return sA.size === sB.size && [...sA].every((item) => sB.has(item));
};

export const grantFullForController = async (
  client: DesktopBridgeClient,
  controllerKey: string
): Promise<void> => {
  await client.request('grant_control', {
    until_revoked: true,
    scope: 'computer',
    controller_key: controllerKey,
  });
  await client.request('grant_shell', { until_revoked: true, controller_key: controllerKey });
};

export const reapplyConsentedGrants = async (
  client: DesktopBridgeClient,
  status: DesktopAccessHelperStatus,
  consent: DesktopAccessConsentStore
): Promise<void> => {
  const hasGuiApps = status.config.allowed_app_ids.length > 0;
  for (const ctrl of status.config.controllers) {
    if (isControllerFullAccess(consent, ctrl.controller_key)) {
      if (hasGuiApps) {
        await client.request('grant_control', {
          until_revoked: true,
          scope: 'computer',
          controller_key: ctrl.controller_key,
        });
      }
      if (status.shell.enabled) {
        await client.request('grant_shell', {
          until_revoked: true,
          controller_key: ctrl.controller_key,
        });
      }
    }
  }
};

type BoundedGrantOpts = {
  hasGuiApps?: boolean;
  controlDurationSeconds?: number;
  revokeControl?: boolean;
  shellAutoApproveSeconds?: number;
  shellAutoApproveUntilRevoked?: boolean;
  revokeShell?: boolean;
};

export const applyBoundedGrants = async (
  client: DesktopBridgeClient,
  controllerKey: string,
  opts: BoundedGrantOpts
): Promise<void> => {
  if (opts.hasGuiApps !== false) {
    if (opts.revokeControl) {
      await client.request('revoke_control', { controller_key: controllerKey });
    } else if (opts.controlDurationSeconds !== undefined) {
      await client.request('grant_control', {
        duration_seconds: opts.controlDurationSeconds,
        controller_key: controllerKey,
      });
    }
  }
  if (opts.revokeShell) {
    await client.request('revoke_shell', { controller_key: controllerKey });
  } else if (opts.shellAutoApproveUntilRevoked) {
    await client.request('grant_shell', { until_revoked: true, controller_key: controllerKey });
  } else if (opts.shellAutoApproveSeconds !== undefined) {
    await client.request('grant_shell', {
      duration_seconds: opts.shellAutoApproveSeconds,
      controller_key: controllerKey,
    });
  }
};

const configureAndStart = async (
  ctx: PolicyContext,
  desired: {
    apps: string[];
    roots: string[];
    shellEnabled: boolean;
    finish: boolean;
    start: boolean;
  }
): Promise<DesktopAccessHelperStatus> => {
  let status = ctx.getLatest() ?? (await ctx.getStatus());
  if (isBridgeRunning(status)) {
    await ctx.client.request('stop', {});
    status = ctx.getLatest() ?? (await ctx.getStatus());
  }
  if (!sameSet(desired.apps, status.config.allowed_app_ids)) {
    await ctx.client.request('set_allowed_apps', {
      expected_revision: status.config.revision,
      allowed_app_ids: desired.apps,
    });
    status = ctx.getLatest() ?? (await ctx.getStatus());
  }
  if (
    !sameSet(desired.roots, status.config.file_roots) ||
    status.config.shell_enabled !== desired.shellEnabled
  ) {
    await ctx.client.request('set_local_access', {
      expected_revision: status.config.revision,
      files: { roots: desired.roots },
      shell: { enabled: desired.shellEnabled },
    });
    status = ctx.getLatest() ?? (await ctx.getStatus());
  }
  if (desired.finish && !status.config.enabled) {
    const { homeserver, user_id, device_id } = status.pairing;
    if (!homeserver || !user_id || !device_id) {
      throw new DesktopHelperError(
        'SESSION_MISSING',
        'Sign in to a saved Matrix session before finishing setup.'
      );
    }
    await ctx.client.request('finish_setup', {
      expected_revision: status.config.revision,
      expected_session: { homeserver, user_id, device_id },
    });
    status = ctx.getLatest() ?? (await ctx.getStatus());
  }
  if (desired.start && status.config.enabled && hasLocalCapability(status.config)) {
    await ctx.client.request('start', {});
    status = ctx.getLatest() ?? (await ctx.getStatus());
  }
  return status;
};

export const applyFinishSetup = async (
  ctx: PolicyContext,
  req: DesktopAccessFinishSetupRequest
): Promise<void> => {
  const current = ctx.getLatest() ?? (await ctx.getStatus());
  if (req.mode === 'full') {
    const apps = unique([
      ...current.config.allowed_app_ids,
      'primary-screen',
      ...(req.allowedAppIds ?? []),
    ]);
    const roots = unique(req.fileRoots ?? current.config.file_roots);
    const satisfied =
      isBridgeRunning(current) &&
      current.config.enabled &&
      current.config.shell_enabled &&
      sameSet(apps, current.config.allowed_app_ids) &&
      sameSet(roots, current.config.file_roots);
    if (satisfied) {
      await grantFullForController(ctx.client, req.controllerKey);
      ctx.saveFullConsent(req.controllerKey, req.agentName);
      return;
    }
    const started = await configureAndStart(ctx, {
      apps,
      roots,
      shellEnabled: true,
      finish: true,
      start: true,
    });
    ctx.saveFullConsent(req.controllerKey, req.agentName);
    await reapplyConsentedGrants(ctx.client, started, ctx.loadConsent());
    return;
  }

  ctx.clearConsent(req.controllerKey);
  const apps = unique(req.allowedAppIds ?? current.config.allowed_app_ids);
  const roots = unique(req.fileRoots ?? current.config.file_roots);
  const shellEnabled = req.shellEnabled ?? current.config.shell_enabled;
  const satisfied =
    isBridgeRunning(current) &&
    current.config.enabled &&
    current.config.shell_enabled === shellEnabled &&
    sameSet(apps, current.config.allowed_app_ids) &&
    sameSet(roots, current.config.file_roots);
  if (!satisfied) {
    const started = await configureAndStart(ctx, {
      apps,
      roots,
      shellEnabled,
      finish: true,
      start: true,
    });
    if (isBridgeRunning(started)) {
      await reapplyConsentedGrants(ctx.client, started, ctx.loadConsent());
    }
  } else {
    if (current.config.allowed_app_ids.length > 0) {
      await ctx.client.request('revoke_control', { controller_key: req.controllerKey });
    }
    if ((ctx.getLatest() ?? current).shell.enabled) {
      await ctx.client.request('revoke_shell', { controller_key: req.controllerKey });
    }
  }
  const latest = ctx.getLatest() ?? current;
  if (isBridgeRunning(latest)) {
    await applyBoundedGrants(ctx.client, req.controllerKey, {
      ...req,
      hasGuiApps: latest.config.allowed_app_ids.length > 0,
      ...(latest.shell.enabled
        ? {}
        : { shellAutoApproveSeconds: undefined, shellAutoApproveUntilRevoked: undefined }),
    });
  }
};

export const applyUpdateLimits = async (
  ctx: PolicyContext,
  req: DesktopAccessUpdateLimitsRequest
): Promise<void> => {
  const current = ctx.getLatest() ?? (await ctx.getStatus());
  const wasRunning = isBridgeRunning(current);
  const baseApps = req.allowedAppIds ?? current.config.allowed_app_ids;
  const apps = req.mode === 'full' ? unique([...baseApps, 'primary-screen']) : unique(baseApps);
  const roots = unique(req.fileRoots ?? current.config.file_roots);
  const shellEnabled =
    req.mode === 'full' ? true : (req.shellEnabled ?? current.config.shell_enabled);
  const configChanged =
    !sameSet(apps, current.config.allowed_app_ids) ||
    !sameSet(roots, current.config.file_roots) ||
    shellEnabled !== current.config.shell_enabled;

  if (req.controllerKey && req.mode === 'restricted') ctx.clearConsent(req.controllerKey);
  if (configChanged) {
    const updated = await configureAndStart(ctx, {
      apps,
      roots,
      shellEnabled,
      finish: false,
      start: wasRunning,
    });
    if (req.controllerKey && req.mode === 'full')
      ctx.saveFullConsent(req.controllerKey, req.agentName);
    if (isBridgeRunning(updated))
      await reapplyConsentedGrants(ctx.client, updated, ctx.loadConsent());
    const latest = ctx.getLatest() ?? updated;
    if (req.controllerKey && req.mode !== 'full' && isBridgeRunning(latest)) {
      await applyBoundedGrants(ctx.client, req.controllerKey, {
        ...req,
        hasGuiApps: latest.config.allowed_app_ids.length > 0,
        ...(latest.shell.enabled
          ? {}
          : {
              revokeShell: false,
              shellAutoApproveSeconds: undefined,
              shellAutoApproveUntilRevoked: undefined,
            }),
      });
    }
    return;
  }

  const latest = ctx.getLatest() ?? current;
  if (req.controllerKey && req.mode === 'full') {
    if (isBridgeRunning(latest)) await grantFullForController(ctx.client, req.controllerKey);
    ctx.saveFullConsent(req.controllerKey, req.agentName);
  } else if (req.controllerKey && isBridgeRunning(latest)) {
    const shellActive = latest.shell.enabled;
    const hasGuiApps = latest.config.allowed_app_ids.length > 0;
    await applyBoundedGrants(ctx.client, req.controllerKey, {
      ...req,
      hasGuiApps,
      ...(hasGuiApps && req.mode === 'restricted' && req.controlDurationSeconds === undefined
        ? { revokeControl: true }
        : {}),
      ...(shellActive
        ? req.mode === 'restricted' &&
          req.shellAutoApproveSeconds === undefined &&
          !req.shellAutoApproveUntilRevoked
          ? { revokeShell: true }
          : {}
        : {
            revokeShell: false,
            shellAutoApproveSeconds: undefined,
            shellAutoApproveUntilRevoked: undefined,
          }),
    });
  }
};
