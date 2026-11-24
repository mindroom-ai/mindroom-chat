import type {
  DesktopAccessFinishSetupRequest,
  DesktopAccessLoginRequest,
  DesktopAccessMode,
  DesktopAccessPairRequest,
  DesktopAccessPairResult,
  DesktopAccessSnapshot,
  DesktopAccessUpdateLimitsRequest,
  DesktopResult,
  DesktopShellDecisionRequest,
  InstalledMacApp,
} from '../../src/app/lib/desktopBridge';
import { isAllowedHomeserverBaseUrl } from '../../src/app/matrix/cs-api';
import { handle } from './ipc';

export type DesktopAccessOperations = {
  getStatus(): Promise<DesktopResult<DesktopAccessSnapshot>>;
  beginSetup(): Promise<DesktopResult<void>>;
  login(request: DesktopAccessLoginRequest): Promise<DesktopResult<DesktopAccessSnapshot>>;
  pair(request: DesktopAccessPairRequest): Promise<DesktopResult<DesktopAccessPairResult>>;
  finishSetup(
    request: DesktopAccessFinishSetupRequest
  ): Promise<DesktopResult<DesktopAccessSnapshot>>;
  updateLimits(
    request: DesktopAccessUpdateLimitsRequest
  ): Promise<DesktopResult<DesktopAccessSnapshot>>;
  removeController(controllerKey: string): Promise<DesktopResult<DesktopAccessSnapshot>>;
  revokeAll(): Promise<DesktopResult<DesktopAccessSnapshot>>;
  requestPermission(
    permission: 'accessibility' | 'screen_recording'
  ): Promise<DesktopResult<DesktopAccessSnapshot>>;
  relaunch(): Promise<DesktopResult<void>>;
  listInstalledApps(): Promise<DesktopResult<InstalledMacApp[]>>;
  pickFolder(): Promise<DesktopResult<string | null>>;
  decideShell(request: DesktopShellDecisionRequest): Promise<DesktopResult<DesktopAccessSnapshot>>;
  killShellHandle(handleId: string): Promise<DesktopResult<DesktopAccessSnapshot>>;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean =>
  Object.keys(obj).every((key) => allowed.has(key));

const nonEmptyString = (value: unknown, maxLen = 4096): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLen
    ? value
    : undefined;

const optString = (value: unknown, maxLen = 4096): string | undefined | null =>
  value === undefined ? undefined : (nonEmptyString(value, maxLen) ?? null);

const optBool = (value: unknown): boolean | undefined | null =>
  value === undefined ? undefined : typeof value === 'boolean' ? value : null;

const optStringArray = (value: unknown, minLen = 0): string[] | undefined | null => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < minLen || value.length > 256) return null;
  const out: string[] = [];
  for (const item of value) {
    const parsed = nonEmptyString(item);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
};

const optDuration = (value: unknown): number | undefined | null => {
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 60 && value <= 3600
    ? value
    : null;
};

const parseMode = (value: unknown): DesktopAccessMode | undefined =>
  value === 'full' || value === 'restricted' ? value : undefined;

const LOGIN_KEYS = new Set([
  'homeserver',
  'userId',
  'method',
  'loginToken',
  'replace',
  'cloudflareAccess',
]);
const PAIR_KEYS = new Set([
  'controller',
  'allowedRequesterIds',
  'allowedAgentNames',
  'code',
  'cloudflareAccess',
]);
const CONTROLLER_KEYS = new Set(['userId', 'deviceId', 'ed25519']);
const FINISH_KEYS = new Set([
  'controllerKey',
  'agentName',
  'mode',
  'allowedAppIds',
  'fileRoots',
  'shellEnabled',
  'controlDurationSeconds',
  'shellAutoApproveSeconds',
  'shellAutoApproveUntilRevoked',
]);
const LIMITS_KEYS = new Set([...FINISH_KEYS, 'revokeControl', 'revokeShell']);
const DECIDE_SHELL_KEYS = new Set([
  'commandId',
  'approved',
  'autoApproveSeconds',
  'autoApproveUntilRevoked',
]);

