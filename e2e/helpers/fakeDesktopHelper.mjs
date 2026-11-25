#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const HELPER_VERSION = '2026.11.572';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_REQUEST_KEYS = new Set(['v', 'request_id', 'action', 'parameters']);
const POLL_INTERVAL_MS = 50;

const parseCliArgs = (argv) => {
  let configPath = '';
  let storagePath = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config' && typeof argv[i + 1] === 'string') {
      configPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--storage-path' && typeof argv[i + 1] === 'string') {
      storagePath = argv[i + 1];
      i += 1;
    }
  }
  return { configPath, storagePath };
};

const { storagePath } = parseCliArgs(process.argv.slice(2));
if (!storagePath) {
  process.stderr.write('Missing required --storage-path argument.\n');
  process.exit(1);
}

const bridgeDir = path.join(storagePath, 'desktop_bridge');
const nativeConfigPath = path.join(bridgeDir, 'native_config.json');
const matrixSessionPath = path.join(bridgeDir, 'matrix_session.json');
const pendingShellPath = path.join(storagePath, 'pending-shell.json');
const shellDecisionsPath = path.join(storagePath, 'shell-decisions.jsonl');

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];

const uniqueStrings = (items) => [...new Set(items)];

const writeJsonAtomic = (targetPath, value) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, targetPath);
};

