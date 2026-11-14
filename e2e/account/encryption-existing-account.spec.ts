import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { buildLoginPath } from '../env';
import { setUpRecoveryPassword } from '../helpers/recovery';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A second, fresh session of an account that already has cross-signing, secret storage and a
// key backup, against the disposable homeserver of `just hs-up`. Neither "Enable" nor the
// recovery key may replace what the account has:
// - "Enable" shows while the session has not heard of the account's keys yet (its own first
//   `/keys/query` is held back here). It must ask the server and show the reset warning.
// - A recovery key whose secret storage holds no cross-signing keys must stop with an error,
//   not create new keys and write them into secret storage.
const PASSWORD = 'existing-account-spec-password';
const RECOVERY_PASSWORD = 'e2e recovery password 1';

type Call = { method?: 'GET' | 'POST' | 'PUT'; token?: string; body?: unknown };

const api = async <T>(path: string, { method, token, body }: Call = {}): Promise<T> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

type KeysQuery = { master_keys?: Record<string, { keys: Record<string, string> }> };

/** The account's published cross-signing master key, as the server has it. */
const masterKey = async (token: string, userId: string) =>
  (await api<KeysQuery>('/keys/query', { token, body: { device_keys: { [userId]: [] } } }))
    .master_keys?.[userId]?.keys;

/** An account data event's content; `null` when the server holds none (Tuwunel drops `{}`). */
const accountData = async (
  token: string,
  userId: string,
  type: string
): Promise<Record<string, unknown> | null> => {
  const path = `/user/${encodeURIComponent(userId)}/account_data/${encodeURIComponent(type)}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return null;
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as Record<string, unknown>;
};

const signIn = async (
  browser: Browser,
  username: string,
  prepare?: (page: Page) => Promise<void>
) => {
  const page = await (await browser.newContext()).newPage();
  await prepare?.(page);
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return page;
};

const openDevices = async (page: Page) => {
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
  await expect(page.getByText('Security', { exact: true })).toBeVisible();
};

/**
 * Holds the session's own device list queries (an empty device list for a user) until
 * `release()`, so the session does not know the account's cross-signing keys. Startup's check of
 * this one device passes, and so does every query after `release()`.
 */
const holdOwnKeyQueries = (page: Page) => {
  let released = false;
  const held: Route[] = [];
  const ready = page.route('**/_matrix/client/*/keys/query', async (route) => {
    const body = route.request().postDataJSON() as { device_keys?: Record<string, string[]> };
    const lists = Object.values(body.device_keys ?? {});
    if (!released && lists.length > 0 && lists.every((list) => list.length === 0)) {
      held.push(route);
      return;
    }
    await route.continue();
  });
  return {
    ready,
    release: () => {
      released = true;
    },
    heldCount: () => held.length,
  };
};

test('a second session never replaces an account that already has its encryption set up', async ({
  browser,
}) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(300_000);

  const username = `existing_${Date.now().toString(36)}`;
  const { access_token: token, user_id: userId } = await api<{
    access_token: string;
    user_id: string;
  }>('/register', {
    body: { username, password: PASSWORD, auth: { type: 'm.login.dummy' } },
  });

  // Session A sets up cross-signing, secret storage and key backup; Enable finds none on the
  // server, so it goes straight to the setup.
  const first = await signIn(browser, username);
  await openDevices(first);
  await first.getByRole('button', { name: 'Enable' }).click();
  const recoveryKey = await setUpRecoveryPassword(first, RECOVERY_PASSWORD);
  await expect(first.getByText(/Connected · Version: \S+ · Keys: \d+/)).toBeVisible({
    timeout: 30_000,
  });
  await first.context().close();

  const originalMaster = await masterKey(token, userId);
  expect(originalMaster).toBeTruthy();
  const { version: backupVersion } = await api<{ version: string }>('/room_keys/version', {
    token,
  });

  // Session B has not heard of the account's keys yet, so it offers "Enable".
  let hold: ReturnType<typeof holdOwnKeyQueries> | undefined;
  const second = await signIn(browser, username, async (page) => {
    hold = holdOwnKeyQueries(page);
    await hold.ready;
  });
  await openDevices(second);
  const enable = second.getByRole('button', { name: 'Enable' });
  await expect(enable).toBeVisible({ timeout: 30_000 });
  expect(hold?.heldCount()).toBeGreaterThan(0);

  // The click asks the server, which knows the keys: the reset warning, not the setup.
  hold?.release();
  await enable.click();
  const warning = second.getByRole('alertdialog');
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await expect(warning.getByText('Resetting device verification is permanent.')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await second.keyboard.press('Escape');
  await expect(warning).toHaveCount(0);
  await second.context().close();

  expect(await masterKey(token, userId)).toEqual(originalMaster);
  expect((await api<{ version: string }>('/room_keys/version', { token })).version).toBe(
    backupVersion
  );

  // Secret storage now holds the backup key but no cross-signing master key, as an account set
  // up only for backup does.
  expect((await accountData(token, userId, 'm.cross_signing.master'))?.encrypted).toBeTruthy();
  await api(`/user/${encodeURIComponent(userId)}/account_data/m.cross_signing.master`, {
    method: 'PUT',
    token,
    body: {},
  });

  // Session C tries the recovery key: it stops with an error and changes nothing.
  const third = await signIn(browser, username);
  await openDevices(third);
  await third.getByRole('button', { name: 'Use recovery password' }).click({ timeout: 30_000 });
  await third.locator('input[name="recoveryInput"]').fill(recoveryKey);
  await third.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(
    third.getByText(
      "Your secret storage holds no cross-signing keys, so the recovery key can't verify this session. Verify it from one of your other sessions."
    )
  ).toBeVisible({ timeout: 30_000 });
  await expect(third.getByRole('button', { name: 'Unverified Device' })).toBeVisible();

  // A reset would have written a newly encrypted master key there.
  expect((await accountData(token, userId, 'm.cross_signing.master'))?.encrypted).toBeUndefined();
  expect(await masterKey(token, userId)).toEqual(originalMaster);
  await third.context().close();
});
