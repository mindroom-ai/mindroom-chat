import { expect, type Page } from '@playwright/test';
import { loginToMatrix, type MatrixSession } from './matrix';

/**
 * Accounts on the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh,
 * which allows open registration. Specs register their own users, so they share nothing.
 */
export const DISPOSABLE_HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;

/** The launch options of playwright.config.ts, with scrollbars shown as people see them. */
export const CHROMIUM_WITH_SCROLLBARS = {
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--disable-features=IsolateSandboxedIframes'],
  ignoreDefaultArgs: ['--hide-scrollbars'],
};

export const disposableHomeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${DISPOSABLE_HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export type DisposableUser = MatrixSession & { username: string; password: string };

/** Registers `username` with `password` and signs it in through the API. */
export const registerDisposableUser = async (
  username: string,
  password: string
): Promise<DisposableUser> => {
  const response = await fetch(`${DISPOSABLE_HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  const session = await loginToMatrix(DISPOSABLE_HOMESERVER, username, password);
  return { ...session, username, password };
};

/** Saves a screenshot as `<name>.png` when ACCOUNT_SESSION_SHOTS names a directory. */
export const accountSessionShot = async (page: Page, name: string): Promise<void> => {
  const directory = process.env.ACCOUNT_SESSION_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};
