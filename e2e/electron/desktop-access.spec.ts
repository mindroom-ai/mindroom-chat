import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';

const APP_ORIGIN = 'capacitor://localhost';
const SHELL_APPROVAL_URL = `${APP_ORIGIN}/shell-approval/`;
const FAKE_HELPER_BIN = fileURLToPath(new URL('../helpers/fakeDesktopHelper.mjs', import.meta.url));

const DEMO_HOMESERVER = 'https://example.test';
const DEMO_USER_ID = '@demo_user:example.test';
const DEMO_AGENT_USER_ID = '@demo_assistant:example.test';
const DEMO_AGENT_NAME = 'demo_assistant';
const DEMO_AGENT_DEVICE_ID = 'DEMOAGENT1';
const DEMO_AGENT_ED25519 = 'DemoAgentEd25519Key000000000000000000000001';
const DEMO_PROJECT_ROOT = '/Users/demo/Projects';

type ShellApprovalWindowState = {
  exists: boolean;
  visible: boolean;
  focused: boolean;
};

const shellApprovalWindowState = (app: ElectronApplication): Promise<ShellApprovalWindowState> =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/shell-approval')
    );
    return {
      exists: Boolean(win),
      visible: win ? win.isVisible() : false,
      focused: win ? win.isFocused() : false,
    };
  });

const writeJsonAtomic = (targetPath: string, payload: unknown): void => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, targetPath);
};

const waitForLoginScreen = async (page: Page): Promise<void> => {
  await expect(page.locator('input[name="serverInput"]')).toBeVisible();
};

const runSingleClickSetup = async (
  page: Page,
  mode: 'full' | 'restricted'
): Promise<{
  controllerKey: string;
  finishResult: Awaited<
    ReturnType<NonNullable<NonNullable<Window['mindroomDesktop']>['desktopAccess']>['finishSetup']>
  >;
}> => {
  // Record one real Electron input-event gesture in the main window.
  await page.locator('input[name="serverInput"]').click();

  return page.evaluate(
    async ({
      homeserver,
      userId,
      agentUserId,
      agentName,
      agentDeviceId,
      agentEd25519,
      projectRoot,
      setupMode,
    }) => {
      const api = window.mindroomDesktop?.desktopAccess;
      if (!api) throw new Error('window.mindroomDesktop.desktopAccess is unavailable');

      const began = await api.beginSetup();
      if (!began.ok) {
        throw new Error(`beginSetup failed: ${began.code} ${began.message ?? ''}`);
      }

      const loggedIn = await api.login({
        homeserver,
        userId,
        method: 'auto',
        loginToken: 'demo_login_token_1',
      });
      if (!loggedIn.ok) {
        throw new Error(`login failed: ${loggedIn.code} ${loggedIn.message ?? ''}`);
      }

      const paired = await api.pair({
        controller: {
          userId: agentUserId,
          deviceId: agentDeviceId,
          ed25519: agentEd25519,
        },
        allowedRequesterIds: [userId],
        allowedAgentNames: [agentName],
        code: 'demo-pair-code-1',
      });
      if (!paired.ok) {
        throw new Error(`pair failed: ${paired.code} ${paired.message ?? ''}`);
      }

      const finishResult = await api.finishSetup({
        controllerKey: paired.value.controllerKey,
        agentName,
        mode: setupMode,
        fileRoots: [projectRoot],
        ...(setupMode === 'restricted' ? { shellEnabled: true } : {}),
      });

      return { controllerKey: paired.value.controllerKey, finishResult };
    },
    {
      homeserver: DEMO_HOMESERVER,
      userId: DEMO_USER_ID,
      agentUserId: DEMO_AGENT_USER_ID,
      agentName: DEMO_AGENT_NAME,
      agentDeviceId: DEMO_AGENT_DEVICE_ID,
      agentEd25519: DEMO_AGENT_ED25519,
      projectRoot: DEMO_PROJECT_ROOT,
      setupMode: mode,
    }
  );
};

