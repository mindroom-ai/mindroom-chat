import { expect, test, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The Accounts dialog (account menu, Manage Accounts) ends below its last control: with two
// accounts signed in on a desktop it kept the full height of the settings dialog, about 350 px of
// it empty, where the page behind showed through. On a desktop it is about 480 px wide, as a list
// of a few accounts needs, not the 800 px of the settings dialog. A phone's fills its screen, as
// before. Set ACCOUNTS_DIALOG_SHOTS=<directory> to save it.
const PASSWORD = 'accounts-dialog-size-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.ACCOUNTS_DIALOG_SHOTS;

const register = (username: string) =>
  matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

const checkDialog = async (
  page: Page,
  size: 'desktop' | 'phone',
  viewport: { width: number; height: number },
  engine: 'chromium' | 'webkit'
) => {
  const first = `accounts_size_first_${size}_${engine[0]}${RUN}`;
  const second = `accounts_size_second_${size}_${engine[0]}${RUN}`;
  await register(first);
  await register(second);
  await loginWithPassword(page, { homeserver: HOMESERVER, username: first, password: PASSWORD });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: second,
    password: PASSWORD,
    addAccount: true,
  });
  await chooseFromAccountMenu(page, 'Manage Accounts');
  const dialog = page.getByRole('dialog', { name: 'Accounts' });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeVisible();
  // The dialog fades in.
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/accounts-${engine}-${size}.png` });
  const dialogBox = (await dialog.boundingBox())!;
  const closeBox = (await close.boundingBox())!;
  const below = dialogBox.y + dialogBox.height - (closeBox.y + closeBox.height);
  if (size === 'phone') {
    // The phone's dialog is a screen of its own.
    expect(dialogBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
  } else {
    // The content's own padding (16 px) and the dialog's border.
    expect(below, 'empty space under the last control').toBeLessThanOrEqual(24);
    expect(dialogBox.width, 'the dialog width').toBeGreaterThanOrEqual(440);
    expect(dialogBox.width, 'the dialog width').toBeLessThanOrEqual(482);
    // Every account row keeps inside it.
    const rows = await dialog.locator('li, [role="listitem"], button').evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { left: box.left, right: box.right };
      })
    );
    for (const row of rows) {
      expect(row.left).toBeGreaterThanOrEqual(dialogBox.x - 1);
      expect(row.right).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
    }
  }
};

for (const [size, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`the Accounts dialog keeps to its content on a ${size}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await checkDialog(page, size, viewport, 'chromium');
  });
}

test('the Accounts dialog keeps to its content on a desktop (WebKit, dark)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  test.setTimeout(120_000);
  const viewport = { width: 1440, height: 900 };
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ baseURL, viewport, colorScheme: 'dark' });
    await checkDialog(await context.newPage(), 'desktop', viewport, 'webkit');
  } finally {
    await browser.close();
  }
});
