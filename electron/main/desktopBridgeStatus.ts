import type {
  DesktopAccessControllerAuthority,
  DesktopAccessControllerConfig,
  DesktopAccessHelperStatus,
  DesktopAccessPermissionState,
  DesktopAccessShellControllerState,
  DesktopAccessShellHandle,
  DesktopAccessShellPending,
} from '../../src/app/lib/desktopBridge';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

export const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const parsePermissionState = (value: unknown): DesktopAccessPermissionState => {
  const raw = isRecord(value) ? value.state : value;
  return raw === 'granted' || raw === 'missing' || raw === 'unknown' ? raw : 'unknown';
};

const parseBridgeError = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  return null;
};

export const normalizeHelperStatus = (raw: unknown): DesktopAccessHelperStatus | null => {
  if (!isRecord(raw)) return null;
  const cfg = isRecord(raw.config) ? raw.config : {};
  const pairing = isRecord(raw.pairing) ? raw.pairing : {};
  const helper = isRecord(raw.helper) ? raw.helper : {};
  const bridge = isRecord(raw.bridge) ? raw.bridge : {};
  const authority = isRecord(raw.authority) ? raw.authority : {};
  const perms = isRecord(raw.permissions) ? raw.permissions : {};
  const shell = isRecord(raw.shell) ? raw.shell : {};

  const controllers: DesktopAccessControllerConfig[] = Array.isArray(cfg.controllers)
    ? cfg.controllers.filter(isRecord).map((entry) => ({
        controller_key: asString(entry.controller_key),
        user_id: asString(entry.user_id),
        device_id: asString(entry.device_id),
        ed25519: asString(entry.ed25519),
        allowed_requester_ids: asStringArray(entry.allowed_requester_ids),
        allowed_agent_names: asStringArray(entry.allowed_agent_names),
      }))
    : [];

  const authControllers: Record<string, DesktopAccessControllerAuthority> = {};
  if (isRecord(authority.controllers)) {
    for (const [key, entry] of Object.entries(authority.controllers)) {
      if (!isRecord(entry)) continue;
      authControllers[key] = {
        control_available: Boolean(entry.control_available),
        lease_remaining_seconds: asNumber(entry.lease_remaining_seconds),
        control_scope: asString(entry.control_scope, 'saved_apps'),
      };
    }
  }

  const shellControllers: Record<string, DesktopAccessShellControllerState> = {};
  if (isRecord(shell.controllers)) {
    for (const [key, entry] of Object.entries(shell.controllers)) {
      if (!isRecord(entry)) continue;
      shellControllers[key] = {
        auto_approve_remaining_seconds: asNumber(entry.auto_approve_remaining_seconds),
        auto_approve_until_revoked: Boolean(entry.auto_approve_until_revoked),
      };
    }
  }

  const pendingRaw = isRecord(shell.pending) ? shell.pending : null;
  const pending: DesktopAccessShellPending | null = pendingRaw
    ? {
        command_id: asString(pendingRaw.command_id),
        command: asString(pendingRaw.command),
        cwd: asString(pendingRaw.cwd),
        ...(typeof pendingRaw.requester_id === 'string'
          ? { requester_id: pendingRaw.requester_id }
          : {}),
        ...(typeof pendingRaw.agent_name === 'string' ? { agent_name: pendingRaw.agent_name } : {}),
        ...(typeof pendingRaw.controller_key === 'string'
          ? { controller_key: pendingRaw.controller_key }
          : {}),
      }
    : null;

  const handles: DesktopAccessShellHandle[] = Array.isArray(shell.handles)
    ? shell.handles.filter(isRecord).map((h) => ({
        handle: asString(h.handle),
        command: asString(h.command),
        state: asString(h.state),
        ...(typeof h.started_at_ms === 'number' ? { started_at_ms: h.started_at_ms } : {}),
      }))
    : [];

  const configState =
    cfg.state === 'ready' || cfg.state === 'missing' || cfg.state === 'invalid'
      ? cfg.state
      : 'missing';
  const bridgeState =
    bridge.state === 'stopped' ||
    bridge.state === 'observe_only' ||
    bridge.state === 'control' ||
    bridge.state === 'stopping' ||
    bridge.state === 'faulted'
      ? bridge.state
      : 'stopped';
  const accessibility = parsePermissionState(perms.accessibility);
  const screenRecording = parsePermissionState(perms.screen_recording);

  return {
    config: {
      state: configState,
      revision: asNumber(cfg.revision),
      enabled: Boolean(cfg.enabled),
      controllers,
      allowed_app_ids: asStringArray(cfg.allowed_app_ids),
      file_roots: asStringArray(cfg.file_roots),
      shell_enabled: Boolean(cfg.shell_enabled),
    },
    pairing: {
      state: asString(pairing.state, 'unpaired'),
      session_state: asString(pairing.session_state, 'missing'),
      homeserver: asNullableString(pairing.homeserver),
      user_id: asNullableString(pairing.user_id),
      device_id: asNullableString(pairing.device_id),
    },
    helper: { state: asString(helper.state, 'running'), version: asString(helper.version) },
    bridge: {
      state: bridgeState,
      active_action: asNullableString(bridge.active_action),
      last_error: parseBridgeError(bridge.last_error),
    },
    authority: {
      control_available: Boolean(authority.control_available),
      lease_remaining_seconds: asNumber(authority.lease_remaining_seconds),
      control_scope: asString(authority.control_scope, 'saved_apps'),
      controllers: authControllers,
    },
    permissions: {
      accessibility,
      screen_recording: screenRecording,
      gui_permissions_ready:
        typeof perms.gui_permissions_ready === 'boolean'
          ? perms.gui_permissions_ready
          : accessibility === 'granted' && screenRecording === 'granted',
    },
    shell: {
      enabled: Boolean(shell.enabled),
      ready: Boolean(shell.ready),
      pending,
      auto_approve_remaining_seconds: asNumber(shell.auto_approve_remaining_seconds),
      auto_approve_until_revoked: Boolean(shell.auto_approve_until_revoked),
      active_request_id: asNullableString(shell.active_request_id),
      handles,
      controllers: shellControllers,
    },
  };
};