export const parseLoginRequest = (raw: unknown): DesktopAccessLoginRequest | undefined => {
  if (!isPlainObject(raw) || !hasOnlyKeys(raw, LOGIN_KEYS)) return undefined;
  const homeserver = nonEmptyString(raw.homeserver, 2048);
  const method = raw.method;
  if (
    !homeserver ||
    !isAllowedHomeserverBaseUrl(homeserver) ||
    (method !== 'sso' && method !== 'auto' && method !== 'password')
  ) {
    return undefined;
  }
  const userId = optString(raw.userId);
  const loginToken = optString(raw.loginToken);
  const replace = optBool(raw.replace);
  const cloudflareAccess = optBool(raw.cloudflareAccess);
  if (userId === null || loginToken === null || replace === null || cloudflareAccess === null) {
    return undefined;
  }
  return {
    homeserver,
    method,
    ...(userId !== undefined ? { userId } : {}),
    ...(loginToken !== undefined ? { loginToken } : {}),
    ...(replace !== undefined ? { replace } : {}),
    ...(cloudflareAccess !== undefined ? { cloudflareAccess } : {}),
  };
};

export const parsePairRequest = (raw: unknown): DesktopAccessPairRequest | undefined => {
  if (!isPlainObject(raw) || !hasOnlyKeys(raw, PAIR_KEYS)) return undefined;
  if (!isPlainObject(raw.controller) || !hasOnlyKeys(raw.controller, CONTROLLER_KEYS)) {
    return undefined;
  }
  const userId = nonEmptyString(raw.controller.userId);
  const deviceId = nonEmptyString(raw.controller.deviceId);
  const ed25519 = nonEmptyString(raw.controller.ed25519);
  const allowedRequesterIds = optStringArray(raw.allowedRequesterIds, 1);
  const allowedAgentNames = optStringArray(raw.allowedAgentNames, 1);
  const code = nonEmptyString(raw.code);
  const cloudflareAccess = optBool(raw.cloudflareAccess);
  if (
    !userId ||
    !deviceId ||
    !ed25519 ||
    !allowedRequesterIds ||
    !allowedAgentNames ||
    !code ||
    cloudflareAccess === null
  ) {
    return undefined;
  }
  return {
    controller: { userId, deviceId, ed25519 },
    allowedRequesterIds,
    allowedAgentNames,
    code,
    ...(cloudflareAccess !== undefined ? { cloudflareAccess } : {}),
  };
};

const parseSharedLimits = (raw: Record<string, unknown>) => {
  const agentName = optString(raw.agentName);
  const allowedAppIds = optStringArray(raw.allowedAppIds);
  const fileRoots = optStringArray(raw.fileRoots);
  const shellEnabled = optBool(raw.shellEnabled);
  const controlDurationSeconds = optDuration(raw.controlDurationSeconds);
  const shellAutoApproveSeconds = optDuration(raw.shellAutoApproveSeconds);
  const shellAutoApproveUntilRevoked = optBool(raw.shellAutoApproveUntilRevoked);
  if (
    agentName === null ||
    allowedAppIds === null ||
    fileRoots === null ||
    shellEnabled === null ||
    controlDurationSeconds === null ||
    shellAutoApproveSeconds === null ||
    shellAutoApproveUntilRevoked === null ||
    (shellAutoApproveSeconds !== undefined && shellAutoApproveUntilRevoked)
  ) {
    return undefined;
  }
  return {
    ...(agentName !== undefined ? { agentName } : {}),
    ...(allowedAppIds !== undefined ? { allowedAppIds } : {}),
    ...(fileRoots !== undefined ? { fileRoots } : {}),
    ...(shellEnabled !== undefined ? { shellEnabled } : {}),
    ...(controlDurationSeconds !== undefined ? { controlDurationSeconds } : {}),
    ...(shellAutoApproveSeconds !== undefined ? { shellAutoApproveSeconds } : {}),
    ...(shellAutoApproveUntilRevoked !== undefined ? { shellAutoApproveUntilRevoked } : {}),
  };
};

export const parseFinishSetupRequest = (
  raw: unknown
): DesktopAccessFinishSetupRequest | undefined => {
  if (!isPlainObject(raw) || !hasOnlyKeys(raw, FINISH_KEYS)) return undefined;
  const controllerKey = nonEmptyString(raw.controllerKey);
  const mode = parseMode(raw.mode);
  const shared = parseSharedLimits(raw);
  return controllerKey && mode && shared ? { controllerKey, mode, ...shared } : undefined;
};

