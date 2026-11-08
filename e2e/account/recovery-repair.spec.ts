import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { buildLoginPath } from '../env';
import { setUpRecoveryPassword, unlockWithRecovery } from '../helpers/recovery';

// Secret storage that the server's identity does not match. A reset publishes its new identity
// before it touches secret storage or the key backup, so closing its account confirmation changes
// nothing (the first test). Other clients, and this one before that order, wrote the new keys
// into secret storage first; the second test makes that state through the API and repairs it:
// the recovery password and the backup stay, and the account gets a new identity.
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

/** Matrix canonical JSON: keys sorted at every level, no whitespace. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : 1
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const unpadded = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

/**
 * Publishes a complete cross-signing identity no client holds (master, self-signing and
 * user-signing keys, the last two signed by the first), as an interrupted reset by another client
 * leaves it: secret storage keeps the identity the client wrote, the server has another one.
 */
const publishForeignIdentity = async (account: Account): Promise<void> => {
  const { access_token: token } = await matrix<{ access_token: string }>('/login', {
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: account.username },
      password: ACCOUNT_PASSWORD,
    },
  });
  const keyPair = () => {
    const pair = generateKeyPairSync('ed25519');
    const publicKey = unpadded(
      pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
    );
    return { ...pair, publicKey: pair.publicKey, id: publicKey };
  };
  const master = keyPair();
  const crossSigningKey = (usage: string, id: string) => ({
    user_id: account.userId,
    usage: [usage],
    keys: { [`ed25519:${id}`]: id },
  });
  const signedByMaster = (usage: string) => {
    const pair = keyPair();
    const key = crossSigningKey(usage, pair.id);
    const signature = unpadded(sign(null, Buffer.from(canonicalJson(key)), master.privateKey));
    return { ...key, signatures: { [account.userId]: { [`ed25519:${master.id}`]: signature } } };
  };
  const keys = {
    master_key: crossSigningKey('master', master.id),
    self_signing_key: signedByMaster('self_signing'),
    user_signing_key: signedByMaster('user_signing'),
  };
  const upload = (auth?: unknown) =>
    fetch(`${HOMESERVER}/_matrix/client/v3/keys/device_signing/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...keys, ...(auth ? { auth } : {}) }),
    });
  const first = await upload();
  expect(first.status).toBe(401);
  const { session } = (await first.json()) as { session: string };
  const second = await upload({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: account.username },
    password: ACCOUNT_PASSWORD,
    session,
  });
  expect(second.ok, `device_signing/upload answered ${second.status}`).toBe(true);
  await matrix('/logout', { token, body: {} });
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

/** The first session: sets up the recovery password, sends a message and backs its key up. */
const firstSessionWithMessage = async (browser: Browser, account: Account): Promise<Page> => {
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
  await openSecurity(first);
  await expect(first.getByText(/Connected · Version: \S+ · Keys: [1-9]/)).toBeVisible({
    timeout: 60_000,
  });
  return first;
};

/** A fresh browser that unlocks with `password` and reads the first session's message. */
const readsHistoryAfterUnlock = async (browser: Browser, account: Account, password: string) => {
  const page = await signIn(browser, account.username);
  const dialog = unlockDialog(page);
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  await unlockWithRecovery(dialog, password);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  await openFullRoom(page, account.roomId);
  await expect(page.getByRole('main').getByText(MESSAGE)).toBeVisible({ timeout: 60_000 });
};

test('a reset whose account confirmation is closed changes nothing', async ({ browser }) => {
  const account = await createAccountWithEncryptedRoom();
  const first = await firstSessionWithMessage(browser, account);
  const publishedBefore = await publishedMasterKey(account);

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

  // The old recovery password, secret storage and backup still work in a fresh browser.
  await readsHistoryAfterUnlock(browser, account, FIRST_PASSWORD);
});

test('repair gives an account whose stored identity is not the published one a new identity, keeping its history', async ({
  browser,
}) => {
  const account = await createAccountWithEncryptedRoom();
  await firstSessionWithMessage(browser, account);
  await publishForeignIdentity(account);
  const publishedBefore = await publishedMasterKey(account);

  // A fresh browser: the password opens secret storage, but its identity is not the account's.
  const second = await signIn(browser, account.username);
  const dialog = unlockDialog(second);
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  await dialog.locator('input[name="recoveryInput"]').fill(FIRST_PASSWORD);
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

  // The repaired secret storage unlocks a third browser the ordinary way.
  await readsHistoryAfterUnlock(browser, account, FIRST_PASSWORD);
});
