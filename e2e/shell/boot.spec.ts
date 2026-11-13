import { expect, test, type Page } from '@playwright/test';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

const PASSWORD = 'boot-spec-password';

/** Registers an account and returns its access token. */
const registerUser = async (username: string): Promise<string> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
    }),
  });
  expect(response.ok, `registering ${username}: ${response.status}`).toBe(true);
  const { access_token: accessToken } = (await response.json()) as { access_token: string };
  return accessToken;
};

// An account without rooms shows an empty state instead of the room list, so give it one.
const createRoom = async (accessToken: string, name: string): Promise<void> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/createRoom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name, preset: 'private_chat' }),
  });
  expect(response.ok, `creating room ${name}: ${response.status}`).toBe(true);
};

const expectSignedInHome = async (page: Page): Promise<void> => {
  // The home sidebar lists joined rooms under a "Rooms" section heading.
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('input[name="passwordInput"]')).toHaveCount(0);
  await expect(page.getByText('Boot Check', { exact: true })).toBeVisible();
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

test('signs in with a password and stays signed in after a reload', async ({ page }) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );

  const diagnostics = attachBrowserDiagnostics(page);
  const username = `boot_${Date.now().toString(36)}`;
  await createRoom(await registerUser(username), 'Boot Check');

  await page.goto('/');

  // Point the sign-in card at the test homeserver through its server field.
  const serverInput = page.locator('input[name="serverInput"]');
  await expect(serverInput).toBeVisible({ timeout: 30_000 });
  await serverInput.fill(HOMESERVER);
  await serverInput.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/login/${encodeURIComponent(HOMESERVER)}`));

  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();

  await expectSignedInHome(page);

  await page.reload();
  await expectSignedInHome(page);

  // Render loops and application errors show up in the console before they show on screen.
  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'boot');
});
