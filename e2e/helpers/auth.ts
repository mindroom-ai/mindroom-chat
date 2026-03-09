import { expect, Page } from '@playwright/test';
import { buildLoginPath } from '../env';

type LoginOptions = {
  homeserver: string;
  username: string;
  password: string;
  addAccount?: boolean;
};

export const accountRailButtonSelector = [
  'button[aria-label^="Open account switcher for "]',
  'button[aria-label^="Switch to account "]',
  'button[aria-label="Add account"]',
].join(', ');

export const waitForLoggedInShell = async (page: Page) => {
  await expect(page.getByRole('button', { name: /Open account switcher for / })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add account' })).toBeVisible();
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

export const loginWithPassword = async (page: Page, options: LoginOptions) => {
  const { homeserver, username, password, addAccount = false } = options;

  await page.goto(buildLoginPath(homeserver, addAccount));

  const serverInput = page.locator('input[name="serverInput"]');
  await expect(serverInput).toHaveValue(homeserver);

  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();

  await waitForLoggedInShell(page);
};