export const parseUpdateLimitsRequest = (
  raw: unknown
): DesktopAccessUpdateLimitsRequest | undefined => {
  if (!isPlainObject(raw) || !hasOnlyKeys(raw, LIMITS_KEYS)) return undefined;
  const controllerKey = optString(raw.controllerKey);
  const mode = raw.mode === undefined ? undefined : (parseMode(raw.mode) ?? null);
  const revokeControl = optBool(raw.revokeControl);
  const revokeShell = optBool(raw.revokeShell);
  const shared = parseSharedLimits(raw);
  if (
    controllerKey === null ||
    mode === null ||
    revokeControl === null ||
    revokeShell === null ||
    !shared
  ) {
    return undefined;
  }
  return {
    ...shared,
    ...(controllerKey !== undefined ? { controllerKey } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(revokeControl !== undefined ? { revokeControl } : {}),
    ...(revokeShell !== undefined ? { revokeShell } : {}),
  };
};

export const parseDecideShellRequest = (raw: unknown): DesktopShellDecisionRequest | undefined => {
  if (!isPlainObject(raw) || !hasOnlyKeys(raw, DECIDE_SHELL_KEYS)) return undefined;
  const commandId = nonEmptyString(raw.commandId);
  if (!commandId || typeof raw.approved !== 'boolean') return undefined;
  const secondsRaw = raw.autoApproveSeconds;
  const autoApproveSeconds =
    secondsRaw === undefined
      ? 0
      : typeof secondsRaw === 'number' &&
          Number.isInteger(secondsRaw) &&
          (secondsRaw === 0 || (secondsRaw >= 60 && secondsRaw <= 3600))
        ? secondsRaw
        : null;
  const untilRevoked = optBool(raw.autoApproveUntilRevoked);
  if (autoApproveSeconds === null || untilRevoked === null) return undefined;
  if (
    (!raw.approved && (autoApproveSeconds > 0 || untilRevoked)) ||
    (autoApproveSeconds > 0 && untilRevoked)
  ) {
    return undefined;
  }
  return {
    commandId,
    approved: raw.approved,
    autoApproveSeconds,
    ...(untilRevoked ? { autoApproveUntilRevoked: true } : {}),
  };
};

export const registerDesktopAccessHandlers = (
  mainOwners: () => readonly Electron.WebContents[],
  shellApprovalOwners: () => readonly Electron.WebContents[],
  access: DesktopAccessOperations
): void => {
  const statusOwners = (): readonly Electron.WebContents[] => [
    ...mainOwners(),
    ...shellApprovalOwners(),
  ];
  const noArgs = (args: unknown[]): true | undefined => (args.length === 0 ? true : undefined);

  handle('desktop:access-status', statusOwners, noArgs, () => access.getStatus());
  handle('desktop:access-begin-setup', mainOwners, noArgs, () => access.beginSetup());
  handle(
    'desktop:access-login',
    mainOwners,
    (args) => (args.length === 1 ? parseLoginRequest(args[0]) : undefined),
    (req) => access.login(req)
  );
  handle(
    'desktop:access-pair',
    mainOwners,
    (args) => (args.length === 1 ? parsePairRequest(args[0]) : undefined),
    (req) => access.pair(req)
  );
  handle(
    'desktop:access-finish-setup',
    mainOwners,
    (args) => (args.length === 1 ? parseFinishSetupRequest(args[0]) : undefined),
    (req) => access.finishSetup(req)
  );
  handle(
    'desktop:access-update-limits',
    mainOwners,
    (args) => (args.length === 1 ? parseUpdateLimitsRequest(args[0]) : undefined),
    (req) => access.updateLimits(req)
  );
  handle(
    'desktop:access-remove-controller',
    mainOwners,
    (args) => (args.length === 1 ? nonEmptyString(args[0]) : undefined),
    (key) => access.removeController(key)
  );
  handle('desktop:access-revoke-all', mainOwners, noArgs, () => access.revokeAll());
  handle(
    'desktop:access-request-permission',
    mainOwners,
    (args) =>
      args.length === 1 && (args[0] === 'accessibility' || args[0] === 'screen_recording')
        ? args[0]
        : undefined,
    (permission) => access.requestPermission(permission)
  );
  handle('desktop:access-relaunch', mainOwners, noArgs, () => access.relaunch());
  handle('desktop:access-list-apps', mainOwners, noArgs, () => access.listInstalledApps());
  handle('desktop:access-pick-folder', mainOwners, noArgs, () => access.pickFolder());
  handle(
    'desktop:access-decide-shell',
    statusOwners,
    (args) => (args.length === 1 ? parseDecideShellRequest(args[0]) : undefined),
    (req) => access.decideShell(req)
  );
  handle(
    'desktop:access-kill-shell',
    mainOwners,
    (args) => (args.length === 1 ? nonEmptyString(args[0]) : undefined),
    (handleId) => access.killShellHandle(handleId)
  );
};
