import { expect, test } from '@playwright/test';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

const hasCredentials = !!process.env.E2E_USERNAME;
const LOGIN_HOMESERVER =
  process.env.E2E_HOMESERVER ?? 'https://mindroom.lab.mindroom.chat';

test.describe('CINNY-029: thread Load Older Messages button', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('short thread should NOT show Load Older Messages button', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const username = process.env.E2E_USERNAME!;
    const password = process.env.E2E_PASSWORD!;

    // Login
    await page.goto(`/login/${encodeURIComponent(LOGIN_HOMESERVER)}/`);
    await page.waitForLoadState('networkidle');
    const usernameInput = page.locator(
      'input[name="usernameInput"], input[name="username"]'
    );
    await expect(usernameInput.first()).toBeVisible({ timeout: 20_000 });
    await usernameInput.first().fill(username);
    await page.locator('input[name="passwordInput"], input[name="password"]').first().fill(password);
    await page.getByRole('button', { name: /login/i }).click();
    await page.waitForTimeout(10_000);

    // Navigate to fixture room (use text selector since sidebar items may not be <a> tags)
    const fixtureRoom = page.getByText('Cinny E2E Fixture Room');
    await expect(fixtureRoom.first()).toBeVisible({ timeout: 30_000 });
    await fixtureRoom.first().click();
    await page.waitForTimeout(5_000);
    await page.screenshot({ path: 'test-results/cinny029-01-fixture-room.png' });

    // Wait for thread indicators to appear — "Thread N replies" chip
    // The text may be split across elements, so look for "replies" or the container
    const threadEntry = page.locator('text=/\\d+ replies?/');
    try {
      await expect(threadEntry.first()).toBeVisible({ timeout: 15_000 });
    } catch {
      // Thread text not yet visible — wait more and screenshot
    }
    await page.screenshot({ path: 'test-results/cinny029-02-before-thread-check.png' });
    const threadCount = await threadEntry.count();

    if (threadCount === 0) {
      await page.screenshot({ path: 'test-results/cinny029-02-no-threads.png' });
      test.skip(true, 'No thread indicators found in fixture room');
      return;
    }

    await threadEntry.first().click();
    await page.waitForTimeout(5_000);
    await page.screenshot({ path: 'test-results/cinny029-03-thread-opened.png' });

    // Check for the "Load Older Messages" button
    const loadOlderButton = page.getByText('Load Older Messages');
    const loadOlderCount = await loadOlderButton.count();

    if (loadOlderCount > 0) {
      await page.screenshot({
        path: 'test-results/cinny029-FAIL-spurious-button.png',
        fullPage: true,
      });
    } else {
      await page.screenshot({
        path: 'test-results/cinny029-PASS-no-spurious-button.png',
        fullPage: true,
      });
    }

    // CINNY-029: short threads must NOT show "Load Older Messages" button
    expect(
      loadOlderCount,
      'Short thread should NOT show "Load Older Messages" (CINNY-029)'
    ).toBe(0);

    await expect(page.getByText('Failed to load this thread')).toHaveCount(0);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny029');
  });
});