test.afterEach(assertNoUnexpectedViolations);

test('desktopAccess IPC rejects sensitive actions without a user gesture and consumes gestures once', async () => {
  const session = await launchDesktop({
    offline: true,
    desktopHelperBin: FAKE_HELPER_BIN,
  });
  try {
    const { page } = session;
    await waitForLoginScreen(page);

    const unclickedResults = await page.evaluate(async () => {
      const api = window.mindroomDesktop?.desktopAccess;
      if (!api) throw new Error('desktopAccess bridge missing');
      const begin = await api.beginSetup();
      const revoke = await api.revokeAll();
      const permission = await api.requestPermission('accessibility');
      return { begin, revoke, permission };
    });

    expect(unclickedResults.begin).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
    expect(unclickedResults.revoke).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
    expect(unclickedResults.permission).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

    // One real click unlocks exactly one sensitive IPC action.
    await page.locator('input[name="serverInput"]').click();
    const afterClick = await page.evaluate(async () => {
      const api = window.mindroomDesktop?.desktopAccess;
      if (!api) throw new Error('desktopAccess bridge missing');
      const first = await api.requestPermission('accessibility');
      const second = await api.requestPermission('screen_recording');
      return { first, second };
    });

    expect(afterClick.first.ok).toBe(true);
    if (afterClick.first.ok) {
      expect(afterClick.first.value.permissions.accessibility).toBe('granted');
    }
    expect(afterClick.second).toEqual({ ok: false, code: 'NO_USER_GESTURE' });
  } finally {
    await session.close();
  }
});

