import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildRegisterPath } from '../env';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  accountSessionShot,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Signing up with a confirmation that does not match, then with a username someone already has:
// each error belongs to its field. It shows in words under that field, the field is marked invalid
// and described by it, and focus goes back to it; what was typed stays. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver.
const PASSWORD = 'register-field-errors-spec-password';
const RUN = Date.now().toString(36);
const TAKEN = 'This username is already taken.';
const MISMATCH = 'The passwords do not match.';

/** The field names an error that shows in words right below it. */
const expectErrorBelow = async (page: Page, field: Locator, message: string) => {
  const error = page.getByRole('alert').filter({ hasText: message });
  await expect(error).toBeVisible({ timeout: 20_000 });
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  const describedBy = (await field.getAttribute('aria-describedby')) ?? '';
  expect(describedBy, 'the field names its error').not.toBe('');
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText(message);
  const fieldBox = await field.boundingBox();
  const errorBox = await error.boundingBox();
  expect(errorBox!.y).toBeGreaterThan(fieldBox!.y + fieldBox!.height - 1);
  expect(errorBox!.y - (fieldBox!.y + fieldBox!.height)).toBeLessThan(24);
  await expect(field).toBeFocused();
  return error;
};

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const errorsBelongToTheirFields = async (page: Page, browserName: string) => {
  const existing = await registerDisposableUser(`rfe_taken_${browserName}_${RUN}`, PASSWORD);
  await page.goto(buildRegisterPath(HOMESERVER));
  const username = page.locator('input[name="usernameInput"]');
  const password = page.locator('input[name="passwordInput"]');
  await expect(username).toBeVisible({ timeout: 60_000 });
  const confirm = page.locator('input[name="confirmPasswordInput"]');
  await username.fill(existing.username);
  await password.fill('another-long-password-for-signup');
  await confirm.fill('another-long-password-for-signip');
  await page.getByRole('button', { name: 'Register' }).click();
  await expectErrorBelow(page, confirm, MISMATCH);
  await accountSessionShot(page, `register-mismatch-${browserName}`);

  await confirm.fill('another-long-password-for-signup');
  await page.getByRole('button', { name: 'Register' }).click();
  const error = await expectErrorBelow(page, username, TAKEN);
  await accountSessionShot(page, `register-taken-${browserName}`);
  await expect(page.getByRole('alert').filter({ hasText: MISMATCH })).toHaveCount(0);
  // Above the Password field.
  const errorBox = await error.boundingBox();
  const passwordBox = await password.boundingBox();
  expect(errorBox!.y + errorBox!.height).toBeLessThan(passwordBox!.y);
  await expect(username).toHaveValue(existing.username);
  // The password fields are not the problem now.
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');
  await expect(confirm).not.toHaveAttribute('aria-invalid', 'true');
};

test('a mismatch and a taken username are their fields’ errors (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  await errorsBelongToTheirFields(page, browserName);
});

test('a mismatch and a taken username are their fields’ errors (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(120_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    errorsBelongToTheirFields(page, 'webkit')
  );
});