const readJsonIfExists = (targetPath) => {
  if (!fs.existsSync(targetPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return undefined;
  }
};

const loadInitialConfig = () => {
  const raw = readJsonIfExists(nativeConfigPath);
  if (!isPlainObject(raw)) {
    return {
      state: 'missing',
      data: {
        revision: 0,
        enabled: false,
        controllers: [],
        allowed_app_ids: [],
        file_roots: [],
        shell_enabled: false,
      },
    };
  }
  return {
    state: 'ready',
    data: {
      revision:
        typeof raw.revision === 'number' && Number.isInteger(raw.revision) ? raw.revision : 1,
      enabled: Boolean(raw.enabled),
      controllers: Array.isArray(raw.controllers)
        ? raw.controllers.filter(isPlainObject).map((ctrl) => ({
            controller_key: typeof ctrl.controller_key === 'string' ? ctrl.controller_key : '',
            user_id: typeof ctrl.user_id === 'string' ? ctrl.user_id : '',
            device_id: typeof ctrl.device_id === 'string' ? ctrl.device_id : '',
            ed25519: typeof ctrl.ed25519 === 'string' ? ctrl.ed25519 : '',
            allowed_requester_ids: asStringArray(ctrl.allowed_requester_ids),
            allowed_agent_names: asStringArray(ctrl.allowed_agent_names),
          }))
        : [],
      allowed_app_ids: asStringArray(raw.allowed_app_ids),
      file_roots: asStringArray(raw.file_roots),
      shell_enabled: Boolean(raw.shell_enabled),
    },
  };
};

const loadInitialSession = () => {
  const raw = readJsonIfExists(matrixSessionPath);
  if (
    !isPlainObject(raw) ||
    typeof raw.homeserver !== 'string' ||
    typeof raw.user_id !== 'string' ||
    typeof raw.device_id !== 'string'
  ) {
    return null;
  }
  return {
    homeserver: raw.homeserver,
    user_id: raw.user_id,
    device_id: raw.device_id,
    device_ed25519:
      typeof raw.device_ed25519 === 'string'
        ? raw.device_ed25519
        : 'DemoMacEd25519Key000000000000000000000000001',
  };
};

const loadedConfig = loadInitialConfig();
let configState = loadedConfig.state;
const config = loadedConfig.data;
let session = loadInitialSession();
let bridgeState = 'stopped';
let authorityControllers = {};
let shellControllers = {};
let pendingShell = null;
let pendingControllerKey = null;
let handles = [];
const permissions = {
  accessibility: { state: 'missing', can_request: true, recovery: null },
  screen_recording: { state: 'missing', can_request: true, recovery: null },
};
let sequence = 0;

const persistConfig = () => {
  configState = 'ready';
  writeJsonAtomic(nativeConfigPath, config);
};

const persistSession = () => {
  if (!session) return;
  writeJsonAtomic(matrixSessionPath, session);
};

const writeFrame = (frame) => {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
};

const buildStatus = () => {
  const authEntries = Object.values(authorityControllers);
  const controlAvailable = authEntries.some((entry) => entry.control_available);
  const leaseRemaining = authEntries.reduce(
    (max, entry) => Math.max(max, entry.lease_remaining_seconds),
    0
  );
  const controlScope = authEntries.some((entry) => entry.control_scope === 'computer')
    ? 'computer'
    : 'saved_apps';

  const shellEntries = Object.values(shellControllers);
  const autoApproveUntilRevoked = shellEntries.some((entry) => entry.auto_approve_until_revoked);
  const autoApproveRemaining = shellEntries.reduce(
    (max, entry) => Math.max(max, entry.auto_approve_remaining_seconds),
    0
  );

  const pairingState =
    session && config.controllers.length > 0 ? 'paired' : session ? 'signed_in' : 'unpaired';

  return {
    config: {
      state: configState,
      revision: config.revision,
      enabled: config.enabled,
      controllers: config.controllers.map((ctrl) => ({
        ...ctrl,
        allowed_requester_ids: [...ctrl.allowed_requester_ids],
        allowed_agent_names: [...ctrl.allowed_agent_names],
      })),
      allowed_app_ids: [...config.allowed_app_ids],
      file_roots: [...config.file_roots],
      shell_enabled: config.shell_enabled,
    },
    pairing: {
      state: pairingState,
      session_state: session ? 'ready' : 'missing',
      homeserver: session ? session.homeserver : null,
      user_id: session ? session.user_id : null,
      device_id: session ? session.device_id : null,
    },
    helper: { state: 'running', version: HELPER_VERSION },
    bridge: {
      state: bridgeState,
      active_action: null,
      last_error: null,
    },
    authority: {
      control_available: controlAvailable,
      lease_remaining_seconds: leaseRemaining,
      control_scope: controlScope,
      controllers: Object.fromEntries(
        Object.entries(authorityControllers).map(([key, entry]) => [key, { ...entry }])
      ),
    },
    permissions: {
      accessibility: { ...permissions.accessibility },
      screen_recording: { ...permissions.screen_recording },
      gui_permissions_ready:
        permissions.accessibility.state === 'granted' &&
        permissions.screen_recording.state === 'granted',
    },
    shell: {
      enabled: config.shell_enabled,
      ready: config.shell_enabled && bridgeState !== 'stopped',
      pending: pendingShell ? { ...pendingShell } : null,
      auto_approve_remaining_seconds: autoApproveRemaining,
      auto_approve_until_revoked: autoApproveUntilRevoked,
      active_request_id: pendingShell ? pendingShell.request_id : null,
      handles: handles.map((item) => ({ ...item })),
      controllers: Object.fromEntries(
        Object.entries(shellControllers).map(([key, entry]) => [key, { ...entry }])
      ),
    },
  };
};

const pushStatus = () => {
  sequence += 1;
  writeFrame({ v: 1, type: 'status', sequence, status: buildStatus() });
};

const respondOk = (requestId, result) => {
  writeFrame({ v: 1, type: 'response', request_id: requestId, ok: true, result });
};

const respondErr = (requestId, code, message, recovery = null, retryable = false) => {
  writeFrame({
    v: 1,
    type: 'response',
    request_id: requestId,
    ok: false,
    error: { code, message, recovery, retryable },
  });
};

const consumePendingShellFile = () => {
  if (!fs.existsSync(pendingShellPath)) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(pendingShellPath, 'utf8'));
  } catch {
    return false;
  }
  try {
    fs.unlinkSync(pendingShellPath);
  } catch {
    // Ignore if already removed.
  }
  if (parsed === null || (isPlainObject(parsed) && parsed.clear === true)) {
    pendingShell = null;
    pendingControllerKey = null;
    return true;
  }
  let changed = false;
  if (isPlainObject(parsed) && Array.isArray(parsed.handles)) {
    handles = parsed.handles.filter(isPlainObject).map((item) => ({
      handle: typeof item.handle === 'string' ? item.handle : '',
      state: typeof item.state === 'string' ? item.state : 'running',
      command_preview:
        typeof item.command_preview === 'string'
          ? item.command_preview
          : typeof item.command === 'string'
            ? item.command
            : '',
      cwd: typeof item.cwd === 'string' ? item.cwd : '',
      ...(typeof item.started_at_ms === 'number' ? { started_at_ms: item.started_at_ms } : {}),
    }));
    changed = true;
  }
  const pendingRequestId =
    isPlainObject(parsed) && typeof parsed.request_id === 'string' && parsed.request_id.trim()
      ? parsed.request_id
      : isPlainObject(parsed) && typeof parsed.command_id === 'string' && parsed.command_id.trim()
        ? parsed.command_id
        : '';
  if (
    isPlainObject(parsed) &&
    pendingRequestId &&
    typeof parsed.command === 'string' &&
    typeof parsed.cwd === 'string'
  ) {
    pendingShell = {
      request_id: pendingRequestId,
      ...(typeof parsed.requester_id === 'string' ? { requester_id: parsed.requester_id } : {}),
      ...(typeof parsed.agent_name === 'string' ? { agent_name: parsed.agent_name } : {}),
      command: parsed.command,
      cwd: parsed.cwd,
      expires_at_ms:
        typeof parsed.expires_at_ms === 'number' ? parsed.expires_at_ms : Date.now() + 60_000,
    };
    pendingControllerKey =
      typeof parsed.controller_key === 'string' ? parsed.controller_key : null;
    changed = true;
  }
  return changed;
};

