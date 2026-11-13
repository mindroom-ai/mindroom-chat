import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { buildLoginPath } from '../env';
import { setUpRecoveryPassword } from '../helpers/recovery';
import { matrixFetch } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// An emoji verification between two sessions of one account that does not finish: one session
// says the emoji do not match, or nobody answers. Both sessions must show the verification as
// cancelled: on a mismatch at once, and after an unanswered comparison as soon as the crypto
// machine's one minute of inactivity has passed. Against the slot's Tuwunel, with fresh accounts.
const PASSWORD = 'verification-cancel-spec-password';
const RECOVERY_PASSWORD = 'e2e recovery password 1';
const CANCELLED = 'Verification has been canceled.';

const signIn = async (browser: Browser, username: string): Promise<Page> => {
  const page = await (await browser.newContext()).newPage();
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
 * Signs in twice: the first session sets up device verification, the second asks it for an
 * emoji verification, and both end up comparing emoji.
 */
const startEmojiComparison = async (browser: Browser, name: string) => {
  const username = `vc_${name}_${Date.now().toString(36)}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  const first = await signIn(browser, username);
  await openDevices(first);
  await first.getByRole('button', { name: 'Enable' }).click();
  await setUpRecoveryPassword(first, RECOVERY_PASSWORD);
  await expect(first.getByText('Verified', { exact: true })).toBeVisible({ timeout: 30_000 });
  await first.keyboard.press('Escape');

  const second = await signIn(browser, username);
  await expect(second.getByRole('button', { name: 'Unverified Device' })).toBeVisible({
    timeout: 30_000,
  });
  await openDevices(second);
  // The home page behind the settings has a Verify button of its own.
  await second.getByRole('dialog').getByRole('button', { name: 'Verify', exact: true }).click();
  await first.getByRole('button', { name: 'Accept' }).click({ timeout: 30_000 });
  await expect(second.getByRole('button', { name: 'They Match' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(first.getByRole('button', { name: 'They Match' })).toBeVisible();
  return { first, second };
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('emoji that do not match cancel the verification on both sessions @webkit', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const { first, second } = await startEmojiComparison(
    browser,
    `mm${testInfo.project.name.slice(0, 2)}`
  );

  await second.getByRole('button', { name: 'Do not Match' }).click();

  await expect(second.getByText(CANCELLED)).toBeVisible({ timeout: 30_000 });
  await expect(first.getByText(CANCELLED)).toBeVisible({ timeout: 30_000 });
  await expect(second.getByRole('button', { name: 'Unverified Device' })).toBeVisible();
});

test('an emoji comparison nobody answers is cancelled on both sessions @webkit', async ({
  browser,
}, testInfo) => {
  test.setTimeout(360_000);
  const { first, second } = await startEmojiComparison(
    browser,
    `to${testInfo.project.name.slice(0, 2)}`
  );
  const shown = Date.now();

  // The crypto machine gives up on a comparison after a minute without an answer, at the next
  // sync it handles; a quiet sync loop comes back every 30 seconds.
  await expect(second.getByText(CANCELLED)).toBeVisible({ timeout: 150_000 });
  await expect(first.getByText(CANCELLED)).toBeVisible({ timeout: 30_000 });
  // eslint-disable-next-line no-console
  console.log('VERIFY', JSON.stringify({ cancelledAfterMs: Date.now() - shown }));
  await expect(second.getByRole('button', { name: 'They Match' })).toHaveCount(0);
});
