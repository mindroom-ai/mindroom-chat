import { expect, test, type Page } from '@playwright/test';
import { getStoredSessionByUsername } from '../helpers/accounts';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { matrixFetch } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// "Remove from Device" in Accounts (P2-lane5-F010) logs the inactive account out as Logout does
// for the active one: it asks first, with the warning about encrypted messages, keeps the account
// on Cancel, and once confirmed the homeserver ends that account's device here, not only this
// browser's copy. Runs at desktop size in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, at phone size in WebKit, against the disposable homeserver.
// REMOVE_ACCOUNT_SHOTS=<directory> saves the confirmation.
const PASSWORD = 'remove-account-logout-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.REMOVE_ACCOUNT_SHOTS;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const deviceIds = async (user: DisposableUser): Promise<string[]> => {
  const { devices } = await matrixFetch<{ devices: { device_id: string }[] }>(
    HOMESERVER,
    '/devices',
    { accessToken: user.accessToken }
  );
  return devices.map((device) => device.device_id);
};

const removeAsksThenLogsOut = async (page: Page, browserName: string) => {
  const leaving = await registerDisposableUser(`ral_a_${browserName}_${RUN}`, PASSWORD);
  const staying = await registerDisposableUser(`ral_b_${browserName}_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...leaving });
  const { deviceId } = await getStoredSessionByUsername(page, leaving.username);
  expect(await deviceIds(leaving)).toContain(deviceId);
  await chooseFromAccountMenu(page, 'Add Account');
  await loginWithPassword(page, { homeserver: HOMESERVER, ...staying, addAccount: true });

  await chooseFromAccountMenu(page, 'Manage Accounts');
  const accountRow = page.getByText(leaving.userId, { exact: true }).first();
  await expect(accountRow).toBeVisible();
  const remove = page.getByRole('button', { name: 'Remove from Device' });

  // The first press asks, with the warning; Cancel keeps the account.
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Logout' });
  await expect(dialog.getByText('You’re about to log out. Are you sure?')).toBeVisible();
  await expect(dialog.getByText(leaving.userId, { exact: true })).toBeVisible();
  await expect(
    dialog.getByText(
      'Enable device verification or export your encrypted data from settings to avoid losing access to your messages.'
    )
  ).toBeVisible({ timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/remove-confirm-${browserName}.png` });
  await dialog.getByRole('button', { name: 'Cancel' }).last().click();
  await expect(dialog).toHaveCount(0);
  await expect(accountRow).toBeVisible();
  expect(await deviceIds(leaving)).toContain(deviceId);

  // Confirmed, the account leaves this browser and the homeserver ends its device.
  await remove.click();
  await dialog.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(leaving.userId, { exact: true })).toHaveCount(0);
  await expect.poll(() => deviceIds(leaving), { timeout: 20_000 }).not.toContain(deviceId);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/remove-done-${browserName}.png` });
};

test('Remove from Device asks first and logs the account out on the server (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);
  await removeAsksThenLogsOut(page, browserName);
});

test('Remove from Device asks first and logs the account out on the server (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage(
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL },
    (page) => removeAsksThenLogsOut(page, 'webkit')
  );
});
