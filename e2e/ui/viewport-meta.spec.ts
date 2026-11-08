import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

// P2-macos-safari-F011: the viewport meta's `interactive-widget=resizes-content` key, which lets
// Chromium and Firefox resize the page for the on-screen keyboard, is unknown to WebKit, which
// logged `Viewport argument key "interactive-widget" not recognized and ignored.` as a console
// error on every load. WebKit pages (phone, tablet, desktop) now load without it and log no
// viewport error; Chromium pages keep the key. WebKit pages get `maximum-scale=1` instead, so
// iOS does not magnify the page when a field with small text is focused (the app's pinch changes
// the page zoom setting and cannot zoom that magnification back out); Chromium pages do not.

const DEVICES: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};

const viewportContent = (page: Page) =>
  page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content'));

test('WebKit loads the app without a viewport console error', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    for (const [name, device] of Object.entries(DEVICES)) {
      // eslint-disable-next-line no-await-in-loop
      const page = await (await browser.newContext({ ...device, baseURL })).newPage();
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      // eslint-disable-next-line no-await-in-loop
      await page.goto('/');
      // eslint-disable-next-line no-await-in-loop
      await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });
      // eslint-disable-next-line no-await-in-loop
      const content = await viewportContent(page);
      console.log(`webkit ${name}: viewport "${content}", errors ${JSON.stringify(errors)}`);
      expect(content, `webkit ${name}: the page scales to the device`).toContain(
        'width=device-width'
      );
      expect(content, `webkit ${name}: the page covers the safe areas`).toContain(
        'viewport-fit=cover'
      );
      expect(content, `webkit ${name}: focusing a field does not magnify the page`).toContain(
        'maximum-scale=1'
      );
      expect(
        errors.filter((text) => /viewport argument|interactive-widget/i.test(text)),
        `webkit ${name}: no viewport console error`
      ).toEqual([]);
    }
  } finally {
    await browser.close();
  }
});

test('Chromium keeps resizing the page for the on-screen keyboard', async ({
  browser,
  baseURL,
}) => {
  const page = await (await browser.newContext({ ...DEVICES.phone, baseURL })).newPage();
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });
  const content = await viewportContent(page);
  expect(content).toContain('interactive-widget=resizes-content');
  expect(content).not.toContain('maximum-scale');
});
