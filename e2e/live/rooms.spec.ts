import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live rooms', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('room list renders at least one room', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    // Wait for at least one room nav link to appear in the sidebar
    const roomLinks = page.locator('nav a[aria-selected]');
    await expect(roomLinks.first()).toBeVisible({ timeout: 30_000 });

    const count = await roomLinks.count();
    expect(count).toBeGreaterThanOrEqual(1);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'room-list');
  });

  test('room navigation shows timeline', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    // Wait for room list to populate
    const roomLinks = page.locator('nav a[aria-selected]');
    await expect(roomLinks.first()).toBeVisible({ timeout: 30_000 });

    // Click the first room
    await roomLinks.first().click();

    // Expect a timeline/message area to appear (PageContent or message composer)
    const timeline = page.locator('[class*="PageContent"], [class*="RoomTimeline"]');
    await expect(timeline.first()).toBeVisible({ timeout: 30_000 });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'room-navigation');
  });

  test('no Unexpected Application Error after room navigation', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    // Wait for room list
    const roomLinks = page.locator('nav a[aria-selected]');
    await expect(roomLinks.first()).toBeVisible({ timeout: 30_000 });

    // Navigate to first room
    await roomLinks.first().click();
    await page.waitForTimeout(2_000);

    await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'no-app-error');
  });
});
