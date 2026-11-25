import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MAIN_ENTRY = path.join(ROOT, 'build/electron/main.cjs');

export type LaunchDesktopOptions = {
  dist?: string;
  userData?: string;
  offline?: boolean;
  screenShare?: boolean;
  fakeMedia?: boolean;
  helper?: string;
  desktopHelperBin?: string;
  desktopStoragePath?: string;
};

export type DesktopSession = {
  app: ElectronApplication;
  page: Page;
  userData: string;
  violations: string[];
  expectViolations: (run: () => Promise<void>) => Promise<string[]>;
  watchPage: (extraPage: Page) => Promise<void>;
  close: () => Promise<void>;
};

const launchedSessions: DesktopSession[] = [];

/** Call from each Electron spec file's `test.afterEach` so every spec enforces zero unexpected main-frame CSP violations. */
export const assertNoUnexpectedViolations = (): void => {
  const unexpected = launchedSessions.splice(0).flatMap((session) => session.violations);
  expect(unexpected, 'unexpected main-frame CSP violations').toEqual([]);
};

const installViolationHook = (): void => {
  const win = window as unknown as {
    __mindroomCspHooked?: boolean;
    __mindroomCspViolation?: (detail: string) => void;
  };
  if (window !== window.top || win.__mindroomCspHooked) return;
  win.__mindroomCspHooked = true;
  window.addEventListener(
    'securitypolicyviolation',
    (event) => {
      const detail = `${event.effectiveDirective || event.violatedDirective}: ${
        event.blockedURI || 'inline'
      }`;
      win.__mindroomCspViolation?.(detail);
    },
    true
  );
};

type CspAuditIssue = {
  code?: string;
  details?: {
    contentSecurityPolicyIssueDetails?: {
      violatedDirective?: string;
      blockedURL?: string;
      isReportOnly?: boolean;
      sourceCodeLocation?: { url?: string };
    };
  };
};

export const launchDesktop = async (options?: LaunchDesktopOptions): Promise<DesktopSession> => {
  const ownsUserData = !options?.userData;
  const userData =
    options?.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-desktop-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      key !== 'ELECTRON_RUN_AS_NODE' &&
      key !== 'MINDROOM_DESKTOP_HELPER_BIN' &&
      key !== 'MINDROOM_DESKTOP_STORAGE_PATH' &&
      key !== 'MINDROOM_DESKTOP_CONFIG_PATH'
    ) {
      env[key] = value;
    }
  }
  env.MINDROOM_DESKTOP_TEST = '1';
  env.MINDROOM_DESKTOP_USER_DATA = userData;
  if (options?.dist) env.MINDROOM_DESKTOP_DIST = options.dist;
  if (options?.offline) env.MINDROOM_DESKTOP_OFFLINE = '1';
  if (options?.helper) env.MINDROOM_DESKTOP_HELPER = options.helper;
  if (options?.desktopHelperBin) env.MINDROOM_DESKTOP_HELPER_BIN = options.desktopHelperBin;
  if (options?.desktopStoragePath) env.MINDROOM_DESKTOP_STORAGE_PATH = options.desktopStoragePath;
  if (options?.screenShare !== undefined) {
    env.MINDROOM_DESKTOP_SCREEN_SHARE = options.screenShare ? '1' : '0';
  }

  const args = [MAIN_ENTRY];
  if (options?.fakeMedia) {
    args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream');
  }
  if (process.platform === 'linux' && process.env.MINDROOM_E2E_NO_SANDBOX === '1') {
    args.push('--no-sandbox');
  }

  const app = await electron.launch({ args, env });
  const page = await app.firstWindow();

  const violations: string[] = [];
  let expectedBucket: string[] | null = null;
  const record = (detail: string): void => {
    if (expectedBucket !== null) expectedBucket.push(detail);
    else violations.push(detail);
  };

  const watchPage = async (target: Page): Promise<void> => {
    let domListenerReady = false;
    const cdp = await target.context().newCDPSession(target);
    cdp.on('Audits.issueAdded', ({ issue }: { issue?: CspAuditIssue }) => {
      if (domListenerReady || issue?.code !== 'ContentSecurityPolicyIssue') return;
      const d = issue.details?.contentSecurityPolicyIssueDetails;
      if (!d || d.isReportOnly) return;
      const src = d.sourceCodeLocation?.url ?? '';
      if (
        src.includes('canvas-frame.html') ||
        src.includes('pdf-frame.html') ||
        src === 'about:srcdoc'
      )
        return;
      record(`${d.violatedDirective ?? 'unknown'}: ${d.blockedURL || 'inline'}`);
    });
    await cdp.send('Audits.enable');

    await target.exposeBinding('__mindroomCspViolation', ({ frame }, detail: string) => {
      // One collector at a time: CDP until the page hook is confirmed, then only the hook.
      if (domListenerReady && frame === target.mainFrame()) record(detail);
    });
    await target.addInitScript(installViolationHook);
    await target.evaluate(installViolationHook).catch(() => undefined);
    // Hand over to the page listener only once it is in place; until then CDP auditing keeps watching.
    const hooked = await target
      .evaluate(() => (window as { __mindroomCspHooked?: boolean }).__mindroomCspHooked === true)
      .catch(() => false);
    if (hooked) {
      domListenerReady = true;
      await cdp.send('Audits.disable').catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    }
  };

  await watchPage(page);

  await page.waitForLoadState('domcontentloaded');

  const expectViolations = async (run: () => Promise<void>): Promise<string[]> => {
    const bucket: string[] = [];
    expectedBucket = bucket;
    try {
      await run();
      if (!page.isClosed()) {
        await page
          .evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)))
          .catch(() => undefined);
      }
      return bucket;
    } finally {
      expectedBucket = null;
    }
  };

  const close = async (): Promise<void> => {
    try {
      if (!page.isClosed()) {
        await page
          .evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
          .catch(() => undefined);
      }
      await app.close();
    } finally {
      if (ownsUserData) {
        fs.rmSync(userData, { recursive: true, force: true });
      }
    }
  };

  const session: DesktopSession = {
    app,
    page,
    userData,
    violations,
    expectViolations,
    watchPage,
    close,
  };
  launchedSessions.push(session);
  return session;
};
