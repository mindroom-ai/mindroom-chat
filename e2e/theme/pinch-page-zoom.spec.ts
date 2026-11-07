import { expect, test, type Page } from '@playwright/test';

// On a touch screen a two-finger pinch changes the app's page zoom setting: the root font size,
// which every rem of the interface follows, so the layout reflows at the new size and stays on
// screen. The browser's own magnification, which would only enlarge the page like a picture,
// stays at 1.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Finger = [id: number, x: number, y: number];

const rootFontSize = (page: Page) => page.evaluate(() => document.documentElement.style.fontSize);

const storedPageZoom = (page: Page) =>
  page.evaluate(
    () => (JSON.parse(localStorage.getItem('settings') ?? '{}') as { pageZoom?: number }).pageZoom
  );

test('a pinch changes the page zoom, not the magnification', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium takes raw touch points over CDP');
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  const session = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Finger[]) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: fingers.map(([id, x, y]) => ({ id, x, y })),
    });

  // The fingers spread from 100 to 150 px apart: 150 %.
  await touch('touchStart', [[1, 150, 400]]);
  await touch('touchStart', [
    [1, 150, 400],
    [2, 250, 400],
  ]);
  await touch('touchMove', [
    [1, 125, 400],
    [2, 275, 400],
  ]);
  await touch('touchEnd', []);
  await expect.poll(() => rootFontSize(page)).toBe('150%');
  expect(await storedPageZoom(page)).toBe(150);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);

  // Pinching in from 150 px to 100 px apart takes it back to 100 %.
  await touch('touchStart', [
    [3, 125, 400],
    [4, 275, 400],
  ]);
  await touch('touchMove', [
    [3, 150, 400],
    [4, 250, 400],
  ]);
  await touch('touchEnd', []);
  await expect.poll(() => storedPageZoom(page)).toBe(100);
  expect(await rootFontSize(page)).toBe('');
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
});
