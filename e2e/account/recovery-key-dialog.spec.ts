import { expect, test, type Page, type Route } from '@playwright/test';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  accountSessionShot,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { onWebKitPage } from '../helpers/webkit';

// The setup asks for a recovery password and keeps the recovery key behind a toggle. Neither
// Escape nor a click outside closes the dialog while the setup runs or until the password is
// saved: only Done does, and Done waits for the saved box. The key wraps between its groups of four, never inside one. Closing it leaves focus off the
// red Reset button that replaces Enable. Runs in Chromium at 1280 by 800 and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit on a 390 by 844 phone, against
// the disposable homeserver.
const PASSWORD = 'recovery-key-dialog-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const RECOVERY_PASSWORD = 'e2e recovery password 1';
const KEY_PATTERN = /^E\w{3}( \w{4}){11}$/;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** Groups of the shown key that the layout split over two lines. */
const groupsSplitOverLines = (page: Page): Promise<string[]> =>
  page
    .getByRole('dialog')
    .locator('code')
    .evaluate((code) => {
      const text = code.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) return ['the key is not one text node'];
      const value = text.textContent ?? '';
      const split: string[] = [];
      for (const match of value.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        const tops = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
        if (tops.size > 1) split.push(match[0]);
      }
      return split;
    });

const dialogStaysUntilDone = async (page: Page, browserName: string) => {
  const user = await registerDisposableUser(`rkd_${browserName}_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
  await expect(page.getByText('Security', { exact: true })).toBeVisible();

  // The cross-signing upload waits, so Escape comes while the setup runs.
  let held = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_matrix/client/*/keys/device_signing/upload', async (route: Route) => {
    held += 1;
    await released;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Enable' }).click();
  const setup = page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
  await setup.locator('input[name="recoveryPasswordInput"]').fill(RECOVERY_PASSWORD);
  await setup.locator('input[name="recoveryPasswordConfirmInput"]').fill(RECOVERY_PASSWORD);
  await setup.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => held, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(setup.getByRole('button', { name: 'Not now' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(setup.getByRole('button', { name: 'Continue' })).toBeVisible();
  release();

  const saved = setup.getByRole('checkbox', { name: 'I saved my recovery password' });
  await expect(saved).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(saved).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(saved).toBeVisible();

  await setup.getByRole('button', { name: 'Recovery key for other apps' }).click();
  const keyText = setup.locator('code');
  await expect(keyText).toHaveText(KEY_PATTERN);
  await accountSessionShot(page, `recovery-key-${browserName}`);
  expect(await groupsSplitOverLines(page)).toEqual([]);

  const done = setup.getByRole('button', { name: 'Done' });
  await expect(done).toBeDisabled();
  await saved.check();
  await expect(done).toBeEnabled();
  await done.click();
  await expect(setup).toHaveCount(0);
  const reset = page.getByRole('button', { name: 'Reset' });
  await expect(reset).toBeVisible({ timeout: 30_000 });
  await expect(reset).not.toBeFocused();
  await accountSessionShot(page, `recovery-key-closed-${browserName}`);
};

test('the setup dialog stays until Done (Chromium)', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await dialogStaysUntilDone(page, browserName);
});

test('the setup dialog stays until Done (WebKit phone)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  // Requests a service worker makes are not routed, so the page goes without one.
  const phone = {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    baseURL,
    serviceWorkers: 'block' as const,
  };
  await onWebKitPage(phone, (page) => dialogStaysUntilDone(page, 'webkit'));
});