const checkRevision = (requestId, params) => {
  if (params.expected_revision !== config.revision) {
    respondErr(
      requestId,
      'revision_conflict',
      `Expected revision ${String(config.revision)}, got ${String(params.expected_revision)}.`
    );
    return false;
  }
  return true;
};

const targetControllerKeys = (params) => {
  if (typeof params.controller_key === 'string' && params.controller_key.trim()) {
    return [params.controller_key];
  }
  return config.controllers.map((ctrl) => ctrl.controller_key);
};

const handleAction = (requestId, action, params) => {
  switch (action) {
    case 'status': {
      consumePendingShellFile();
      const status = buildStatus();
      respondOk(requestId, { status });
      return;
    }

    case 'login': {
      if (typeof params.homeserver !== 'string' || !params.homeserver.trim()) {
        respondErr(requestId, 'invalid_parameters', 'Missing homeserver.');
        return;
      }
      const userId =
        typeof params.user_id === 'string' && params.user_id.trim()
          ? params.user_id.trim()
          : '@demo_user:example.test';
      const keepDevice = Boolean(session) && !params.replace;
      session = {
        homeserver: params.homeserver.trim(),
        user_id: userId,
        device_id: keepDevice && session ? session.device_id : 'DEMOMACDEV1',
        device_ed25519:
          keepDevice && session
            ? session.device_ed25519
            : 'DemoMacEd25519Key000000000000000000000000001',
      };
      persistSession();
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'upsert_controller': {
      if (!checkRevision(requestId, params)) return;
      const ctrl = params.controller;
      if (
        !isPlainObject(ctrl) ||
        typeof ctrl.user_id !== 'string' ||
        typeof ctrl.device_id !== 'string' ||
        typeof ctrl.ed25519 !== 'string'
      ) {
        respondErr(requestId, 'invalid_parameters', 'Missing controller identity fields.');
        return;
      }
      const controllerKey = `${ctrl.user_id}|${ctrl.device_id}|${ctrl.ed25519}`;
      const entry = {
        controller_key: controllerKey,
        user_id: ctrl.user_id,
        device_id: ctrl.device_id,
        ed25519: ctrl.ed25519,
        allowed_requester_ids: uniqueStrings(asStringArray(params.allowed_requester_ids)),
        allowed_agent_names: uniqueStrings(asStringArray(params.allowed_agent_names)),
      };
      const existingIndex = config.controllers.findIndex(
        (item) => item.controller_key === controllerKey
      );
      if (existingIndex >= 0) config.controllers[existingIndex] = entry;
      else config.controllers.push(entry);
      config.revision += 1;
      persistConfig();
      pushStatus();
      respondOk(requestId, { controller_key: controllerKey, status: buildStatus() });
      return;
    }

    case 'pair': {
      if (!checkRevision(requestId, params)) return;
      if (!session) {
        respondErr(requestId, 'session_missing', 'Matrix session is missing.');
        return;
      }
      if (typeof params.code !== 'string' || !params.code.trim()) {
        respondErr(requestId, 'invalid_parameters', 'Missing pairing code.');
        return;
      }
      const controllerKey = typeof params.controller_key === 'string' ? params.controller_key : '';
      if (!config.controllers.some((ctrl) => ctrl.controller_key === controllerKey)) {
        respondErr(requestId, 'controller_not_found', 'Controller not found.');
        return;
      }
      const verification = '123456';
      const confirmationCommand = `!desktop pair-confirm ${session.device_id} ${verification}`;
      persistConfig();
      pushStatus();
      respondOk(requestId, {
        device_id: session.device_id,
        device_ed25519: session.device_ed25519,
        verification,
        confirmation_command: confirmationCommand,
        agent_confirmation_command: confirmationCommand,
        status: buildStatus(),
      });
      return;
    }

    case 'set_allowed_apps': {
      if (!checkRevision(requestId, params)) return;
      if (bridgeState !== 'stopped') {
        respondErr(requestId, 'bridge_running', 'Stop the bridge before editing allowed apps.');
        return;
      }
      config.allowed_app_ids = uniqueStrings(asStringArray(params.allowed_app_ids));
      config.revision += 1;
      persistConfig();
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'set_local_access': {
      if (!checkRevision(requestId, params)) return;
      if (bridgeState !== 'stopped') {
        respondErr(requestId, 'bridge_running', 'Stop the bridge before editing local access.');
        return;
      }
      if (isPlainObject(params.files) && Array.isArray(params.files.roots)) {
        config.file_roots = uniqueStrings(asStringArray(params.files.roots));
      }
      if (isPlainObject(params.shell) && typeof params.shell.enabled === 'boolean') {
        config.shell_enabled = params.shell.enabled;
      }
      config.revision += 1;
      persistConfig();
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'finish_setup': {
      if (!checkRevision(requestId, params)) return;
      const expected = params.expected_session;
      if (
        !session ||
        !isPlainObject(expected) ||
        expected.homeserver !== session.homeserver ||
        expected.user_id !== session.user_id ||
        expected.device_id !== session.device_id
      ) {
        respondErr(requestId, 'session_mismatch', 'Expected Matrix session does not match.');
        return;
      }
      config.enabled = true;
      config.revision += 1;
      persistConfig();
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'start': {
      if (!session || !config.enabled || config.controllers.length === 0) {
        respondErr(requestId, 'not_configured', 'Desktop bridge is not configured.');
        return;
      }
      const hasControl = Object.values(authorityControllers).some(
        (entry) => entry.control_available
      );
      bridgeState = hasControl ? 'control' : 'observe_only';
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'stop': {
      bridgeState = 'stopped';
      authorityControllers = {};
      shellControllers = {};
      pendingShell = null;
      pendingControllerKey = null;
      handles = [];
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'grant_control': {
      if (bridgeState === 'stopped') {
        respondErr(requestId, 'bridge_stopped', 'Start the bridge before granting control.');
        return;
      }
      const untilRevoked = Boolean(params.until_revoked);
      const duration = untilRevoked
        ? 0
        : typeof params.duration_seconds === 'number' && Number.isFinite(params.duration_seconds)
          ? params.duration_seconds
          : 300;
      const scope = typeof params.scope === 'string' && params.scope ? params.scope : 'saved_apps';
      for (const key of targetControllerKeys(params)) {
        authorityControllers[key] = {
          control_available: true,
          lease_remaining_seconds: duration,
          control_scope: scope,
        };
      }
      bridgeState = 'control';
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'revoke_control': {
      if (typeof params.controller_key === 'string' && params.controller_key.trim()) {
        delete authorityControllers[params.controller_key];
      } else {
        authorityControllers = {};
      }
      if (
        bridgeState === 'control' &&
        !Object.values(authorityControllers).some((entry) => entry.control_available)
      ) {
        bridgeState = 'observe_only';
      }
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'grant_shell': {
      if (bridgeState === 'stopped') {
        respondErr(requestId, 'bridge_stopped', 'Start the bridge before granting shell.');
        return;
      }
      const untilRevoked = Boolean(params.until_revoked);
      const duration = untilRevoked
        ? 0
        : typeof params.duration_seconds === 'number' && Number.isFinite(params.duration_seconds)
          ? params.duration_seconds
          : 900;
      for (const key of targetControllerKeys(params)) {
        shellControllers[key] = {
          auto_approve_remaining_seconds: duration,
          auto_approve_until_revoked: untilRevoked,
        };
      }
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'revoke_shell': {
      if (!config.shell_enabled) {
        respondErr(requestId, 'shell_denied', 'Shell access is disabled.');
        return;
      }
      if (typeof params.controller_key === 'string' && params.controller_key.trim()) {
        delete shellControllers[params.controller_key];
      } else {
        shellControllers = {};
      }
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'decide_shell': {
      if (
        !pendingShell ||
        typeof params.command_id !== 'string' ||
        params.command_id !== pendingShell.request_id
      ) {
        respondErr(requestId, 'no_pending_command', 'No matching pending shell command.');
        return;
      }
      const approved = Boolean(params.approved);
      const autoApproveSeconds =
        typeof params.auto_approve_seconds === 'number' ? params.auto_approve_seconds : 0;
      const autoApproveUntilRevoked = Boolean(params.auto_approve_until_revoked);
      const resolved = pendingShell;
      const resolvedControllerKey = pendingControllerKey;
      pendingShell = null;
      pendingControllerKey = null;

      if (approved && resolvedControllerKey) {
        if (autoApproveUntilRevoked) {
          shellControllers[resolvedControllerKey] = {
            auto_approve_remaining_seconds: 0,
            auto_approve_until_revoked: true,
          };
        } else if (autoApproveSeconds > 0) {
          shellControllers[resolvedControllerKey] = {
            auto_approve_remaining_seconds: autoApproveSeconds,
            auto_approve_until_revoked: false,
          };
        }
      }

      fs.mkdirSync(path.dirname(shellDecisionsPath), { recursive: true });
      fs.appendFileSync(
        shellDecisionsPath,
        `${JSON.stringify({
          request_id: resolved.request_id,
          command_id: resolved.request_id,
          command: resolved.command,
          cwd: resolved.cwd,
          approved,
          auto_approve_seconds: autoApproveSeconds,
          auto_approve_until_revoked: autoApproveUntilRevoked,
        })}\n`,
        'utf8'
      );
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'kill_shell_handle': {
      const target = typeof params.handle === 'string' ? params.handle : '';
      handles = handles.filter((item) => item.handle !== target);
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'remove_controller': {
      if (!checkRevision(requestId, params)) return;
      const controllerKey = typeof params.controller_key === 'string' ? params.controller_key : '';
      const beforeCount = config.controllers.length;
      config.controllers = config.controllers.filter(
        (ctrl) => ctrl.controller_key !== controllerKey
      );
      if (config.controllers.length === beforeCount) {
        respondErr(requestId, 'controller_not_found', 'Controller not found.');
        return;
      }
      delete authorityControllers[controllerKey];
      delete shellControllers[controllerKey];
      if (config.controllers.length === 0) {
        config.enabled = false;
        bridgeState = 'stopped';
        pendingShell = null;
        pendingControllerKey = null;
        handles = [];
      }
      config.revision += 1;
      persistConfig();
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    case 'request_permission': {
      const perm = params.permission;
      if (perm !== 'accessibility' && perm !== 'screen_recording') {
        respondErr(requestId, 'invalid_parameters', 'Unsupported permission name.');
        return;
      }
      permissions[perm] = { state: 'granted', can_request: true, recovery: null };
      pushStatus();
      respondOk(requestId, { status: buildStatus() });
      return;
    }

    default:
      respondErr(requestId, 'unknown_action', `Unknown action: ${action}`);
  }
};

consumePendingShellFile();
writeFrame({ v: 1, type: 'hello', helper_version: HELPER_VERSION });
pushStatus();

const pollTimer = setInterval(() => {
  if (consumePendingShellFile()) {
    pushStatus();
  }
}, POLL_INTERVAL_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    respondErr(null, 'invalid_json', 'Request line is not valid JSON.');
    return;
  }
  if (!isPlainObject(req)) {
    respondErr(null, 'invalid_request', 'Expected JSON object request frame.');
    return;
  }
  const keys = Object.keys(req);
  const requestId = typeof req.request_id === 'string' ? req.request_id : null;
  if (
    keys.some((key) => !ALLOWED_REQUEST_KEYS.has(key)) ||
    req.v !== 1 ||
    requestId === null ||
    !UUID_RE.test(requestId) ||
    typeof req.action !== 'string' ||
    !isPlainObject(req.parameters)
  ) {
    respondErr(requestId, 'invalid_request', 'Expected strict v1 UUID request frame.');
    return;
  }
  handleAction(requestId, req.action, req.parameters);
});

rl.on('close', () => {
  clearInterval(pollTimer);
  process.exit(0);
});
