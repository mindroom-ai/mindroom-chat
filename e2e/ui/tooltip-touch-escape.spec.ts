import { expect, test, type Browser, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { matrixFetch } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// On a touch screen a tap is no hover: closing the room header's More Options menu with a
// hardware keyboard's Escape leaves no "More Options" tooltip standing. Checked on a phone
// (390 by 844, touch) in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit.
const PASSWORD = 'tooltip-touch-escape-spec-password';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
// Past the tooltip's 200 ms hover delay.
const TOOLTIP_DELAY_MS = 600;

const seed = async () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const username = `tte_viewer_${run}`;
  const { access_token: accessToken } = await matrixFetch<{ access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ preset: 'private_chat', name: 'Project Team' }),
  });
  return { username, roomId };
};

const check = async (page: Page, username: string, roomId: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/(home|inbox|direct)\//, { timeout: 60_000 });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const button = page.getByRole('button', { name: 'More Options', exact: true });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.tap();
  const menu = page.getByRole('menuitem', { name: 'Invite', exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // A tooltip opens only after its delay; give it time to appear.
  await page.waitForTimeout(TOOLTIP_DELAY_MS);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
};

test.beforeAll(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const run = async (browser: Browser, baseURL: string | undefined) => {
  const { username, roomId } = await seed();
  const context = await browser.newContext({ ...PHONE, baseURL });
  try {
    await check(await context.newPage(), username, roomId);
  } finally {
    await context.close();
  }
};

test('Escape from the header menu on a touch screen leaves no tooltip (Chromium)', async ({
  browser,
  baseURL,
}) => {
  await run(browser, baseURL);
});

test('Escape from the header menu on a touch screen leaves no tooltip (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL);
  } finally {
    await browser.close();
  }
});
