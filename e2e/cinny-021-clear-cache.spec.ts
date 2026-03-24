import { expect, test } from '@playwright/test';
import { expectLoggedInShellStable, loginWithPassword } from './helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from './helpers/browserDiagnostics';

const DEPLOYED_BASE_URL = 'http://127.0.0.1:8090';
const HOMESERVER = 'https://mindroom.lab.mindroom.chat';
const USERNAME = 'e2e-test-bot';
const PASSWORD = 'e2e-test-pw-2026';
const TEST_STORAGE_KEY = 'cinny-test-key';
const TEST_STORAGE_VALUE = 'test-value';

test.use({ baseURL: DEPLOYED_BASE_URL });

test('clears app cache from Settings > About without signing the user out', async ({
  page,
}, testInfo) => {
  const diagnostics = attachBrowserDiagnostics(page);

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: USERNAME,
    password: PASSWORD,
  });
  await expect(page).toHaveURL(/\/home\/?$/);
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });

  await page.getByRole('button', { name: /Open account switcher for / }).click();
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByText('Settings', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.getByText('Clear Cache & Reload', { exact: true })).toBeVisible();

  const clearCacheButton = page.getByRole('button', { name: 'Clear Cache' });
  await expect(clearCacheButton).toBeVisible();
  await expect(clearCacheButton).toBeEnabled();

  const beforeScreenshotPath = testInfo.outputPath('before-clear-cache.png');
  await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
  // eslint-disable-next-line no-console
  console.log(`[artifact] before-clear-cache=${beforeScreenshotPath}`);

  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [TEST_STORAGE_KEY, TEST_STORAGE_VALUE] as const
  );
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), TEST_STORAGE_KEY))
    .toBe(TEST_STORAGE_VALUE);

  await Promise.all([
    page.waitForURL((url) => url.searchParams.has('clear_cache'), { timeout: 60_000 }),
    clearCacheButton.click(),
  ]);

  const cacheBustedUrl = page.url();
  // eslint-disable-next-line no-console
  console.log(`[state] cache-busted-url=${cacheBustedUrl}`);
  expect(cacheBustedUrl).toContain('clear_cache=');
  await page.waitForLoadState('domcontentloaded');
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });

  const afterScreenshotPath = testInfo.outputPath('after-clear-cache-reload.png');
  await page.screenshot({ path: afterScreenshotPath, fullPage: true });
  // eslint-disable-next-line no-console
  console.log(`[artifact] after-clear-cache=${afterScreenshotPath}`);

  const postReloadValue = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    TEST_STORAGE_KEY
  );
  // eslint-disable-next-line no-console
  console.log(`[state] after-clear-cache-url=${page.url()}`);
  // eslint-disable-next-line no-console
  console.log(`[state] after-clear-cache-localStorage:${TEST_STORAGE_KEY}=${postReloadValue}`);

  expect(postReloadValue).toBeNull();

  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-021 clear cache live test');
});
