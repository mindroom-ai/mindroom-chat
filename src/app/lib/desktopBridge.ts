/** Shell-level events pushed from the Electron main process to the page. */
export type DesktopShellEvent =
  | { type: 'fullscreen'; value: boolean }
  | { type: 'zoom'; action: 'in' | 'out' | 'reset' }
  | { type: 'window-hidden' }
  | { type: 'window-focus'; focused: boolean }
  | { type: 'update-status' }
  | { type: 'swipe-tracking'; enabled: boolean }
  | { type: 'scroll-gesture'; phase: 'begin' | 'end' }
  | { type: 'swipe'; direction: 'left' | 'right' }
  | { type: 'desktop-access-status' }
  | { type: 'open-desktop-access-settings' };
export type DesktopResult<T> =
  { ok: true; value: T } | { ok: false; code: string; message?: string };
export type DesktopMediaSession = { baseUrl: string; userId: string; accessToken: string };
export type DesktopSignInRequest = { homeserver: string; callback: string };
export type DesktopUpdateCheckOutcome = 'none' | 'found' | 'error';
export type DesktopUpdateCheckResult = { outcome: DesktopUpdateCheckOutcome; version?: string };
export type DesktopUpdateBridge = {
  status: () => Promise<{ version?: string }>;
  check: () => Promise<DesktopUpdateCheckResult>;
  install: () => Promise<void>;
};
export type DesktopQuickCaptureBridge = {
  hide: () => Promise<void>;
  openScreenRecordingSettings: () => Promise<void>;
  captureScreenshot?: (
    target: 'window' | 'screen'
  ) => Promise<DesktopResult<{ bytes: Uint8Array; name: string }>>;
};

export type DesktopAccessAvailability =
  'available' | 'unsupported_platform' | 'unsupported_arch' | 'helper_missing';

export type DesktopAccessPermissionState = 'granted' | 'missing' | 'unknown';
export type DesktopAccessMode = 'full' | 'restricted';

export type DesktopAccessControllerConfig = {
  controller_key: string;
  user_id: string;
  device_id: string;
  ed25519: string;
  allowed_requester_ids: string[];
  allowed_agent_names: string[];
};

export type DesktopAccessControllerAuthority = {
  control_available: boolean;
  lease_remaining_seconds: number;
  control_scope: string;
};

export type DesktopAccessShellPending = {
  command_id: string;
  command: string;
  cwd: string;
  requester_id?: string;
  agent_name?: string;
  controller_key?: string;
};

export type DesktopAccessShellHandle = {
  handle: string;
  command: string;
  state: string;
  started_at_ms?: number;
};

export type DesktopAccessShellControllerState = {
  auto_approve_remaining_seconds: number;
  auto_approve_until_revoked: boolean;
};

export type DesktopAccessHelperStatus = {
  config: {
    state: 'ready' | 'missing' | 'invalid';
    revision: number;
    enabled: boolean;
    controllers: DesktopAccessControllerConfig[];
    allowed_app_ids: string[];
    file_roots: string[];
    shell_enabled: boolean;
  };
  pairing: {
    state: string;
    session_state: string;
    homeserver: string | null;
    user_id: string | null;
    device_id: string | null;
  };
  helper: {
    state: string;
    version: string;
  };
  bridge: {
    state: 'stopped' | 'observe_only' | 'control' | 'stopping' | 'faulted';
    active_action: string | null;
    last_error: string | null;
  };
  authority: {
    control_available: boolean;
    lease_remaining_seconds: number;
    control_scope: string;
    controllers: Record<string, DesktopAccessControllerAuthority>;
  };
  permissions: {
    accessibility: DesktopAccessPermissionState;
    screen_recording: DesktopAccessPermissionState;
    gui_permissions_ready: boolean;
  };
  shell: {
    enabled: boolean;
    ready: boolean;
    pending: DesktopAccessShellPending | null;
    auto_approve_remaining_seconds: number;
    auto_approve_until_revoked: boolean;
    active_request_id: string | null;
    handles: DesktopAccessShellHandle[];
    controllers: Record<string, DesktopAccessShellControllerState>;
  };
};

export type DesktopAccessConsentRecord = {
  mode: 'full';
  grantedAt: number;
  agentName?: string;
};

export type DesktopAccessSnapshot = {
  availability: DesktopAccessAvailability;
  helperRunning: boolean;
  helperError: string | null;
  status: DesktopAccessHelperStatus | null;
  consent: Record<string, DesktopAccessConsentRecord>;
  permissions: {
    accessibility: DesktopAccessPermissionState;
    screen_recording: DesktopAccessPermissionState;
    gui_permissions_ready: boolean;
  };
  relaunchRequired: boolean;
};

export type DesktopAccessLoginRequest = {
  homeserver: string;
  userId?: string;
  method: 'sso' | 'auto' | 'password';
  loginToken?: string;
  replace?: boolean;
  cloudflareAccess?: boolean;
};

