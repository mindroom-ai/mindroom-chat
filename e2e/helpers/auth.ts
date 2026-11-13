import { expect, Page } from '@playwright/test';
import { buildLoginPath } from '../env';

type LoginOptions = {
  homeserver: string;
  username: string;
  password: string;
  addAccount?: boolean;
  /**
   * The app hides agent replies' tool calls until the reader shows them; most specs check them,
   * so the page shows them unless its settings already say. `false` keeps the app's default.
   */
  showToolCalls?: boolean;
};

export const activeAccountButtonNamePattern = /Open account menu for /;
const failedStartAccountPattern = /Failed to start account/i;

/**
 * The active account's button. A phone has two while its drawer is out, the top bar's and the
 * rail's, which open the same menu; this takes the first in the page, the top bar's on a phone.
 */
export const activeAccountButton = (page: Page) =>
  page.getByRole('button', { name: activeAccountButtonNamePattern }).first();

/** Opens the account menu of the active account's button. */
export const openAccountMenu = async (page: Page) => {
  await activeAccountButton(page).click();
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
};

/** Opens the account menu and chooses an entry: Settings, Add Account, an account, Manage Accounts. */
export const chooseFromAccountMenu = async (page: Page, name: string | RegExp) => {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name, exact: typeof name === 'string' }).click();
};

/**
 * Expects `count` account controls, which is the number of signed-in accounts plus one: the
 * rail's account button and, in its menu, one entry per other account and Add Account. Closes
 * the menu again.
 */
export const expectAccountRailCount = async (page: Page, count: number) => {
  await openAccountMenu(page);
  await expect(
    page
      .getByRole('button', { name: activeAccountButtonNamePattern })
      .or(page.getByRole('menuitem', { name: /^Switch to account / }))
      .or(page.getByRole('menuitem', { name: 'Add Account', exact: true }))
  ).toHaveCount(count);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
};

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
        // The active account control is the signal that the authenticated shell has mounted.
        return activeAccountButtons > 0;
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
  const { homeserver, username, password, addAccount = false, showToolCalls = true } = options;

  if (showToolCalls) {
    await page.addInitScript(() => {
      const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as Record<
        string,
        unknown
      >;
      if (stored.showToolCalls !== undefined) return;
      localStorage.setItem('settings', JSON.stringify({ ...stored, showToolCalls: true }));
    });
  }
  await page.goto(buildLoginPath(homeserver, addAccount));

  const serverInput = page.locator('input[name="serverInput"]');
  await expect(serverInput).toHaveValue(homeserver);

  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();

  await waitForLoggedInShell(page);
};
