import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { setUpRecoveryPassword } from '../helpers/recovery';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { buildLoginPath } from '../env';

// Reset Device Verification from a session that no longer holds the secret storage key: the
// person lost the recovery key, or simply reloaded since the setup (the key lives in memory
// only). The reset must not need the old key: it creates a new secret storage, new
// cross-signing keys and a new key backup, shows the new recovery key, and leaves this session
// verified with the new identity. Against the disposable homeserver of `just hs-up`.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'reset-verification-spec-password';
const RECOVERY_KEY = /^E\w{3}( \w{4}){11}$/;

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const api = async <T>(path: string, token?: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

type CrossSigningKey = { keys: Record<string, string> };
type KeysQuery = {
  master_keys?: Record<string, CrossSigningKey>;
  self_signing_keys?: Record<string, CrossSigningKey>;
  device_keys?: Record<
    string,
    Record<string, { signatures?: Record<string, Record<string, string>> }>
  >;
};

const masterKey = async (token: string, userId: string) =>
  (await api<KeysQuery>('/keys/query', token, { device_keys: { [userId]: [] } })).master_keys?.[
    userId
  ]?.keys;

const accountData = (token: string, userId: string, type: string) =>
  api<Record<string, unknown>>(
    `/user/${encodeURIComponent(userId)}/account_data/${encodeURIComponent(type)}`,
    token
  );

const openSecurity = async (page: Page) => {
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
  await expect(page.getByText('Security', { exact: true })).toBeVisible();
};

/**
 * Runs the setup dialog with a recovery password, answering the account password prompt when the
 * server asks for it. Resolves to the recovery key. The error the reset used to stop with fails
 * the test at once.
 */
const setUpWithPassword = async (page: Page, recoveryPassword: string) => {
  const failure = page.getByText('getSecretStorageKey callback returned falsey');
  const recoveryKey = await setUpRecoveryPassword(page, recoveryPassword, PASSWORD);
  await expect(failure).toHaveCount(0);
  expect(recoveryKey).toMatch(RECOVERY_KEY);
  return recoveryKey;
};

const resetFromFreshPage = async (browser: Browser, baseURL: string | undefined) => {
  const username = `reset_${Date.now().toString(36)}`;
  const { access_token: token, user_id: userId } = await api<{
    access_token: string;
    user_id: string;
  }>('/register', undefined, { username, password: PASSWORD, auth: { type: 'm.login.dummy' } });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL });
  try {
    const page = await context.newPage();
    await page.goto(buildLoginPath(HOMESERVER));
    await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });

    // The first setup: cross-signing, secret storage and key backup.
    await openSecurity(page);
    await page.getByRole('button', { name: 'Enable' }).click();
    const firstRecoveryKey = await setUpWithPassword(page, 'e2e recovery password 1');
    await expect(page.getByText(/Connected · Version: \S+ · Keys: \d+/)).toBeVisible({
      timeout: 30_000,
    });
    const firstMaster = await masterKey(token, userId);
    const firstStorageKey = (await accountData(token, userId, 'm.secret_storage.default_key')).key;
    expect(firstMaster).toBeTruthy();

    // A reload forgets the secret storage key, as a lost recovery key would.
    await page.reload();
    await openSecurity(page);
    await page.getByRole('button', { name: 'Reset', exact: true }).click({ timeout: 30_000 });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset' }).click();
    expect(await setUpWithPassword(page, 'e2e recovery password 2')).not.toBe(firstRecoveryKey);

    // The server has the new identity, and secret storage holds it under the new key.
    const newMaster = await masterKey(token, userId);
    expect(newMaster).toBeTruthy();
    expect(newMaster).not.toEqual(firstMaster);
    const newStorageKey = (await accountData(token, userId, 'm.secret_storage.default_key')).key;
    expect(newStorageKey).not.toBe(firstStorageKey);
    const storedMaster = await accountData(token, userId, 'm.cross_signing.master');
    expect(Object.keys((storedMaster.encrypted ?? {}) as object)).toEqual([newStorageKey]);

    // This session stays verified with the new identity: the new self-signing key signed its
    // device, and it shows no prompt to verify it again.
    const keys = await api<KeysQuery>('/keys/query', token, { device_keys: { [userId]: [] } });
    const selfSigningKeyId = Object.keys(keys.self_signing_keys?.[userId]?.keys ?? {})[0];
    const devices = Object.values(keys.device_keys?.[userId] ?? {});
    expect(devices).toHaveLength(1);
    expect(Object.keys(devices[0]?.signatures?.[userId] ?? {})).toContain(selfSigningKeyId);
    await expect(page.getByText(/Connected · Version: \S+ · Keys: \d+/)).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Unverified Device' })).toHaveCount(0, {
      timeout: 15_000,
    });
  } finally {
    await context.close();
  }
};

test.describe('Reset Device Verification', () => {
  test.beforeEach(async () => {
    test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
    test.setTimeout(300_000);
  });

  test('replaces the keys without the old recovery key (Chromium)', async ({
    browser,
    baseURL,
  }) => {
    await resetFromFreshPage(browser, baseURL);
  });

  test('replaces the keys without the old recovery key (WebKit)', async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    const browser = await launchWebKit();
    try {
      await resetFromFreshPage(browser, baseURL);
    } finally {
      await browser.close();
    }
  });
});
