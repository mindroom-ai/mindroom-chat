import { expect, Page } from '@playwright/test';
import { buildLoginPath } from '../env';

type LoginOptions = {
  homeserver: string;
  username: string;
  password: string;
  addAccount?: boolean;
};

export const activeAccountButtonNamePattern = /Open (account switcher|settings) for /;
const failedStartAccountPattern = /Failed to start account/i;

export const accountRailButtonSelector = [
  'button[aria-label^="Open account switcher for "]',
  'button[aria-label^="Open settings for "]',
  'button[aria-label^="Switch to account "]',
  'button[aria-label="Add account"]',
].join(', ');

export const waitForLoggedInShell = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const failedStartAccount = page.getByText(failedStartAccountPattern);
        if ((await failedStartAccount.count()) > 0) {
          const retryButton = page.getByRole('button', { name: 'Retry' }).first();
          if (await retryButton.isVisible().catch(() => false)) {
            await retryButton.click();
            await page.waitForTimeout(500);
          }
          return false;
        }

        if ((await page.getByText('Unexpected Application Error!').count()) > 0) {
          return false;
        }

        const activeAccountButtons = await page
          .getByRole('button', { name: activeAccountButtonNamePattern })
          .count();
        const addAccountButtons = await page.getByRole('button', { name: 'Add account' }).count();
        return activeAccountButtons > 0 && addAccountButtons > 0;
      },
      {
        timeout: 30_000,
      }
    )
    .toBe(true);

  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
  await expect(page.getByText(failedStartAccountPattern)).toHaveCount(0);
};

export const expectLoggedInShellStable = async (
  page: Page,
  options: {
    durationMs?: number;
    sampleIntervalMs?: number;
  } = {}
) => {
  const durationMs = options.durationMs ?? 4_000;
  const sampleIntervalMs = options.sampleIntervalMs ?? 250;
  const sampleCount = Math.max(1, Math.ceil(durationMs / sampleIntervalMs));

  const sampleShell = async (remainingSamples: number): Promise<void> => {
    await expect(page.getByText('Heating up')).toHaveCount(0);
    await waitForLoggedInShell(page);

    if (remainingSamples > 1) {
      await page.waitForTimeout(sampleIntervalMs);
      await sampleShell(remainingSamples - 1);
    }
  };

  await sampleShell(sampleCount);
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
