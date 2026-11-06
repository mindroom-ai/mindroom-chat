import { expect, test, type Page } from '@playwright/test';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Once the app's service worker controls a page, Playwright's WebKit routes none of that page's
// requests, so the contexts of launchWebKit block the worker unless a spec allows it
// (e2e/helpers/webkit.ts). Here a route on config.json sees the app's first load and two reloads.

const isConfig = (url: string) => new URL(url).pathname.endsWith('/config.json');

/** Runs `load` and waits for the config.json it fetches. */
const loadApp = async (page: Page, load: () => Promise<unknown>) => {
  const answer = page.waitForResponse((response) => isConfig(response.url()));
  await load();
  await answer;
};

test('a route on a WebKit page sees every load of the app', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    const page = await (await browser.newContext({ baseURL })).newPage();
    let routed = 0;
    let answered = 0;
    await page.route('**/config.json', async (route) => {
      routed += 1;
      await route.continue();
    });
    page.on('response', (response) => {
      if (isConfig(response.url())) answered += 1;
    });
    await loadApp(page, () => page.goto('/'));
    // A worker the context let in controls the page about a second after its first load.
    await page
      .waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 10_000 })
      .catch(() => undefined);
    await loadApp(page, () => page.reload());
    await loadApp(page, () => page.reload());
    expect(answered).toBeGreaterThanOrEqual(3);
    expect(routed, 'config.json answers that no route saw').toBe(answered);
  } finally {
    await browser.close();
  }
});
