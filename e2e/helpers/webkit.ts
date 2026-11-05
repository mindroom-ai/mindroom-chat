import { webkit, type Browser, type BrowserContextOptions } from '@playwright/test';

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
 */
export const launchWebKit = async (): Promise<Browser> => {
  // No args: the project's launch options add a Chromium flag, which WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT_EXECUTABLE, args: [] });
  const newContext = browser.newContext.bind(browser);
  // Browser.newPage creates its context through newContext, so this covers pages too.
  browser.newContext = (options?: BrowserContextOptions) =>
    newContext({ userAgent: undefined, ...options });
  return browser;
};
