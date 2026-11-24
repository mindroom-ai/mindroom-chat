// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopAccessShellPending,
  DesktopAccessSnapshot,
  DesktopBridge,
  DesktopShellEvent,
} from '../lib/desktopBridge';

const mocks = vi.hoisted(() => ({
  bridge: undefined as DesktopBridge | undefined,
  shellListeners: new Set<(event: DesktopShellEvent) => void>(),
  status: vi.fn(),
  decideShell: vi.fn(),
}));

vi.mock('../lib/nativeShell', () => ({
  desktopBridge: () => mocks.bridge,
  isDesktopAccessAvailable: () => Boolean(mocks.bridge?.desktopAccess),
}));

import { ShellApprovalView } from './ShellApprovalView';

const makeSnapshot = (pending: DesktopAccessShellPending | null): DesktopAccessSnapshot => ({
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
      state: 'ready',
      session_state: 'ready',
      homeserver: 'https://matrix.example.org',
      user_id: '@alice:example.org',
      device_id: 'HELPERDEV',
    },
    helper: { state: 'running', version: '1.2.3' },
    bridge: { state: 'control', active_action: null, last_error: null },
    authority: {
      control_available: true,
      lease_remaining_seconds: 0,
      control_scope: 'computer',
      controllers: {},
    },
    permissions: {
      accessibility: 'granted',
      screen_recording: 'granted',
      gui_permissions_ready: true,
    },
    shell: {
      enabled: true,
      ready: true,
      pending,
      auto_approve_remaining_seconds: 0,
      auto_approve_until_revoked: false,
      active_request_id: null,
      handles: [],
      controllers: {},
    },
  },
  consent: {},
  permissions: {
    accessibility: 'granted',
    screen_recording: 'granted',
    gui_permissions_ready: true,
  },
  relaunchRequired: false,
});

const installBridge = (pending: DesktopAccessShellPending | null) => {
  const snapshot = makeSnapshot(pending);
  mocks.status.mockResolvedValue({ ok: true, value: snapshot });
  mocks.decideShell.mockResolvedValue({ ok: true, value: makeSnapshot(null) });
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
    isWindowFocused: () => false,
    screenShare: false,
    appUrl: { addListener: vi.fn(), getLaunchUrl: vi.fn() },
    shellApproval: {
      status: mocks.status,
      decideShell: mocks.decideShell,
    },
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.bridge = undefined;
  mocks.shellListeners.clear();
  mocks.status.mockReset();
  mocks.decideShell.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('ShellApprovalView', () => {
  it('visibly escapes control characters, soft hyphens, zero-width chars, bidi controls, and Unicode tag characters', async () => {
    installBridge({
      command_id: 'cmd-escape',
      command: 'echo ok\rrm -rf /\n\t\x1b[31mhi\u00ad\u200b\u202e\u{e0061}',
      cwd: '/tmp/dir\nfake\u00ad',
      agent_name: 'code',
      requester_id: '@alice:example.org',
    });

    render(<ShellApprovalView />);
    await act(async () => {
      await Promise.resolve();
    });

    const commandEl = screen.getByTestId('shell-approval-command');
    expect(commandEl.textContent).toBe(
      'echo ok\\rrm -rf /\\n\\t\\x1b[31mhi\\xad\\u200b\\u202e\\u{e0061}'
    );
    expect(commandEl.textContent).not.toContain('\n');
    expect(commandEl.textContent).not.toContain('\r');
    expect(commandEl.textContent).not.toContain('\x1b');
    expect(commandEl.textContent).not.toContain('\u00ad');
    expect(commandEl.textContent).not.toContain('\u200b');
    expect(commandEl.textContent).not.toContain('\u{e0061}');

    const cwdEl = screen.getByTestId('shell-approval-cwd');
    expect(cwdEl.textContent).toBe('/tmp/dir\\nfake\\xad');
  });

  it('disables Approve buttons during the 1 s arming delay while Deny works immediately, and re-locks immediately when switching from an armed command A to command B', async () => {
    installBridge({
      command_id: 'cmd-A',
      command: 'ls -la',
      cwd: '/Users/alice',
      agent_name: 'code',
      requester_id: '@alice:example.org',
    });

    render(<ShellApprovalView />);
    await act(async () => {
      await Promise.resolve();
    });

    const approveOnce = screen.getByRole<HTMLButtonElement>('button', { name: /Approve once/i });
    const autoApprove = screen.getByRole<HTMLButtonElement>('button', {
      name: /Auto-approve 15 min/i,
    });
    const deny = screen.getByRole<HTMLButtonElement>('button', { name: 'Deny' });

    expect(approveOnce.disabled).toBe(true);
    expect(autoApprove.disabled).toBe(true);
    expect(deny.disabled).toBe(false);

    // Still locked at 500 ms
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(approveOnce.disabled).toBe(true);
    expect(autoApprove.disabled).toBe(true);

    // Arm command A completely at 1000 ms
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(approveOnce.disabled).toBe(false);
    expect(autoApprove.disabled).toBe(false);

    // Switching straight from armed command A to a brand new command B immediately disables Approve
    mocks.status.mockResolvedValue({
      ok: true,
      value: makeSnapshot({
        command_id: 'cmd-B',
        command: 'rm -rf /tmp/test',
        cwd: '/Users/alice/repo',
        agent_name: 'code',
      }),
    });
    await act(async () => {
      mocks.shellListeners.forEach((listener) => listener({ type: 'desktop-access-status' }));
      await Promise.resolve();
    });

    const approveB = screen.getByRole<HTMLButtonElement>('button', { name: /Approve once/i });
    const autoB = screen.getByRole<HTMLButtonElement>('button', {
      name: /Auto-approve 15 min/i,
    });
    const denyB = screen.getByRole<HTMLButtonElement>('button', { name: 'Deny' });

    expect(approveB.disabled).toBe(true);
    expect(autoB.disabled).toBe(true);
    expect(denyB.disabled).toBe(false);

    // Clicking disabled Approve during arming does not call decideShell
    fireEvent.click(approveB);
    expect(mocks.decideShell).not.toHaveBeenCalled();

    // Deny works immediately while command B is still arming
    await act(async () => {
      fireEvent.click(denyB);
      await Promise.resolve();
    });
    expect(mocks.decideShell).toHaveBeenCalledWith({
      commandId: 'cmd-B',
      approved: false,
    });

    // Command C arrives, waits 1000 ms, then Auto-approve 15 min succeeds
    mocks.decideShell.mockClear();
    mocks.status.mockResolvedValue({
      ok: true,
      value: makeSnapshot({
        command_id: 'cmd-C',
        command: 'git status',
        cwd: '/Users/alice/repo',
        agent_name: 'code',
      }),
    });
    await act(async () => {
      mocks.shellListeners.forEach((listener) => listener({ type: 'desktop-access-status' }));
      await Promise.resolve();
    });

    const autoC = screen.getByRole<HTMLButtonElement>('button', {
      name: /Auto-approve 15 min/i,
    });
    expect(autoC.disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(autoC.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(autoC);
      await Promise.resolve();
    });
    expect(mocks.decideShell).toHaveBeenCalledWith({
      commandId: 'cmd-C',
      approved: true,
      autoApproveSeconds: 900,
    });
  });
});
