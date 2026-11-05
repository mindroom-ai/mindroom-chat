import { expect, test } from '@playwright/test';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

// A spec's own WebKit pages say Safari, not the project's Chrome, so the app takes its Safari
// paths there (no Chrome-only glass refraction) and WebKit screenshots show what Safari shows.
test('WebKit pages of the specs keep Safari’s user agent', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    const fromPage = await browser.newPage({ baseURL });
    const fromContext = await (await browser.newContext({ baseURL })).newPage();
    for (const page of [fromPage, fromContext]) {
      await page.goto('/');
      const userAgent = await page.evaluate(() => navigator.userAgent);
      expect(userAgent).toContain('Safari/');
      expect(userAgent).not.toMatch(/Chrom(e|ium)\//);
    }
  } finally {
    await browser.close();
  }
});
