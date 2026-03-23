import { expect, test } from '@playwright/test';
import { getHomeserver, buildLoginPath } from '../env';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

test.describe('live smoke', () => {
  test('app loads with MindRoom title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MindRoom/);
  });

  test('auth shell renders', async ({ page }) => {
    const homeserver = getHomeserver();
    await page.goto(buildLoginPath(homeserver));

    await expect(page.locator('input[name="serverInput"]')).toBeVisible();
    // Use button role to avoid strict mode violation (both heading and button contain "Login")
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  });

  test('SSO providers visible (if configured)', async ({ page }) => {
    const homeserver = getHomeserver();
    await page.goto(buildLoginPath(homeserver));

    // SSO providers are only available on servers with SSO configured (e.g. mindroom.chat)
    // Local Tuwunel servers may not have SSO — check if any SSO button exists
    const ssoButton = page.locator('a[href*="sso"], [class*="sso"], button:has-text("Sign in with"), a:has-text("Sign in with"), a:has-text("Continue with")');
    const hasSso = await ssoButton.first().isVisible().catch(() => false);

    if (!hasSso) {
      // No SSO configured on this server — just verify login form is present instead
      await expect(page.locator('input[name="usernameInput"]')).toBeVisible();
      await expect(page.locator('input[name="passwordInput"]')).toBeVisible();
      return;
    }

    // If SSO is configured, verify the expected providers
    await expect(page.getByRole('link', { name: 'Sign in with Apple' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
  });

  test('no known-critical console errors on load', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    await page.goto(buildLoginPath(homeserver));

    // Give the app a moment to settle
    await page.waitForTimeout(2000);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'smoke-load');
  });
});
