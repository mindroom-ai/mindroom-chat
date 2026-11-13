import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { buildLoginPath } from '../env';
import { setUpRecoveryPassword, unlockWithRecovery } from '../helpers/recovery';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The recovery password story in a real browser against the disposable homeserver: the start
// prompt asks a new account for one, a fresh browser unlocks with it (or with the recovery key),
// a change replaces it, and the secret storage the client writes is the Matrix passphrase format.
const ACCOUNT_PASSWORD = 'recovery-spec-account-password';
const RECOVERY_PASSWORD = 'tangerine mill noon 42';
const NEW_RECOVERY_PASSWORD = 'orange river dusk 77';
const MESSAGE = 'The launch code is tangerine';
const WRONG = 'That recovery password or key is not right.';

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
  const username = `recovery_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username,
    password: ACCOUNT_PASSWORD,
  });
  return page;
};

const setUpDialog = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
const unlockDialog = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: 'Unlock your messages' });

/** The first sign-in of the account: Set up opens by itself and is completed. */
const firstSession = async (browser: Browser, account: Account) => {
  const page = await signIn(browser, account.username);
  await expect(setUpDialog(page)).toBeVisible({ timeout: 90_000 });
  const recoveryKey = await setUpRecoveryPassword(page, RECOVERY_PASSWORD, ACCOUNT_PASSWORD);
  await expect(setUpDialog(page)).toHaveCount(0);
  return { page, recoveryKey };
};

/** A later fresh browser: Unlock opens by itself; it unlocks with `secret` and is closed. */
const unlockedSession = async (browser: Browser, account: Account, secret: string) => {
  const page = await signIn(browser, account.username);
  const dialog = unlockDialog(page);
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  await unlockWithRecovery(dialog, secret);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  return page;
};

/** Opens the room in the Full view, where each message is its own row. */
const openFullRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 30_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();
};

const sendMessage = async (page: Page, roomId: string, text: string) => {
  await openFullRoom(page, roomId);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await composer.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(composer).not.toContainText(text);
  await expect(page.getByText(text)).toBeVisible();
  await expect(page.locator('[data-pending-send-icon]')).toHaveCount(0, { timeout: 30_000 });
};

/** Waits until the key backup holds the room keys, so a fresh device can fetch them. */
const waitForBackedUpKeys = async (page: Page) => {
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
  await expect(page.getByText(/Connected · Version: \S+ · Keys: [1-9]/)).toBeVisible({
    timeout: 60_000,
  });
  await page.keyboard.press('Escape');
};

/** Settings, Privacy & security, the Recovery password tile's Change. */
const openChange = async (page: Page): Promise<Locator> => {
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
  await page
    .getByText('Unlocks your encrypted messages on a new device or after clearing this browser.')
    .locator('xpath=ancestor::*[.//button[normalize-space()="Change"]][1]')
    .getByRole('button', { name: 'Change', exact: true })
    .click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Change your recovery password' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(420_000);
});

test('a new account is asked for a recovery password and a fresh browser unlocks with it', async ({
  browser,
}) => {
  const account = await createAccountWithEncryptedRoom();
  const { page: first } = await firstSession(browser, account);
  await sendMessage(first, account.roomId, MESSAGE);
  await waitForBackedUpKeys(first);

  const second = await signIn(browser, account.username);
  const dialog = unlockDialog(second);
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  await unlockWithRecovery(dialog, `  ${RECOVERY_PASSWORD}  `);
  await second.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  await openFullRoom(second, account.roomId);
  await expect(second.getByRole('main').getByText(MESSAGE)).toBeVisible({ timeout: 60_000 });
});

test('a changed password replaces the old one', async ({ browser }) => {
  const account = await createAccountWithEncryptedRoom();
  const { page: first } = await firstSession(browser, account);
  await sendMessage(first, account.roomId, MESSAGE);
  await waitForBackedUpKeys(first);

  const change = await openChange(first);
  const current = change.locator('input[name="recoveryInput"]');
  // Settings always asks for the current password first.
  await expect(current).toBeVisible();
  await current.fill(RECOVERY_PASSWORD);
  await change.getByRole('button', { name: 'Continue' }).click();
  await change.locator('input[name="recoveryPasswordInput"]').fill(NEW_RECOVERY_PASSWORD);
  await change.locator('input[name="recoveryPasswordConfirmInput"]').fill(NEW_RECOVERY_PASSWORD);
  await change.getByRole('button', { name: 'Change', exact: true }).click();
  await change
    .getByRole('checkbox', { name: 'I saved my recovery password' })
    .check({ timeout: 60_000 });
  await change.getByRole('button', { name: 'Done' }).click();
  await expect(change).toHaveCount(0);

  const third = await signIn(browser, account.username);
  const dialog = unlockDialog(third);
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  await dialog.locator('input[name="recoveryInput"]').fill(RECOVERY_PASSWORD);
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(dialog.getByText(WRONG)).toBeVisible({ timeout: 60_000 });
  await dialog.locator('input[name="recoveryInput"]').fill('');
  await unlockWithRecovery(dialog, NEW_RECOVERY_PASSWORD);
  await third.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  await openFullRoom(third, account.roomId);
  await expect(third.getByRole('main').getByText(MESSAGE)).toBeVisible({ timeout: 60_000 });
});

test('the recovery key, without its spaces and padded, unlocks in the same field', async ({
  browser,
}) => {
  const account = await createAccountWithEncryptedRoom();
  const { page: first, recoveryKey } = await firstSession(browser, account);
  await sendMessage(first, account.roomId, MESSAGE);
  await waitForBackedUpKeys(first);

  const second = await unlockedSession(browser, account, `  ${recoveryKey.replace(/ /g, '')}  `);
  await openFullRoom(second, account.roomId);
  await expect(second.getByRole('main').getByText(MESSAGE)).toBeVisible({ timeout: 60_000 });
});

test('secret storage uses the Matrix passphrase format', async ({ browser }) => {
  const account = await createAccountWithEncryptedRoom();
  await firstSession(browser, account);

  const { access_token: token } = await matrix<{ access_token: string }>('/login', {
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: account.username },
      password: ACCOUNT_PASSWORD,
    },
  });
  const user = encodeURIComponent(account.userId);
  const { key: keyId } = await matrix<{ key: string }>(
    `/user/${user}/account_data/m.secret_storage.default_key`,
    { token }
  );
  const keyInfo = await matrix<{
    algorithm: string;
    passphrase: { algorithm: string; iterations: number };
  }>(`/user/${user}/account_data/${encodeURIComponent(`m.secret_storage.key.${keyId}`)}`, {
    token,
  });
  expect(keyInfo.algorithm).toBe('m.secret_storage.v1.aes-hmac-sha2');
  expect(keyInfo.passphrase.algorithm).toBe('m.pbkdf2');
  expect(keyInfo.passphrase.iterations).toBe(500_000);
  const backup = await matrix<{ algorithm: string }>('/room_keys/version', { token });
  expect(backup.algorithm).toBe('m.megolm_backup.v1.curve25519-aes-sha2');
});