test('single-click full setup writes mode-0600 consent and revokeAll persists across relaunch', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-desktop-access-e2e-'));
  const consentPath = path.join(userData, 'desktop-access-consent.json');
  const expectedNativeConfig = path.join(
    userData,
    'desktop-bridge-test',
    'mindroom_data',
    'desktop_bridge',
    'native_config.json'
  );
  let controllerKey = '';

  try {
    // 1. Single-click Full Access setup inside isolated userData.
    const first = await launchDesktop({
      offline: true,
      userData,
      desktopHelperBin: FAKE_HELPER_BIN,
    });
    try {
      await waitForLoginScreen(first.page);
      const setup = await runSingleClickSetup(first.page, 'full');
      controllerKey = setup.controllerKey;
      expect(setup.finishResult.ok).toBe(true);

      expect(fs.existsSync(consentPath)).toBe(true);
      expect(fs.statSync(consentPath).mode & 0o777).toBe(0o600);
      const savedConsent = JSON.parse(fs.readFileSync(consentPath, 'utf8')) as {
        v: number;
        controllers: Record<string, { mode: string; agentName?: string }>;
      };
      expect(savedConsent.v).toBe(1);
      expect(savedConsent.controllers[controllerKey]).toMatchObject({
        mode: 'full',
        agentName: DEMO_AGENT_NAME,
      });
      expect(fs.existsSync(expectedNativeConfig)).toBe(true);

      const statusRes = await first.page.evaluate(async () => {
        const api = window.mindroomDesktop?.desktopAccess;
        if (!api) throw new Error('desktopAccess bridge missing');
        return api.status();
      });
      expect(statusRes.ok).toBe(true);
      if (!statusRes.ok) throw new Error('status failed');
      expect(statusRes.value.availability).toBe('available');
      expect(statusRes.value.helperRunning).toBe(true);
      expect(statusRes.value.consent[controllerKey]?.mode).toBe('full');
      expect(statusRes.value.status?.config.enabled).toBe(true);
      expect(statusRes.value.status?.config.allowed_app_ids).toContain('primary-screen');
      expect(statusRes.value.status?.config.file_roots).toEqual([DEMO_PROJECT_ROOT]);
      expect(statusRes.value.status?.config.shell_enabled).toBe(true);
      expect(statusRes.value.status?.bridge.state).toBe('control');
      expect(statusRes.value.status?.authority.control_available).toBe(true);
      expect(statusRes.value.status?.authority.control_scope).toBe('computer');
      expect(statusRes.value.status?.shell.auto_approve_until_revoked).toBe(true);
    } finally {
      await first.close();
    }

    // 2. Relaunch verifies Full Access reapplies, then revokeAll clears everything.
    const second = await launchDesktop({
      offline: true,
      userData,
      desktopHelperBin: FAKE_HELPER_BIN,
    });
    try {
      await waitForLoginScreen(second.page);
      await expect
        .poll(async () => {
          const res = await second.page.evaluate(() =>
            window.mindroomDesktop?.desktopAccess?.status()
          );
          return res && res.ok
            ? {
                helperRunning: res.value.helperRunning,
                bridgeState: res.value.status?.bridge.state,
                controlAvailable: res.value.status?.authority.control_available,
                shellUntilRevoked: res.value.status?.shell.auto_approve_until_revoked,
                consentMode: res.value.consent[controllerKey]?.mode,
              }
            : null;
        })
        .toEqual({
          helperRunning: true,
          bridgeState: 'control',
          controlAvailable: true,
          shellUntilRevoked: true,
          consentMode: 'full',
        });

      await second.page.locator('input[name="serverInput"]').click();
      const revoked = await second.page.evaluate(async () => {
        const api = window.mindroomDesktop?.desktopAccess;
        if (!api) throw new Error('desktopAccess bridge missing');
        return api.revokeAll();
      });
      expect(revoked.ok).toBe(true);
      if (!revoked.ok) throw new Error('revokeAll failed');
      expect(revoked.value.consent).toEqual({});
      expect(revoked.value.status?.config.controllers).toEqual([]);
      expect(revoked.value.status?.bridge.state).toBe('stopped');
      expect(revoked.value.status?.authority.control_available).toBe(false);
      expect(revoked.value.status?.shell.auto_approve_until_revoked).toBe(false);

      expect(fs.statSync(consentPath).mode & 0o777).toBe(0o600);
      const clearedConsent = JSON.parse(fs.readFileSync(consentPath, 'utf8')) as {
        controllers: Record<string, unknown>;
      };
      expect(clearedConsent.controllers).toEqual({});
    } finally {
      await second.close();
    }

    // 3. Relaunch after revokeAll stays cleanly revoked and stopped.
    const third = await launchDesktop({
      offline: true,
      userData,
      desktopHelperBin: FAKE_HELPER_BIN,
    });
    try {
      await waitForLoginScreen(third.page);
      await expect
        .poll(async () => {
          const res = await third.page.evaluate(() =>
            window.mindroomDesktop?.desktopAccess?.status()
          );
          return res && res.ok
            ? {
                consent: res.value.consent,
                controllers: res.value.status?.config.controllers ?? [],
                enabled: res.value.status?.config.enabled ?? false,
                bridgeState: res.value.status?.bridge.state ?? 'stopped',
                controlAvailable: res.value.status?.authority.control_available ?? false,
                shellUntilRevoked: res.value.status?.shell.auto_approve_until_revoked ?? false,
              }
            : null;
        })
        .toEqual({
          consent: {},
          controllers: [],
          enabled: false,
          bridgeState: 'stopped',
          controlAvailable: false,
          shellUntilRevoked: false,
        });
    } finally {
      await third.close();
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('pending shell command opens floating /shell-approval/ window with escaped text, 1s arming delay, and hides on approve', async () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-desktop-shell-storage-'));
  try {
    const session = await launchDesktop({
      offline: true,
      desktopHelperBin: FAKE_HELPER_BIN,
      desktopStoragePath: storageDir,
    });
    try {
      const { app, page } = session;
      await waitForLoginScreen(page);

      // No floating approval window exists until a shell command is pending.
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1
      );

      const setup = await runSingleClickSetup(page, 'restricted');
      expect(setup.finishResult.ok).toBe(true);

      await page.locator('input[name="serverInput"]').focus();

      const commandId = 'cmd-demo-escape-1';
      const rawCommand = "echo hello\nprintf '\u001b[31mDemo Mac\u001b[0m'\t# check";
      const expectedEscapedCommand = "echo hello\\nprintf '\\x1b[31mDemo Mac\\x1b[0m'\\t# check";

      const approvalWinPromise = app.waitForEvent('window');
      writeJsonAtomic(path.join(storageDir, 'pending-shell.json'), {
        command_id: commandId,
        command: rawCommand,
        cwd: DEMO_PROJECT_ROOT,
        requester_id: DEMO_USER_ID,
        agent_name: DEMO_AGENT_NAME,
        controller_key: setup.controllerKey,
      });

      const approvalPage = await approvalWinPromise;
      await session.watchPage(approvalPage);
      await approvalPage.waitForURL(SHELL_APPROVAL_URL);
      await approvalPage.waitForLoadState('domcontentloaded');

      // Control characters, ANSI escapes, and tabs are visibly escaped.
      await expect(approvalPage.getByTestId('shell-approval-command')).toHaveText(
        expectedEscapedCommand
      );

      // Read all button states in one evaluation so slow CI runners cannot outrun the 1 s delay.
      const initialButtons = await approvalPage.evaluate(() =>
        Array.from(document.querySelectorAll('button')).map((btn) => ({
          text: btn.textContent?.trim() ?? '',
          disabled: btn.disabled,
        }))
      );
      expect(initialButtons).toContainEqual({
        text: expect.stringMatching(/^Approve once \(\d+\.\ds\)$/),
        disabled: true,
      });
      expect(initialButtons).toContainEqual({
        text: expect.stringMatching(/^Auto-approve 15 min \(\d+\.\ds\)$/),
        disabled: true,
      });
      expect(initialButtons).toContainEqual({
        text: 'Deny',
        disabled: false,
      });

      await expect(approvalPage.getByTestId('shell-approval-cwd')).toHaveText(DEMO_PROJECT_ROOT);
      await expect(approvalPage.getByTestId('shell-approval-actor')).toContainText(DEMO_AGENT_NAME);

      // The floating approval window shows without stealing focus.
      await expect
        .poll(() => shellApprovalWindowState(app))
        .toEqual({ exists: true, visible: true, focused: false });

      // Programmatic decideShell without a click/key gesture is rejected.
      const unclickedDecision = await approvalPage.evaluate((id) => {
        const api = window.mindroomDesktop?.shellApproval;
        if (!api) throw new Error('shellApproval bridge missing');
        return api.decideShell({ commandId: id, approved: true });
      }, commandId);
      expect(unclickedDecision).toEqual({ ok: false, code: 'NO_USER_GESTURE' });

      // After the 1 s arming delay elapses, Approve once becomes enabled.
      const armedApproveBtn = approvalPage.getByRole('button', {
        name: 'Approve once',
        exact: true,
      });
      await expect(armedApproveBtn).toBeEnabled({ timeout: 5_000 });

      await armedApproveBtn.click();

      // Approving resolves the pending command and hides the floating window.
      await expect
        .poll(() => shellApprovalWindowState(app))
        .toMatchObject({ exists: true, visible: false });

      const statusAfter = await page.evaluate(async () => {
        const api = window.mindroomDesktop?.desktopAccess;
        if (!api) throw new Error('desktopAccess bridge missing');
        return api.status();
      });
      expect(statusAfter.ok).toBe(true);
      if (statusAfter.ok) {
        expect(statusAfter.value.status?.shell.pending).toBeNull();
      }

      const decisionsPath = path.join(storageDir, 'shell-decisions.jsonl');
      expect(fs.existsSync(decisionsPath)).toBe(true);
      const decisions = fs
        .readFileSync(decisionsPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { command_id: string; approved: boolean });
      expect(decisions).toContainEqual(
        expect.objectContaining({ command_id: commandId, approved: true })
      );
    } finally {
      await session.close();
    }
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});
