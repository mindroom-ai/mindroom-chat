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

/** Raw touch points over CDP: each call lists every finger down. */
const fingersOn = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Finger[]) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: fingers.map(([id, x, y]) => ({ id, x, y })),
    });
};

test('a pinch changes the page zoom, not the magnification', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium takes raw touch points over CDP');
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  const touch = await fingersOn(page);

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

// A plugin's board that zooms itself marks its element (`PINCH_SURFACE_ATTRIBUTE` in the client
// SDK's `ui`): a pinch whose fingers all land on it is its own, and the page zoom stays.
test('a pinch on a pinch surface leaves the page zoom, one across its edge changes it', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium takes raw touch points over CDP');
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  // The board covers the page from 300 to 500 px down.
  await page.evaluate(() => {
    const board = document.createElement('div');
    board.setAttribute('data-pinch-surface', '');
    board.style.cssText = 'position: fixed; inset: 300px 0 auto; height: 200px; z-index: 10000';
    board.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
    document.body.append(board);
  });
  const touch = await fingersOn(page);

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
  // One finger on the board and one below it: the page's pinch, from 200 to 250 px apart. Had the
  // board's pinch zoomed the page to 150 %, this one would take it on to 188 %.
  await touch('touchStart', [
    [3, 150, 600],
    [4, 150, 400],
  ]);
  await touch('touchMove', [
    [3, 150, 650],
    [4, 150, 400],
  ]);
  await touch('touchEnd', []);
  await expect.poll(() => storedPageZoom(page)).toBe(125);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
});

// The composer writes at the size of a message body (folds' T400: 15 px on 22 px lines at the
// default page zoom), on a touch screen too, so text keeps its size from the composer to the
// thread at every page zoom. iOS does not zoom into it although that is under 16 px: WebKit pages
// get maximum-scale=1 (index.html, e2e/ui/viewport-meta.spec.ts).
test('the composer writes at the size of a message body at every page zoom', async ({ page }) => {
  await page.goto('/e2e/fixtures/composer-undo.html');
  const composer = page.locator('[contenteditable="true"]');
  await expect(composer).toBeVisible();
  const textAt = (zoom: string) =>
    composer.evaluate((element, rootSize) => {
      document.documentElement.style.fontSize = rootSize;
      const { fontSize, lineHeight } = getComputedStyle(element);
      return [parseFloat(fontSize), parseFloat(lineHeight)];
    }, zoom);

  expect(await textAt('50%')).toEqual([7.5, 11]);
  expect(await textAt('80%')).toEqual([12, 17.6]);
  expect(await textAt('')).toEqual([15, 22]);
  expect(await textAt('150%')).toEqual([22.5, 33]);
});
