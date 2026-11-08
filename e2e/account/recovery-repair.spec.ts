import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { buildLoginPath } from '../env';
import { setUpRecoveryPassword, unlockWithRecovery } from '../helpers/recovery';

// An account whose secret storage holds cross-signing keys the server never published: a reset
// writes its new keys into secret storage before it publishes them, and here the account password
// prompt of that publish is closed. The recovery password still opens secret storage, but the
// identity in it is not the account's, so unlocking stops. Repair keeps the history and the
// password and gives the account a new identity.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const ACCOUNT_PASSWORD = 'recovery-repair-account-password';
const FIRST_PASSWORD = 'tangerine mill noon 42';
const RESET_PASSWORD = 'orange river dusk 77';
const MESSAGE = 'The launch code is tangerine';
const MISMATCH = "doesn't match the public key that was uploaded to the server";

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

const matrix = async <T>(path: string, init: { token?: string; body?: unknown } = {}) => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: init.body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

type Account = { username: string; userId: string; roomId: string };

/** Registers the account and creates an encrypted room through a session without crypto. */
const createAccountWithEncryptedRoom = async (): Promise<Account> => {
  const username = `repair_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { access_token: token, user_id: userId } = await matrix<{
    access_token: string;
    user_id: string;
  }>('/register', {
    body: { username, password: ACCOUNT_PASSWORD, auth: { type: 'm.login.dummy' } },
  });
  const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
    token,
    body: {
      name: 'Secret Plans',
      preset: 'private_chat',
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      ],
    },
  });
  await matrix('/logout', { token, body: {} });
  return { username, userId, roomId };
};

/** The published master key, asked of the server with a session of its own. */
const publishedMasterKey = async (account: Account): Promise<string> => {
  const { access_token: token } = await matrix<{ access_token: string }>('/login', {
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: account.username },
      password: ACCOUNT_PASSWORD,
    },
  });
  const keys = await matrix<{ master_keys?: Record<string, { keys: Record<string, string> }> }>(
    '/keys/query',
    { token, body: { device_keys: { [account.userId]: [] } } }
  );
  await matrix('/logout', { token, body: {} });
  return Object.values(keys.master_keys?.[account.userId]?.keys ?? {})[0] ?? '';
};

/** A browser context whose served config.json asks for the recovery dialogs at start. */
const signIn = async (browser: Browser, username: string): Promise<Page> => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...config, encryptionRecovery: { promptAtStart: true } },
    });
  });
  const page = await context.newPage();
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: ACCOUNT_PASSWORD });
  return page;
};

const unlockDialog = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: 'Unlock your messages' });

const openFullRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 30_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();
};

const openSecurity = async (page: Page) => {
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  test.setTimeout(420_000);
});

test('repair gives an account whose stored identity was never published a new one, keeping its history', async ({
  browser,
}) => {
  const account = await createAccountWithEncryptedRoom();
  const first = await signIn(browser, account.username);
  await expect(
    first.getByRole('dialog').filter({ hasText: 'Set up your recovery password' })
  ).toBeVisible({ timeout: 90_000 });
  await setUpRecoveryPassword(first, FIRST_PASSWORD, ACCOUNT_PASSWORD);
  await openFullRoom(first, account.roomId);
  const composer = first.locator('[data-editable-name="RoomInput"]');
  await composer.click();
  await first.keyboard.type(MESSAGE);
  await first.keyboard.press('Enter');
  await expect(first.locator('[data-pending-send-icon]')).toHaveCount(0, { timeout: 30_000 });
  const publishedBefore = await publishedMasterKey(account);

  // A reset whose account password prompt is closed: its new keys reach secret storage only.
  await openSecurity(first);
  await first.getByRole('button', { name: 'Reset', exact: true }).click({ timeout: 30_000 });
  await first.getByRole('alertdialog').getByRole('button', { name: 'Reset' }).click();
  const setup = first.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
  await setup.locator('input[name="recoveryPasswordInput"]').fill(RESET_PASSWORD);
  await setup.locator('input[name="recoveryPasswordConfirmInput"]').fill(RESET_PASSWORD);
  await setup.getByRole('button', { name: 'Continue' }).click();
  await expect(first.locator('input[name="passwordInput"]')).toBeVisible({ timeout: 60_000 });
  await first.keyboard.press('Escape');
  await expect(first.locator('input[name="passwordInput"]')).toHaveCount(0);
  await expect(setup.getByText('Unexpected Error!')).toBeVisible({ timeout: 30_000 });
  expect(await publishedMasterKey(account)).toBe(publishedBefore);
  // The glass dialog never reads as stable to Playwright here, so the click is dispatched.
  await setup.getByRole('button', { name: 'Not now' }).dispatchEvent('click');
  await expect(setup).toHaveCount(0);
  // Settings is still open: the reset's new backup holds the room keys of this session.
  await expect(first.getByText(/Connected · Version: \S+ · Keys: [1-9]/)).toBeVisible({
    timeout: 60_000,
  });

  // A fresh browser: the reset's password opens secret storage, but its identity is not the
  // account's. Repair publishes a new one under the same password and restores the history.
  const second = await signIn(browser, account.username);
  const dialog = unlockDialog(second);
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  await dialog.locator('input[name="recoveryInput"]').fill(RESET_PASSWORD);
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click();
  const repair = dialog.getByRole('button', { name: 'Repair encryption' });
  await expect(repair).toBeVisible({ timeout: 60_000 });
  // The SDK's own words give way to an explanation.
  await expect(dialog.getByText(MISMATCH)).toHaveCount(0);
  await repair.click();
  const prompt = second.locator('input[name="passwordInput"]');
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  await prompt.fill(ACCOUNT_PASSWORD);
  await prompt.press('Enter');
  await expect(dialog.getByText('This device is verified.')).toBeVisible({ timeout: 60_000 });
  const publishedAfter = await publishedMasterKey(account);
  expect(publishedAfter).toBeTruthy();
  expect(publishedAfter).not.toBe(publishedBefore);
  await second.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  await openFullRoom(second, account.roomId);
  await expect(second.getByRole('main').getByText(MESSAGE)).toBeVisible({ timeout: 60_000 });

  // The repaired secret storage now unlocks a third browser the ordinary way.
  const third = await signIn(browser, account.username);
  const thirdDialog = unlockDialog(third);
  await expect(thirdDialog).toBeVisible({ timeout: 90_000 });
  await unlockWithRecovery(thirdDialog, RESET_PASSWORD);
});
