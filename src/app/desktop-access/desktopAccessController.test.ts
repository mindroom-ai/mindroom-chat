// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { AuthDict, MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationCancelled } from '../account/uia/useAuthenticatedAction';
import type {
  DesktopAccessBridge,
  DesktopAccessSnapshot,
  DesktopBridge,
  DesktopShellEvent,
} from '../lib/desktopBridge';
import type { DesktopLoginTokenResult } from './mintDesktopLoginToken';
import type { AgentSetupOfferResult } from './desktopOlmTransport';
import {
  disconnectAgentFromThisMac,
  pairAgentOnThisMac,
  useDesktopAccessSnapshot,
  type DesktopPairingStep,
} from './desktopAccessController';

const bridgeState = vi.hoisted(() => ({ current: undefined as DesktopBridge | undefined }));
const olmMocks = vi.hoisted(() => ({
  requestAgentSetupOffer: vi.fn<() => Promise<AgentSetupOfferResult>>(),
  confirmAgentPairing: vi.fn(),
  disconnectAgentPairing: vi.fn(),
}));
const tokenMock = vi.hoisted(() => ({
  mintDesktopLoginToken: vi.fn<() => Promise<DesktopLoginTokenResult>>(),
}));

vi.mock('../lib/nativeShell', () => ({
  desktopBridge: () => bridgeState.current,
  isDesktopAccessAvailable: () => Boolean(bridgeState.current?.desktopAccess),
}));

vi.mock('./desktopOlmTransport', () => olmMocks);
vi.mock('./mintDesktopLoginToken', () => tokenMock);

const makeSnapshot = (overrides?: {
  sessionState?: string;
  homeserver?: string | null;
  userId?: string | null;
  accessibility?: 'granted' | 'missing' | 'unknown';
}): DesktopAccessSnapshot => ({
  availability: 'available',
  helperRunning: true,
  helperError: null,
  status: {
    config: {
      state: 'ready',
      revision: 1,
      enabled: true,
      controllers: [],
      allowed_app_ids: ['primary-screen'],
      file_roots: [],
      shell_enabled: true,
    },
    pairing: {
      state: 'paired',
      session_state: overrides?.sessionState ?? 'ready',
      homeserver:
        overrides?.homeserver !== undefined ? overrides.homeserver : 'https://mindroom.chat',
      user_id: overrides?.userId !== undefined ? overrides.userId : '@bas:mindroom.chat',
      device_id: 'HELPER_DEV',
    },
    helper: { state: 'running', version: '1.0.0' },
    bridge: { state: 'control', active_action: null, last_error: null },
    authority: {
      control_available: true,
      lease_remaining_seconds: 0,
      control_scope: 'computer',
      controllers: {},
    },
    permissions: {
      accessibility: overrides?.accessibility ?? 'granted',
      screen_recording: 'granted',
      gui_permissions_ready: (overrides?.accessibility ?? 'granted') === 'granted',
    },
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
  },
  consent: {},
  permissions: {
    accessibility: overrides?.accessibility ?? 'granted',
    screen_recording: 'granted',
    gui_permissions_ready: (overrides?.accessibility ?? 'granted') === 'granted',
  },
  relaunchRequired: false,
});

