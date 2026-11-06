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

// The recovery key is shown once, when device verification is set up. Neither Escape nor a click
// outside closes the dialog while the setup runs or while the key is on screen: only Okay does.
// The key wraps between its groups of four, never inside one. Closing it leaves focus off the
// red Reset button that replaces Enable. Runs in Chromium at 1280 by 800 and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit on a 390 by 844 phone, against
// the disposable homeserver.
const PASSWORD = 'recovery-key-dialog-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
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

const keyStaysUntilOkay = async (page: Page, browserName: string) => {
  const user = await registerDisposableUser(`rkd_${browserName}_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
  await expect(page.getByText('Security', { exact: true })).toBeVisible();

  // The cross-signing upload waits, so Escape comes while the setup runs.
  const held: Route[] = [];
  await page.route('**/_matrix/client/*/keys/device_signing/upload', (route) => {
    held.push(route);
  });
  await page.getByRole('button', { name: 'Enable' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => held.length, { timeout: 30_000 }).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.unroute('**/_matrix/client/*/keys/device_signing/upload');
  await held[0].continue();

  const dialog = page.getByRole('dialog').filter({ has: page.locator('code') });
  const keyText = dialog.locator('code');
  await expect(keyText).toHaveText(KEY_PATTERN, { timeout: 60_000 });
  const shownKey = await keyText.textContent();
  await accountSessionShot(page, `recovery-key-${browserName}`);

  await page.keyboard.press('Escape');
  await expect(keyText).toHaveText(shownKey ?? '');
  await page.mouse.click(5, 5);
  await expect(keyText).toHaveText(shownKey ?? '');
  expect(await groupsSplitOverLines(page)).toEqual([]);

  await dialog.getByRole('button', { name: 'Okay' }).click();
  await expect(dialog).toHaveCount(0);
  const reset = page.getByRole('button', { name: 'Reset' });
  await expect(reset).toBeVisible({ timeout: 30_000 });
  await expect(reset).not.toBeFocused();
  await accountSessionShot(page, `recovery-key-closed-${browserName}`);
};

test('the recovery key stays until Okay (Chromium)', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await keyStaysUntilOkay(page, browserName);
});

test('the recovery key stays until Okay (WebKit phone)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL };
  await onWebKitPage(phone, (page) => keyStaysUntilOkay(page, 'webkit'));
});
