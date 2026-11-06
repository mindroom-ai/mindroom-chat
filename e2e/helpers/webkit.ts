import {
  test,
  webkit,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';

/** Playwright's WebKit, which the test runners name; the WebKit tests skip without it. */
export const WEBKIT_EXECUTABLE = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;

/**
 * WebKit for a spec's own WebKit test, whose pages keep Safari's user agent.
 *
 * Playwright gives every context the project's options that it does not set itself, and the
 * project's user agent is Chrome's. A WebKit page would then say Chrome, and the app would take
 * its Chrome paths, such as the liquid glass refraction, which WebKit draws without any blur. A
 * key set to `undefined` counts as set, so WebKit keeps its own user agent; options that name
 * one (a device descriptor's, say) still win.
 *
 * Its contexts also block service workers unless the options allow them. Once the app's worker
 * controls a page, Playwright's WebKit routes none of that page's requests: a spec's `route`
 * would let the server's answers through unseen, and its WebKit case would pass without testing
 * what it holds back or changes. A check of the worker itself passes `serviceWorkers: 'allow'`.
 */
export const launchWebKit = async (): Promise<Browser> => {
  // No args: the project's launch options add a Chromium flag, which WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT_EXECUTABLE, args: [] });
  const newContext = browser.newContext.bind(browser);
  // Browser.newPage creates its context through newContext, so this covers pages too.
  browser.newContext = (options?: BrowserContextOptions) =>
    newContext({ userAgent: undefined, serviceWorkers: 'block', ...options });
  return browser;
};

/**
 * Runs `check` on a page of a new WebKit context, saving a screenshot of the page into the test's
 * output when it fails: the test's own trace records only its Chromium page.
 */
export const onWebKitPage = async (
  contextOptions: BrowserContextOptions,
  check: (page: Page) => Promise<void>
): Promise<void> => {
  const browser = await launchWebKit();
  try {
    const page = await (await browser.newContext(contextOptions)).newPage();
    try {
      await check(page);
    } catch (error) {
      await page
        .screenshot({ path: test.info().outputPath('webkit-failure.png') })
        .catch(() => undefined);
      throw error;
    }
  } finally {
    await browser.close();
  }
};