export type DesktopAccessPairRequest = {
  controller: {
    userId: string;
    deviceId: string;
    ed25519: string;
  };
  allowedRequesterIds: string[];
  allowedAgentNames: string[];
  code: string;
  cloudflareAccess?: boolean;
};

export type DesktopAccessPairResult = {
  controllerKey: string;
  deviceId: string;
  deviceEd25519: string;
  verification: string;
  confirmationCommand: string;
  agentConfirmationCommand?: string;
  snapshot: DesktopAccessSnapshot;
};

export type DesktopAccessFinishSetupRequest = {
  controllerKey: string;
  agentName?: string;
  mode: DesktopAccessMode;
  allowedAppIds?: string[];
  fileRoots?: string[];
  shellEnabled?: boolean;
  controlDurationSeconds?: number;
  shellAutoApproveSeconds?: number;
  shellAutoApproveUntilRevoked?: boolean;
};

export type DesktopAccessUpdateLimitsRequest = {
  controllerKey?: string;
  agentName?: string;
  mode?: DesktopAccessMode;
  allowedAppIds?: string[];
  fileRoots?: string[];
  shellEnabled?: boolean;
  controlDurationSeconds?: number;
  revokeControl?: boolean;
  shellAutoApproveSeconds?: number;
  shellAutoApproveUntilRevoked?: boolean;
  revokeShell?: boolean;
};

export type DesktopShellDecisionRequest = {
  commandId: string;
  approved: boolean;
  autoApproveSeconds?: number;
  autoApproveUntilRevoked?: boolean;
};

export type InstalledMacApp = {
  bundleId: string;
  name: string;
  path: string;
};

export type DesktopAccessBridge = {
  status: () => Promise<DesktopResult<DesktopAccessSnapshot>>;
  /**
   * Opens the setup authorization from the click that just happened, so `login`, `pair` and
   * `finishSetup` still pass when the steps before them (the agent's setup offer, sign-in) outlast
   * the few seconds a click counts for. Call it first, before any waiting.
   */
  beginSetup: () => Promise<DesktopResult<void>>;
  login: (request: DesktopAccessLoginRequest) => Promise<DesktopResult<DesktopAccessSnapshot>>;
  pair: (request: DesktopAccessPairRequest) => Promise<DesktopResult<DesktopAccessPairResult>>;
  finishSetup: (
    request: DesktopAccessFinishSetupRequest
  ) => Promise<DesktopResult<DesktopAccessSnapshot>>;
  updateLimits: (
    request: DesktopAccessUpdateLimitsRequest
  ) => Promise<DesktopResult<DesktopAccessSnapshot>>;
  removeController: (controllerKey: string) => Promise<DesktopResult<DesktopAccessSnapshot>>;
  revokeAll: () => Promise<DesktopResult<DesktopAccessSnapshot>>;
  requestPermission: (
    permission: 'accessibility' | 'screen_recording'
  ) => Promise<DesktopResult<DesktopAccessSnapshot>>;
  relaunch: () => Promise<DesktopResult<void>>;
  listInstalledApps: () => Promise<DesktopResult<InstalledMacApp[]>>;
  pickFolder: () => Promise<DesktopResult<string | null>>;
  decideShell: (
    request: DesktopShellDecisionRequest
  ) => Promise<DesktopResult<DesktopAccessSnapshot>>;
  killShellHandle: (handle: string) => Promise<DesktopResult<DesktopAccessSnapshot>>;
};

export type DesktopShellApprovalBridge = {
  status: () => Promise<DesktopResult<DesktopAccessSnapshot>>;
  decideShell: (
    request: DesktopShellDecisionRequest
  ) => Promise<DesktopResult<DesktopAccessSnapshot>>;
};

/** What hands the page a URL the system opened: Capacitor's App plugin, or the desktop bridge. */
export type AppUrlPlugin = {
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url?: string }) => void
  ): Promise<unknown>;
  getLaunchUrl(): Promise<{ url?: string } | undefined>;
};

/**
 * The preload bridge exposed on `window.mindroomDesktop` in the Electron desktop app.
 * Later phases extend this type alongside `electron/preload.ts`.
 */
export type DesktopBridge = {
  onShellEvent: (listener: (event: DesktopShellEvent) => void) => () => void;
  /** Synchronous: main holds the session when this returns. */
  setMediaSession: (session: DesktopMediaSession | null) => DesktopResult<void>;
  startSignIn: (request: DesktopSignInRequest) => Promise<DesktopResult<string>>;
  openSignIn: (url: string) => Promise<DesktopResult<void>>;
  showMainWindow: () => Promise<DesktopResult<void>>;
  setBadge: (count: number) => void;
  isWindowFocused: () => boolean;
  screenShare: boolean;
  appUrl: AppUrlPlugin;
  update?: DesktopUpdateBridge;
  quickCapture?: DesktopQuickCaptureBridge;
  desktopAccess?: DesktopAccessBridge;
  shellApproval?: DesktopShellApprovalBridge;
};

declare global {
  interface Window {
    mindroomDesktop?: DesktopBridge;
  }
}
