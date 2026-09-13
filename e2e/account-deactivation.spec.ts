import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import {
  deactivateActiveAccount,
  expectActiveStoredUsername,
  readSessionStore,
} from './helpers/accounts';
import { accountRailButtonSelector, expectLoggedInShellStable, loginWithPassword } from './helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from './helpers/browserDiagnostics';

test('deactivating the active account removes only that account and leaves the other signed in', async ({
  page,
}) => {
  const secondaryCredentials = getSecondaryCredentials();
  test.skip(
    !secondaryCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run the multi-account e2e flow.'
  );

  const diagnostics = attachBrowserDiagnostics(page);
  const homeserver = getHomeserver();
  const primaryCredentials = getPrimaryCredentials();

  await loginWithPassword(page, {
    homeserver,
    username: primaryCredentials.username,
    password: primaryCredentials.password,
  });
  await expectLoggedInShellStable(page);
  await expectActiveStoredUsername(page, primaryCredentials.username);

  await page.getByRole('button', { name: 'Add account' }).click();
  await loginWithPassword(page, {
    homeserver,
    username: secondaryCredentials.username,
    password: secondaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, secondaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(3);

  await deactivateActiveAccount(page, secondaryCredentials.password);

  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, primaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(2);

  await expect
    .poll(async () => {
      const sessionStore = await readSessionStore(page);
      return sessionStore.sessions.map((session) => session.userId).sort();
    })
    .toEqual([expect.stringMatching(new RegExp(`^@${primaryCredentials.username}:`))]);

  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  await page.locator('input[name="usernameInput"]').fill(secondaryCredentials.username);
  await page.locator('input[name="passwordInput"]').fill(secondaryCredentials.password);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByText('This account has been deactivated.')).toBeVisible();

  await expectNoUnexpectedBrowserDiagnostics(
    diagnostics,
    'active account deactivation with fallback account'
  );
});
