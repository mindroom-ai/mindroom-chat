import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { buildLoginPath } from '../env';
import { setUpRecoveryPassword, unlockWithRecovery } from '../helpers/recovery';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// End-to-end encryption between sessions of one account, against the disposable homeserver of
// `just hs-up`: the first session sets up cross-signing, secret storage and key backup; a second
// sign-in cannot read the history until the first session verifies it by emoji; a third unlocks
// it with the recovery key; the rows that could not be decrypted fix themselves each time.
const PASSWORD = 'encryption-spec-password';
const RECOVERY_PASSWORD = 'e2e recovery password 1';
const SECRETS = ['The launch code is tangerine', 'Meet at the old mill at noon'];
const UNDECRYPTABLE = "Couldn't decrypt this message — the encryption key isn't available";

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

/** Registers the account and creates an encrypted room through a session without crypto. */
const createAccountWithEncryptedRoom = async (username: string): Promise<string> => {
  const { access_token: token } = await matrix<{ access_token: string }>('/register', {
    body: { username, password: PASSWORD, auth: { type: 'm.login.dummy' } },
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
  // Signed out again, so the device list only holds the browser sessions.
  await matrix('/logout', { token, body: {} });
  return roomId;
};

const signIn = async (browser: Browser, username: string): Promise<Page> => {
  const page = await (await browser.newContext()).newPage();
  // A first load on a busy machine can take longer than the sign-in helper waits.
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

const closeSettings = (page: Page) => page.keyboard.press('Escape');

/** Opens the room in the Full view, where each message is its own row. */
const openFullRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 30_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();
};

const emojiShown = (page: Page) =>
  page
    .getByRole('dialog')
    .getByRole('listitem')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('aria-label')));

test('sessions verify each other by emoji or recovery key and then read the history', async ({
  browser,
}) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(300_000);

  const username = `crypto_${Date.now().toString(36)}`;
  const roomId = await createAccountWithEncryptedRoom(username);

  // Session A sets up device verification and receives its recovery key once.
  const first = await signIn(browser, username);
  await openDevices(first);
  await first.getByRole('button', { name: 'Enable' }).click();
  const recoveryKey = await setUpRecoveryPassword(first, RECOVERY_PASSWORD);
  await expect(first.getByText(/Connected · Version: \S+ · Keys: \d+/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(first.getByText('Verified', { exact: true })).toBeVisible();
  await closeSettings(first);

  await openFullRoom(first, roomId);
  const composer = first.locator('[data-editable-name="RoomInput"]');
  for (const secret of SECRETS) {
    await composer.click();
    await first.keyboard.type(secret);
    await first.keyboard.press('Enter');
    // Sent: the composer is empty again, so the text found is the message, not the draft.
    await expect(composer).not.toContainText(secret);
    await expect(first.getByText(secret)).toBeVisible();
    // The composer ignores Enter while the previous message is still going out (its draft stays),
    // so the next secret waits until this one has left.
    await expect(first.locator('[data-pending-send-icon]')).toHaveCount(0, { timeout: 30_000 });
  }
  // A uploads new keys to the backup after a random delay of up to 10 s, and B looks for a
  // missing key there only once, right after verification; so the history is in the backup first.
  await openDevices(first);
  await expect(first.getByText(/Connected · Version: \S+ · Keys: [1-9]/)).toBeVisible({
    timeout: 30_000,
  });
  await closeSettings(first);

  // Session B signs in later, so it holds no key for that history.
  const second = await signIn(browser, username);
  await expect(second.getByRole('button', { name: 'Unverified Device' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(second.getByRole('region', { name: 'Unverified Device' })).toBeVisible();
  await openFullRoom(second, roomId);
  await expect(second.getByText(UNDECRYPTABLE)).toHaveCount(2, { timeout: 30_000 });

  // B asks; A accepts; both compare the same seven emoji.
  await openDevices(second);
  await second.getByRole('button', { name: 'Verify', exact: true }).click();
  await first.getByRole('button', { name: 'Accept' }).click({ timeout: 30_000 });
  await expect(second.getByRole('button', { name: 'They Match' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(first.getByRole('button', { name: 'They Match' })).toBeVisible();
  const emoji = await emojiShown(second);
  expect(emoji).toHaveLength(7);
  expect(await emojiShown(first)).toEqual(emoji);
  await second.getByRole('button', { name: 'They Match' }).click();
  await first.getByRole('button', { name: 'They Match' }).click();
  await expect(second.getByText('Your device is verified.')).toBeVisible({ timeout: 30_000 });
  await expect(first.getByText('Your device is verified.')).toBeVisible();
  await second.getByRole('button', { name: 'Okay' }).click();
  await first.getByRole('button', { name: 'Okay' }).click();

  // The shield goes away, and A's key backup key reaches B, which fetches the missing keys.
  await expect(second.getByRole('button', { name: 'Unverified Device' })).toHaveCount(0);
  await closeSettings(second);
  for (const secret of SECRETS) {
    await expect(second.getByText(secret)).toBeVisible({ timeout: 60_000 });
  }
  await expect(second.getByText(UNDECRYPTABLE)).toHaveCount(0);

  // Session C has no verified session at hand and unlocks secret storage with the recovery key.
  const third = await signIn(browser, username);
  await openFullRoom(third, roomId);
  await expect(third.getByText(UNDECRYPTABLE)).toHaveCount(2, { timeout: 30_000 });
  await openDevices(third);
  await third.getByRole('button', { name: 'Use recovery password' }).click();
  await unlockWithRecovery(third, recoveryKey);
  await expect(third.getByRole('button', { name: 'Unverified Device' })).toHaveCount(0, {
    timeout: 30_000,
  });

  // A full restore downloads every key in the backup.
  const restore = third.getByRole('button', { name: 'Restore Backup' });
  await expect(restore).toBeEnabled({ timeout: 30_000 });
  await restore.click();
  await expect(restore).toBeEnabled({ timeout: 60_000 });
  await closeSettings(third);
  for (const secret of SECRETS) {
    await expect(third.getByText(secret)).toBeVisible({ timeout: 60_000 });
  }
});
