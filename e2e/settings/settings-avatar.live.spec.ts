import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from '../env';
import {
  chooseFromAccountMenu,
  expectLoggedInShellStable,
  loginWithPassword,
  openAccountMenu,
} from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live ISSUE-044 settings avatar behavior', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('the active avatar opens Settings directly and hides Manage accounts for a single session', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);

    await openAccountMenu(page);
    await expect(page.getByRole('menuitem', { name: 'Manage accounts' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();

    await expect(
      page.getByText('Switch accounts, add another account, or remove an inactive one.')
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Logout' }).first()).toBeVisible();

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'issue-044-active-avatar-settings');
  });

  test('Manage accounts appears only after adding a second session and still keeps Settings on the active avatar', async ({
    page,
  }) => {
    const secondaryCredentials = getSecondaryCredentials();
    test.skip(
      !secondaryCredentials,
      'E2E_SECOND_USERNAME / E2E_SECOND_PASSWORD not set for multi-account settings coverage'
    );

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);

    await loginWithPassword(page, {
      homeserver,
      username: secondaryCredentials!.username,
      password: secondaryCredentials!.password,
      addAccount: true,
    });
    await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });

    await openAccountMenu(page);
    await expect(page.getByRole('menuitem', { name: 'Manage accounts' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Manage accounts' }).click();

    await expect(page.getByText('Accounts', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('Switch accounts, add another account, or remove an inactive one.')
    ).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await chooseFromAccountMenu(page, 'Settings');
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText('Switch accounts, add another account, or remove an inactive one.')
    ).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'issue-044-manage-accounts');
  });
});
