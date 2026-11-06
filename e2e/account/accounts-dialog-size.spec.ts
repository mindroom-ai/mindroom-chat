import { expect, test } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';

// The Accounts dialog (account menu, Manage Accounts) ends below its last control: with two
// accounts signed in on a desktop it kept the full height of the settings dialog, about 350 px of
// it empty, where the page behind showed through. A phone's fills its screen, as before. Set
// ACCOUNTS_DIALOG_SHOTS=<directory> to save it.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'accounts-dialog-size-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.ACCOUNTS_DIALOG_SHOTS;

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

const register = (username: string) =>
  matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

for (const [size, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`the Accounts dialog keeps to its content on a ${size}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const first = `accounts_size_first_${size}_${RUN}`;
    const second = `accounts_size_second_${size}_${RUN}`;
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
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/accounts-${size}.png` });
    const dialogBox = (await dialog.boundingBox())!;
    const closeBox = (await close.boundingBox())!;
    const below = dialogBox.y + dialogBox.height - (closeBox.y + closeBox.height);
    if (size === 'phone') {
      // The phone's dialog is a screen of its own.
      expect(dialogBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
    } else {
      // The content's own padding (16 px) and the dialog's border.
      expect(below, 'empty space under the last control').toBeLessThanOrEqual(24);
    }
  });
}
