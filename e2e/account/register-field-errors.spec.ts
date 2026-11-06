import { expect, test, type Page } from '@playwright/test';
import { buildRegisterPath } from '../env';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { launchWebKit } from '../helpers/webkit';

// Signing up with a username someone already has: the server's answer belongs to the Username
// field. It shows under that field, the field is marked invalid and described by it, and focus
// goes back to it; what was typed stays. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit, against the disposable homeserver.
const PASSWORD = 'register-field-errors-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const TAKEN = 'This username is already taken.';

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const takenUsernameIsTheUsernameFieldsError = async (page: Page, browserName: string) => {
  const existing = await registerDisposableUser(`rfe_taken_${browserName}_${RUN}`, PASSWORD);
  await page.goto(buildRegisterPath(HOMESERVER));
  const username = page.locator('input[name="usernameInput"]');
  const password = page.locator('input[name="passwordInput"]');
  await expect(username).toBeVisible({ timeout: 60_000 });
  await username.fill(existing.username);
  await password.fill('another-long-password-for-signup');
  await page.locator('input[name="confirmPasswordInput"]').fill('another-long-password-for-signup');
  await page.getByRole('button', { name: 'Register' }).click();

  const error = page.getByRole('alert').filter({ hasText: TAKEN });
  await expect(error).toBeVisible({ timeout: 20_000 });
  await expect(username).toHaveAttribute('aria-invalid', 'true');
  const describedBy = (await username.getAttribute('aria-describedby')) ?? '';
  expect(describedBy, 'the username field names its error').not.toBe('');
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText(TAKEN);
  // Under the Username field, above the Password field.
  const usernameBox = await username.boundingBox();
  const errorBox = await error.boundingBox();
  const passwordBox = await password.boundingBox();
  expect(errorBox!.y).toBeGreaterThan(usernameBox!.y + usernameBox!.height - 1);
  expect(errorBox!.y + errorBox!.height).toBeLessThan(passwordBox!.y);
  await expect(username).toBeFocused();
  await expect(username).toHaveValue(existing.username);
  // The password fields are not the problem.
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');
};

test('a taken username is the Username field’s error (Chromium)', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await takenUsernameIsTheUsernameFieldsError(page, browserName);
});

test('a taken username is the Username field’s error (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(120_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL });
    await takenUsernameIsTheUsernameFieldsError(await context.newPage(), 'webkit');
  } finally {
    await browser.close();
  }
});
