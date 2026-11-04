import { expect, test, type Page } from '@playwright/test';
import { readSessionStore } from '../helpers/accounts';
import {
  activeAccountButtonNamePattern,
  chooseFromAccountMenu,
  openAccountMenu,
  waitForLoggedInShell,
} from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';

// The rail's single account button and its menu, and the Settings switches that hide rail
// buttons, against the disposable homeserver of `just hs-up` (open registration).
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'account-menu-spec-password';

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

/** A fresh account with a display name, so the menu has a name to show. */
const registerUser = async (username: string, displayName: string): Promise<string> => {
  const { access_token: accessToken, user_id: userId } = await matrixFetch<{
    access_token: string;
    user_id: string;
  }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(userId)}/displayname`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  return userId;
};

/** The signed-in shell; a first sync on a busy machine can outlast the shared helper's wait. */
const waitForShell = async (page: Page) => {
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 120_000,
  });
  await waitForLoggedInShell(page);
};

const signIn = async (page: Page, username: string) => {
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 90_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await waitForShell(page);
};

const activeUserId = async (page: Page) => {
  const store = await readSessionStore(page);
  return store.sessions.find((session) => session.sessionId === store.activeSessionId)?.userId;
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('switches accounts through the account menu, and hidden rail buttons stay hidden after a reload', async ({
  page,
}) => {
  test.slow();
  const stamp = Date.now().toString(36);
  const first = `menu_a_${stamp}`;
  const second = `menu_b_${stamp}`;
  const firstId = await registerUser(first, 'Avery Menu');
  const secondId = await registerUser(second, 'Blake Menu');

  await page.goto(`/login/${encodeURIComponent(HOMESERVER)}`);
  await signIn(page, first);

  // One account: the menu names it and offers Settings and Add Account only.
  await openAccountMenu(page);
  const menu = page.getByRole('menu');
  await expect(menu).toHaveAccessibleName(`Avery Menu ${firstId}`);
  await expect(menu.getByRole('menuitem')).toHaveText(['Settings', 'Add Account']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // Only the active account's button is on the rail.
  await expect(
    rail(page).getByRole('button', { name: /Switch to account|Add account/ })
  ).toHaveCount(0);

  await chooseFromAccountMenu(page, 'Add Account');
  await expect(page).toHaveURL(/addAccount=1/);
  await signIn(page, second);
  await expect.poll(() => activeUserId(page)).toBe(secondId);

  // Two accounts: the other one is listed with its Matrix ID, and Manage Accounts appears.
  await openAccountMenu(page);
  await expect(menu).toHaveAccessibleName(`Blake Menu ${secondId}`);
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Settings',
    new RegExp(`Avery Menu.*${firstId}`),
    'Add Account',
    'Manage Accounts',
  ]);
  await menu.getByRole('menuitem', { name: `Switch to account Avery Menu (${firstId})` }).click();
  await waitForShell(page);
  await expect.poll(() => activeUserId(page)).toBe(firstId);
  await expect(
    page.getByRole('button', { name: 'Open account menu for Avery Menu' })
  ).toBeVisible();

  // Settings > General > Sidebar: hide Threads and Search.
  await chooseFromAccountMenu(page, 'Settings');
  await expect(page.getByText('Sidebar', { exact: true })).toBeVisible();
  const threadsSwitch = page.getByRole('switch', { name: 'Show Threads in the sidebar' });
  const searchSwitch = page.getByRole('switch', { name: 'Show Search in the sidebar' });
  await expect(threadsSwitch).toHaveAttribute('aria-checked', 'true');
  await threadsSwitch.click();
  await searchSwitch.click();
  await expect(threadsSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(searchSwitch).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  const hidden = async () => {
    await expect(rail(page).getByRole('button', { name: 'Threads', exact: true })).toHaveCount(0);
    await expect(rail(page).getByRole('button', { name: 'Open command palette' })).toHaveCount(0);
    await expect(rail(page).getByRole('button', { name: 'Explore Community' })).toBeVisible();
  };
  await hidden();

  await page.reload();
  await waitForShell(page);
  await hidden();
  // Threads stays one menu away, under Home's options; the menu renders last on the page, after
  // the Home list's own THREADS heading.
  await page.goto('/home/');
  await waitForShell(page);
  await page.getByRole('button', { name: 'Home Options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark as Read' })).toBeVisible();
  await page.getByRole('button', { name: 'Threads', exact: true }).last().click();
  await expect(page).toHaveURL(/\/threads\/?$/);

  await chooseFromAccountMenu(page, 'Settings');
  await expect(page.getByRole('switch', { name: 'Show Threads in the sidebar' })).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await expect(page.getByRole('switch', { name: 'Show Search in the sidebar' })).toHaveAttribute(
    'aria-checked',
    'false'
  );
});
