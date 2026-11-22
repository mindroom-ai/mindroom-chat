import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MAIN_ENTRY = path.join(ROOT, 'build/electron/main.cjs');

export type LaunchDesktopOptions = {
  dist?: string;
  userData?: string;
  offline?: boolean;
};

export type DesktopSession = {
  app: ElectronApplication;
  page: Page;
  userData: string;
  close: () => Promise<void>;
};

export const launchDesktop = async (options?: LaunchDesktopOptions): Promise<DesktopSession> => {
  const ownsUserData = !options?.userData;
  const userData =
    options?.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-desktop-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env.MINDROOM_E2E_TEST = '1';
  env.MINDROOM_USER_DATA_DIR = userData;
  if (options?.dist) env.MINDROOM_DIST_DIR = options.dist;
  if (options?.offline) env.MINDROOM_E2E_OFFLINE = '1';

  const args = [MAIN_ENTRY];
  if (process.platform === 'linux' && process.env.MINDROOM_E2E_NO_SANDBOX === '1') {
    args.push('--no-sandbox');
  }

  const app = await electron.launch({ args, env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const close = async (): Promise<void> => {
    try {
      await app.close();
    } finally {
      if (ownsUserData) {
        fs.rmSync(userData, { recursive: true, force: true });
      }
    }
  };

  return { app, page, userData, close };
};