const createMockBridge = (initialSnapshot: DesktopAccessSnapshot) => {
  let current = initialSnapshot;
  const listeners = new Set<(event: DesktopShellEvent) => void>();
  const desktopAccess: DesktopAccessBridge = {
    beginSetup: vi.fn(async () => ({ ok: true as const, value: undefined })),
    status: vi.fn(async () => ({ ok: true as const, value: current })),
    login: vi.fn(async () => ({ ok: true as const, value: current })),
    pair: vi.fn(async () => ({
      ok: true as const,
      value: {
        controllerKey: '["@mindroom_general:mindroom.chat", "AGENT_DEV", "agent-ed25519"]',
        deviceId: 'HELPER_DEV',
        deviceEd25519: 'helper-ed25519',
        verification: 'ABCD1234EFGH5678',
        confirmationCommand: '!desktop confirm',
        snapshot: current,
      },
    })),
    abortSetup: vi.fn(async () => ({ ok: true as const, value: current })),
    finishSetup: vi.fn(async () => ({ ok: true as const, value: current })),
    updateLimits: vi.fn(async () => ({ ok: true as const, value: current })),
    removeController: vi.fn(async () => ({ ok: true as const, value: current })),
    revokeAll: vi.fn(async () => ({ ok: true as const, value: current })),
    requestPermission: vi.fn(async () => ({ ok: true as const, value: current })),
    relaunch: vi.fn(async () => ({ ok: true as const, value: undefined })),
    listInstalledApps: vi.fn(async () => ({ ok: true as const, value: [] })),
    pickFolder: vi.fn(async () => ({ ok: true as const, value: null })),
    decideShell: vi.fn(async () => ({ ok: true as const, value: current })),
    killShellHandle: vi.fn(async () => ({ ok: true as const, value: current })),
  };

  const bridge = {
    onShellEvent: vi.fn((listener: (event: DesktopShellEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    desktopAccess,
  } as unknown as DesktopBridge;

  bridgeState.current = bridge;

  return {
    desktopAccess,
    setSnapshot: (next: DesktopAccessSnapshot) => {
      current = next;
    },
    emitShellEvent: (event: DesktopShellEvent) => {
      listeners.forEach((listener) => listener(event));
    },
    listenerCount: () => listeners.size,
  };
};

const mockMx = {
  getUserId: () => '@bas:mindroom.chat',
  getHomeserverUrl: () => 'https://mindroom.chat',
} as unknown as MatrixClient;

const directRunUia = <T>(request: (auth?: AuthDict) => Promise<T>) => request();

const ELIGIBLE_OFFER: AgentSetupOfferResult = {
  offer: {
    v: 1,
    nonce: 'abcdef0123456789abcdef0123456789',
    agent_name: 'general',
    eligible: true,
    homeserver: 'https://mindroom.chat',
    user_id: '@bas:mindroom.chat',
    code: 'pair-token-xyz',
    cloudflare_access: false,
    error: null,
  },
  controller: {
    user_id: '@mindroom_general:mindroom.chat',
    device_id: 'AGENT_DEV',
    ed25519: 'agent-ed25519',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  bridgeState.current = undefined;
  olmMocks.requestAgentSetupOffer.mockResolvedValue(ELIGIBLE_OFFER);
  olmMocks.confirmAgentPairing.mockResolvedValue({
    v: 1,
    nonce: '11111111111111111111111111111111',
    agent_name: 'general',
    ok: true,
    error: null,
  });
  olmMocks.disconnectAgentPairing.mockResolvedValue({
    v: 1,
    nonce: '22222222222222222222222222222222',
    agent_name: 'general',
    ok: true,
    error: null,
  });
  tokenMock.mintDesktopLoginToken.mockResolvedValue({
    kind: 'token',
    loginToken: 'msc3882-token',
    expiresAt: Date.now() + 120_000,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDesktopAccessSnapshot', () => {
  it('loads status, refreshes on shell event, polls missing accessibility every 1000ms, and stops once granted', async () => {
    vi.useFakeTimers();
    const mock = createMockBridge(makeSnapshot({ accessibility: 'missing' }));

    const { result, unmount } = renderHook(() =>
      useDesktopAccessSnapshot({ pollAccessibility: true })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.snapshot?.permissions.accessibility).toBe('missing');
    expect(mock.desktopAccess.status).toHaveBeenCalledTimes(1);

    // 1000 ms tick triggers live Accessibility poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mock.desktopAccess.status).toHaveBeenCalledTimes(2);

    // Flip Accessibility to granted; next poll sees granted and stops polling.
    mock.setSnapshot(makeSnapshot({ accessibility: 'granted' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.snapshot?.permissions.accessibility).toBe('granted');
    expect(mock.desktopAccess.status).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mock.desktopAccess.status).toHaveBeenCalledTimes(3);

    // Shell event still triggers a refresh.
    await act(async () => {
      mock.emitShellEvent({ type: 'desktop-access-status' });
      await Promise.resolve();
    });
    expect(mock.desktopAccess.status).toHaveBeenCalledTimes(4);

    unmount();
    expect(mock.listenerCount()).toBe(0);
  });

  it('returns null cleanly when desktopAccess bridge is unavailable', () => {
    const { result } = renderHook(() => useDesktopAccessSnapshot({ pollAccessibility: true }));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('pairAgentOnThisMac', () => {
  it('reuses an existing matching helper Matrix session without logging in again (2nd-agent live pairing)', async () => {
    const mock = createMockBridge(makeSnapshot({ sessionState: 'ready' }));
    const steps: DesktopPairingStep[] = [];

    const finalSnapshot = await pairAgentOnThisMac(
      mockMx,
      {
        agentUserId: '@mindroom_general:mindroom.chat',
        agentName: 'general',
        mode: 'full',
      },
      directRunUia,
      (step) => steps.push(step)
    );

    expect(finalSnapshot).toBeDefined();
    expect(steps).toEqual(['requesting_offer', 'pairing', 'confirming', 'finishing']);
    expect(tokenMock.mintDesktopLoginToken).not.toHaveBeenCalled();
    expect(mock.desktopAccess.login).not.toHaveBeenCalled();
    expect(mock.desktopAccess.pair).toHaveBeenCalledWith({
      controller: {
        userId: '@mindroom_general:mindroom.chat',
        deviceId: 'AGENT_DEV',
        ed25519: 'agent-ed25519',
      },
      allowedRequesterIds: ['@bas:mindroom.chat'],
      allowedAgentNames: ['general'],
      code: 'pair-token-xyz',
      cloudflareAccess: false,
    });
    expect(olmMocks.confirmAgentPairing).toHaveBeenCalledWith(
      mockMx,
      ELIGIBLE_OFFER.controller,
      {
        token: 'pair-token-xyz',
        verification: 'ABCD1234EFGH5678',
        deviceId: 'HELPER_DEV',
        deviceEd25519: 'helper-ed25519',
      },
      undefined
    );
    expect(mock.desktopAccess.finishSetup).toHaveBeenCalledWith({
      controllerKey: '["@mindroom_general:mindroom.chat", "AGENT_DEV", "agent-ed25519"]',
      agentName: 'general',
      mode: 'full',
    });
  });

  it('mints an MSC3882 login token silently when helper has no session', async () => {
    const mock = createMockBridge(
      makeSnapshot({ sessionState: 'missing', homeserver: null, userId: null })
    );
    const steps: DesktopPairingStep[] = [];

    await pairAgentOnThisMac(
      mockMx,
      {
        agentUserId: '@mindroom_general:mindroom.chat',
        agentName: 'general',
        mode: 'restricted',
        limits: { allowedAppIds: ['com.apple.Safari'], shellEnabled: false },
      },
      directRunUia,
      (step) => steps.push(step)
    );

    expect(steps).toEqual(['requesting_offer', 'signing_in', 'pairing', 'confirming', 'finishing']);
    expect(mock.desktopAccess.login).toHaveBeenCalledWith({
      homeserver: 'https://mindroom.chat',
      userId: '@bas:mindroom.chat',
      method: 'sso',
      loginToken: 'msc3882-token',
      cloudflareAccess: false,
      replace: false,
    });
    expect(mock.desktopAccess.finishSetup).toHaveBeenCalledWith({
      controllerKey: '["@mindroom_general:mindroom.chat", "AGENT_DEV", "agent-ed25519"]',
      agentName: 'general',
      mode: 'restricted',
      allowedAppIds: ['com.apple.Safari'],
      shellEnabled: false,
    });
  });

  it('falls back to helper browser SSO with replace=true when MSC3882 is unsupported and session differs', async () => {
    const mock = createMockBridge(
      makeSnapshot({ sessionState: 'ready', userId: '@other:mindroom.chat' })
    );
    tokenMock.mintDesktopLoginToken.mockResolvedValue({ kind: 'unsupported' });

    await pairAgentOnThisMac(
      mockMx,
      {
        agentUserId: '@mindroom_general:mindroom.chat',
        agentName: 'general',
        mode: 'full',
      },
      directRunUia
    );

    expect(mock.desktopAccess.login).toHaveBeenCalledWith({
      homeserver: 'https://mindroom.chat',
      userId: '@bas:mindroom.chat',
      method: 'sso',
      cloudflareAccess: false,
      replace: true,
    });
  });

  it('aborts cleanly on UIA cancellation and surfaces ineligible offer errors', async () => {
    const mock = createMockBridge(
      makeSnapshot({ sessionState: 'missing', homeserver: null, userId: null })
    );
    tokenMock.mintDesktopLoginToken.mockResolvedValue({ kind: 'cancelled' });

    await expect(
      pairAgentOnThisMac(
        mockMx,
        {
          agentUserId: '@mindroom_general:mindroom.chat',
          agentName: 'general',
          mode: 'full',
        },
        directRunUia
      )
    ).rejects.toBeInstanceOf(AuthenticationCancelled);
    expect(mock.desktopAccess.login).not.toHaveBeenCalled();
    expect(mock.desktopAccess.pair).not.toHaveBeenCalled();

    olmMocks.requestAgentSetupOffer.mockResolvedValue({
      offer: {
        v: 1,
        nonce: 'abcdef0123456789abcdef0123456789',
        agent_name: 'general',
        eligible: false,
        homeserver: null,
        user_id: null,
        code: null,
        cloudflare_access: false,
        error: 'Desktop pairing is disabled by server policy.',
      },
      controller: ELIGIBLE_OFFER.controller,
    });

    await expect(
      pairAgentOnThisMac(
        mockMx,
        {
          agentUserId: '@mindroom_general:mindroom.chat',
          agentName: 'general',
          mode: 'full',
        },
        directRunUia
      )
    ).rejects.toThrow('Desktop pairing is disabled by server policy.');
  });

  it('uses authoritative offer.agent_name from namespaced agents in pair and finishSetup', async () => {
    const mock = createMockBridge(makeSnapshot({ sessionState: 'ready' }));
    olmMocks.requestAgentSetupOffer.mockResolvedValue({
      offer: {
        ...ELIGIBLE_OFFER.offer,
        agent_name: 'writer',
      },
      controller: {
        user_id: '@mindroom_writer_ab12:mindroom.chat',
        device_id: 'WRITER_DEV',
        ed25519: 'writer-ed25519',
      },
    });

    await pairAgentOnThisMac(
      mockMx,
      {
        agentUserId: '@mindroom_writer_ab12:mindroom.chat',
        agentName: 'writer_ab12',
        mode: 'full',
      },
      directRunUia
    );

    expect(mock.desktopAccess.pair).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedAgentNames: ['writer'],
      })
    );
    expect(mock.desktopAccess.finishSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'writer',
      })
    );
  });

  it('calls abortSetup to roll back a newly-paired controller when confirmAgentPairing fails', async () => {
    const mock = createMockBridge(makeSnapshot({ sessionState: 'ready' }));
    olmMocks.confirmAgentPairing.mockRejectedValueOnce(new Error('Confirmation timed out.'));

    await expect(
      pairAgentOnThisMac(
        mockMx,
        {
          agentUserId: '@mindroom_general:mindroom.chat',
          agentName: 'general',
          mode: 'full',
        },
        directRunUia
      )
    ).rejects.toThrow('Confirmation timed out.');

    expect(mock.desktopAccess.abortSetup).toHaveBeenCalledWith(
      '["@mindroom_general:mindroom.chat", "AGENT_DEV", "agent-ed25519"]'
    );
    expect(mock.desktopAccess.finishSetup).not.toHaveBeenCalled();

    // Also rolls back when confirmAgentPairing returns ok: false.
    vi.mocked(mock.desktopAccess.abortSetup).mockClear();
    olmMocks.confirmAgentPairing.mockResolvedValueOnce({
      v: 1,
      nonce: '11111111111111111111111111111111',
      agent_name: 'general',
      ok: false,
      error: 'Verification mismatch.',
    });

    await expect(
      pairAgentOnThisMac(
        mockMx,
        {
          agentUserId: '@mindroom_general:mindroom.chat',
          agentName: 'general',
          mode: 'full',
        },
        directRunUia
      )
    ).rejects.toThrow('Verification mismatch.');

    expect(mock.desktopAccess.abortSetup).toHaveBeenCalledWith(
      '["@mindroom_general:mindroom.chat", "AGENT_DEV", "agent-ed25519"]'
    );
    expect(mock.desktopAccess.finishSetup).not.toHaveBeenCalled();
  });
});

describe('pairAgentOnThisMac setup authorization and offer pinning', () => {
  const params = {
    agentUserId: '@mindroom_general:mindroom.chat',
    agentName: 'general',
    mode: 'full' as const,
  };

  it('opens the setup authorization with beginSetup before it waits for the setup offer', async () => {
    const mock = createMockBridge(makeSnapshot({ sessionState: 'ready' }));

    await pairAgentOnThisMac(mockMx, params, directRunUia);

    expect(mock.desktopAccess.beginSetup).toHaveBeenCalledTimes(1);
    const [began] = vi.mocked(mock.desktopAccess.beginSetup).mock.invocationCallOrder;
    const [offered] = olmMocks.requestAgentSetupOffer.mock.invocationCallOrder;
    expect(began).toBeLessThan(offered ?? 0);
  });

  it('asks the agent for nothing when the click is too old to open the setup authorization', async () => {
    const mock = createMockBridge(makeSnapshot({ sessionState: 'ready' }));
    vi.mocked(mock.desktopAccess.beginSetup).mockResolvedValue({
      ok: false,
      code: 'NO_USER_GESTURE',
    });

    await expect(pairAgentOnThisMac(mockMx, params, directRunUia)).rejects.toThrow(
      'NO_USER_GESTURE'
    );
    expect(olmMocks.requestAgentSetupOffer).not.toHaveBeenCalled();
    expect(mock.desktopAccess.pair).not.toHaveBeenCalled();
  });

  it.each([
    ['another homeserver', { homeserver: 'https://evil.example' }, /homeserver/i],
    ['another account', { user_id: '@mallory:mindroom.chat' }, /account/i],
  ])(
    'rejects a setup offer that names %s before it touches the helper session',
    async (_label, forged, message) => {
      // The helper has no session, so an accepted offer would sign it in at the named server.
      const mock = createMockBridge(
        makeSnapshot({ sessionState: 'missing', homeserver: null, userId: null })
      );
      tokenMock.mintDesktopLoginToken.mockResolvedValue({ kind: 'unsupported' });
      olmMocks.requestAgentSetupOffer.mockResolvedValue({
        offer: { ...ELIGIBLE_OFFER.offer, ...forged },
        controller: ELIGIBLE_OFFER.controller,
      });
      const steps: DesktopPairingStep[] = [];

      await expect(
        pairAgentOnThisMac(mockMx, params, directRunUia, (step) => steps.push(step))
      ).rejects.toThrow(message);

      expect(steps).toEqual(['requesting_offer']);
      expect(mock.desktopAccess.status).not.toHaveBeenCalled();
      expect(tokenMock.mintDesktopLoginToken).not.toHaveBeenCalled();
      expect(mock.desktopAccess.login).not.toHaveBeenCalled();
      expect(mock.desktopAccess.pair).not.toHaveBeenCalled();
      expect(mock.desktopAccess.finishSetup).not.toHaveBeenCalled();
    }
  );
});

describe('disconnectAgentFromThisMac', () => {
  it('removes controller locally and sends best-effort Olm disconnect even when agent is unreachable', async () => {
    const mock = createMockBridge(makeSnapshot());
    olmMocks.disconnectAgentPairing.mockRejectedValue(new Error('Agent offline'));

    const snapshot = await disconnectAgentFromThisMac(
      mockMx,
      '["@mindroom_general:mindroom.chat", "AGENT_DEV", "agent-ed25519"]',
      '@mindroom_general:mindroom.chat',
      'general'
    );

    expect(snapshot).toBeDefined();
    expect(mock.desktopAccess.removeController).toHaveBeenCalledWith(
      '["@mindroom_general:mindroom.chat", "AGENT_DEV", "agent-ed25519"]'
    );
    expect(olmMocks.disconnectAgentPairing).toHaveBeenCalledWith(
      mockMx,
      '@mindroom_general:mindroom.chat',
      'general',
      undefined,
      expect.any(Number)
    );
  });
});
