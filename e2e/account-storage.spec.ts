import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import {
  getStoredSessionByUsername,
  logoutActiveAccount,
  readSessionStore,
  removeInactiveStoredUsername,
} from './helpers/accounts';
import { expectLoggedInShellStable, loginWithPassword } from './helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from './helpers/browserDiagnostics';
import { getExpectedSessionDbNames, readIndexedDbNames } from './helpers/storage';

test('cleans up session-scoped browser storage after account removal and final logout', async ({
  page,
}) => {
  const secondaryCredentials = getSecondaryCredentials();
  test.skip(
    !secondaryCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run storage cleanup coverage.'
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

  const primarySession = await getStoredSessionByUsername(page, primaryCredentials.username);
  const primaryDbNames = getExpectedSessionDbNames(primarySession);
  const primaryIndexedDbNames = await readIndexedDbNames(page);
  primaryDbNames.forEach((name) => expect(primaryIndexedDbNames).toContain(name));

  await page.getByRole('button', { name: 'Add account' }).click();
  await loginWithPassword(page, {
    homeserver,
    username: secondaryCredentials.username,
    password: secondaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });

  const secondarySession = await getStoredSessionByUsername(page, secondaryCredentials.username);
  const secondaryDbNames = getExpectedSessionDbNames(secondarySession);
  const bothIndexedDbNames = await readIndexedDbNames(page);
  [...primaryDbNames, ...secondaryDbNames].forEach((name) =>
    expect(bothIndexedDbNames).toContain(name)
  );

  await removeInactiveStoredUsername(page, primaryCredentials.username);
  const afterRemovalIndexedDbNames = await readIndexedDbNames(page);
  primaryDbNames.forEach((name) => expect(afterRemovalIndexedDbNames).not.toContain(name));
  secondaryDbNames.forEach((name) => expect(afterRemovalIndexedDbNames).toContain(name));

  await logoutActiveAccount(page);
  await expect(page.locator('input[name="serverInput"]')).toBeVisible();
  await expect(page.getByText('Login')).toBeVisible();

  const finalSessionStore = await readSessionStore(page);
  expect(finalSessionStore.sessions).toHaveLength(0);

  const finalIndexedDbNames = await readIndexedDbNames(page);
  secondaryDbNames.forEach((name) => expect(finalIndexedDbNames).not.toContain(name));

  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'session storage cleanup');
});
