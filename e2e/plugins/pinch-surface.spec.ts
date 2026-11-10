import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { roomMoreOptions } from '../helpers/roomMenu';
import { openPanelRoom } from '../helpers/sidePanels';
import { serveBuild } from '../helpers/staticBuildServer';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. Its card's "Example pinch
// board" is a pinch surface of the client SDK's `usePinchSurface`: the app's page zoom hands it the
// pinches whose fingers all land on it, with their scale and centre, and the board scales its box
// around that centre. A pinch across its edge changes the Page Zoom setting and leaves the box. In
// Chromium the fingers are real touches over CDP; in WebKit, which takes none, they are touch and
// gesture events dispatched in the order iOS sends them, and ctrl with the wheel is real.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');

// Screenshots of each step go to the test's output.
test.use({ viewport: { width: 1600, height: 1000 }, video: 'off' });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-pinch-build-'));
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: PLUGIN },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugin failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

type Finger = [id: number, x: number, y: number];
type Spot = { x: number; y: number };

const board = (page: Page) => page.getByRole('group', { name: 'Example pinch board' });
const pinchBox = (page: Page) => page.locator('[data-example-pinch-box]');
const boxScale = (page: Page) => page.getByText(/^Box scale: /);
const pinching = (page: Page) => page.getByText('Pinching', { exact: true });

const storedPageZoom = (page: Page) =>
  page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('settings') ?? '{}') as { pageZoom?: number }).pageZoom ??
      100
  );

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not laid out');
  return box;
};

/** Within half a pixel, for sub-pixel layout. */
const expectNear = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(0.5);

/** Where on the board a point `x`, `y` px from its top left corner is, inside its border. */
const onBoard = async (page: Page, x: number, y: number): Promise<Spot> => {
  const { x: left, y: top } = await boxOf(board(page));
  return { x: left + 1 + x, y: top + 1 + y };
};

/** Serves the build, opens the panel room in a page of its own, opens the card, runs `check`. */
const withBoard = async (
  browser: Browser,
  options: { hasTouch: boolean },
  check: (page: Page) => Promise<void>
) => {
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin, ...options });
  const page = await context.newPage();
  // A new account is asked to set up a recovery password; this spec has no use for one.
  await page.addLocatorHandler(
    page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' }),
    (dialog) => dialog.getByRole('button', { name: 'Not now', exact: true }).click()
  );
  try {
    await openPanelRoom(context, page);
    await roomMoreOptions(page).click();
    await page.getByRole('menuitemcheckbox', { name: 'Example card', exact: true }).click();
    await expect(board(page)).toBeVisible();
    await expect(boxScale(page)).toHaveText('Box scale: 1.00');
    // The card slides in beside the conversation: the board is where it stays once it has.
    await page
      .locator('[data-example-card-box]')
      .evaluate((box) => Promise.all(box.getAnimations().map((motion) => motion.finished)));
    await check(page);
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
};

/** Raw touch points over CDP: each call lists every finger down. */
const fingersOn = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Finger[]) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: fingers.map(([id, x, y]) => ({ id, x, y })),
    });
};

test('a pinch on a plugin surface scales its box around the fingers, and the page zoom stays', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium takes raw touch points over CDP');
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withBoard(browser, { hasTouch: true }, async (page) => {
    const touch = await fingersOn(page);

    // Around the box's middle, 40 then 80 px apart: twice the size, its middle where it was.
    const middle = await onBoard(page, 30, 30);
    await touch('touchStart', [[1, middle.x - 20, middle.y]]);
    await touch('touchStart', [
      [1, middle.x - 20, middle.y],
      [2, middle.x + 20, middle.y],
    ]);
    await touch('touchMove', [
      [1, middle.x - 40, middle.y],
      [2, middle.x + 40, middle.y],
    ]);
    await expect(boxScale(page)).toHaveText('Box scale: 2.00');
    await expect(pinching(page)).toBeVisible();
    await touch('touchEnd', []);
    await expect(pinching(page)).toHaveCount(0);
    const scaled = await boxOf(pinchBox(page));
    await page.screenshot({ path: test.info().outputPath('chromium-board-pinch.png') });
    expectNear(scaled.width, 120);
    expectNear(scaled.x + scaled.width / 2, middle.x);
    expectNear(scaled.y + scaled.height / 2, middle.y);
    expect(await storedPageZoom(page)).toBe(100);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);

    // One finger on the board and one on the conversation beside the card, 200 then 250 px apart:
    // the page's pinch, and the box stays.
    const edge = await onBoard(page, 100, 120);
    await touch('touchStart', [[3, edge.x, edge.y]]);
    await touch('touchStart', [
      [3, edge.x, edge.y],
      [4, edge.x - 200, edge.y],
    ]);
    await touch('touchMove', [
      [3, edge.x, edge.y],
      [4, edge.x - 250, edge.y],
    ]);
    await touch('touchEnd', []);
    await expect.poll(() => storedPageZoom(page)).toBe(125);
    await page.screenshot({ path: test.info().outputPath('chromium-across-edge.png') });
    await expect(boxScale(page)).toHaveText('Box scale: 2.00');
    await expect(pinching(page)).toHaveCount(0);

    // A finger lands on an element of the board that goes mid-pinch: the other finger's moves
    // still scale the box, and once they lift, though the first finger's end is lost, the
    // box's pinch ends.
    await page.evaluate(() => {
      const stone = document.createElement('div');
      stone.id = 'pinch-stone';
      stone.style.cssText = 'position: absolute; left: 10px; top: 100px; width: 30px; height: 30px';
      document.querySelector('[aria-label="Example pinch board"]')?.append(stone);
    });
    const [stone, far] = [await onBoard(page, 20, 110), await onBoard(page, 200, 110)];
    await touch('touchStart', [[5, stone.x, stone.y]]);
    await touch('touchStart', [
      [5, stone.x, stone.y],
      [6, far.x, far.y],
    ]);
    await touch('touchMove', [
      [5, stone.x, stone.y],
      [6, far.x + 40, far.y],
    ]);
    await expect(pinching(page)).toBeVisible();
    await page.evaluate(() => document.getElementById('pinch-stone')?.remove());
    await touch('touchMove', [
      [5, stone.x, stone.y],
      [6, far.x + 60, far.y],
    ]);
    // 180 px apart at the start, 240 now.
    await expect(boxScale(page)).toHaveText('Box scale: 2.67');
    await touch('touchEnd', []);
    await expect(pinching(page)).toHaveCount(0);

    // The next pinch, on the conversation, is the app's: 125 % times 1.2.
    const beside = { x: edge.x - 400, y: edge.y };
    await touch('touchStart', [[7, beside.x, beside.y]]);
    await touch('touchStart', [
      [7, beside.x, beside.y],
      [8, beside.x, beside.y + 100],
    ]);
    await touch('touchMove', [
      [7, beside.x, beside.y],
      [8, beside.x, beside.y + 120],
    ]);
    await touch('touchEnd', []);
    await expect.poll(() => storedPageZoom(page)).toBe(150);
    await page.screenshot({ path: test.info().outputPath('chromium-after-lost-ends.png') });
    await expect(boxScale(page)).toHaveText('Box scale: 2.67');
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  });
});

/**
 * Dispatches a touch event in the page, as WebKit sends one: `fingers` lists every finger down,
 * each with the element under it as it landed, and the event goes to finger `at`'s element (by
 * default the last listed). Returns whether the page zoom prevented its default.
 */
const synthTouch = (
  page: Page,
  type: 'touchstart' | 'touchmove' | 'touchend',
  fingers: Finger[],
  at = fingers[fingers.length - 1]?.[0]
) =>
  page.evaluate(
    ([eventType, points, atId]) => {
      const held = window as unknown as { pinchFingers?: Map<number, Element> };
      held.pinchFingers ??= new Map();
      const landed = held.pinchFingers;
      const touches = points.map(([identifier, clientX, clientY]) => {
        if (!landed.has(identifier)) {
          landed.set(identifier, document.elementFromPoint(clientX, clientY) ?? document.body);
        }
        return { identifier, clientX, clientY, target: landed.get(identifier) };
      });
      const event = new Event(eventType, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      (landed.get(atId ?? -1) ?? document.body).dispatchEvent(event);
      return event.defaultPrevented;
    },
    [type, fingers, at] as const
  );

/** Dispatches Safari's gesture event at the element under `spot`, with `scale`. */
const synthGesture = (
  page: Page,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  spot: Spot
) =>
  page.evaluate(
    ([eventType, gestureScale, { x, y }]) => {
      const event = new Event(eventType, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'scale', { value: gestureScale });
      Object.defineProperty(event, 'clientX', { value: x });
      Object.defineProperty(event, 'clientY', { value: y });
      (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(event);
      return event.defaultPrevented;
    },
    [type, scale, spot] as const
  );

test('in WebKit, iOS pinches, a trackpad gesture and ctrl with the wheel scale the board alone', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  const webkit = await launchWebKit();
  try {
    await withBoard(webkit, { hasTouch: false }, async (page) => {
      // iOS's order: the first finger, the gesture's start, then the second finger, 40 then 80 px
      // apart around the box's middle, then a third finger beside the card, which changes nothing.
      const middle = await onBoard(page, 30, 30);
      const outside = { x: middle.x - 400, y: middle.y };
      expect(await synthTouch(page, 'touchstart', [[1, middle.x - 20, middle.y]])).toBe(false);
      expect(await synthGesture(page, 'gesturestart', 1, middle)).toBe(true);
      const both: Finger[] = [
        [1, middle.x - 20, middle.y],
        [2, middle.x + 20, middle.y],
      ];
      await synthTouch(page, 'touchstart', both);
      const spread: Finger[] = [
        [1, middle.x - 40, middle.y],
        [2, middle.x + 40, middle.y],
      ];
      expect(await synthTouch(page, 'touchmove', spread)).toBe(true);
      expect(await synthGesture(page, 'gesturechange', 2, middle)).toBe(true);
      await synthTouch(page, 'touchstart', [...spread, [3, outside.x, outside.y]]);
      await synthTouch(page, 'touchmove', [...spread, [3, outside.x - 50, outside.y]]);
      await expect(boxScale(page)).toHaveText('Box scale: 2.00');
      // The third finger lifts, then the second: one finger is left, and the pinch ends.
      await synthTouch(page, 'touchend', spread, 3);
      await expect(pinching(page)).toBeVisible();
      await synthTouch(page, 'touchend', [spread[0]!], 2);
      await expect(pinching(page)).toHaveCount(0);
      await synthTouch(page, 'touchend', [], 1);
      await synthGesture(page, 'gestureend', 2, middle);
      const scaled = await boxOf(pinchBox(page));
      await page.screenshot({ path: test.info().outputPath('webkit-ios-pinch.png') });
      expectNear(scaled.width, 120);
      expectNear(scaled.x + scaled.width / 2, middle.x);
      expect(await storedPageZoom(page)).toBe(100);

      // A trackpad's gesture over the board halves the box; one beside the card zooms the page.
      expect(await synthGesture(page, 'gesturestart', 1, middle)).toBe(true);
      await synthGesture(page, 'gesturechange', 0.5, middle);
      await expect(pinching(page)).toBeVisible();
      await synthGesture(page, 'gestureend', 0.5, middle);
      await expect(boxScale(page)).toHaveText('Box scale: 1.00');
      await expect(pinching(page)).toHaveCount(0);
      expect(await storedPageZoom(page)).toBe(100);
      await synthGesture(page, 'gesturestart', 1, outside);
      await synthGesture(page, 'gesturechange', 1.2, outside);
      await synthGesture(page, 'gestureend', 1.2, outside);
      await expect.poll(() => storedPageZoom(page)).toBe(120);
      await page.screenshot({ path: test.info().outputPath('webkit-trackpad.png') });

      // Ctrl with the wheel over the board, a real wheel: one pinch, which ends once it rests.
      const board2 = await onBoard(page, 100, 100);
      await page.mouse.move(board2.x, board2.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -50);
      await page.keyboard.up('Control');
      await expect(boxScale(page)).not.toHaveText('Box scale: 1.00');
      expect(
        Number((await boxScale(page).textContent())?.slice('Box scale: '.length))
      ).toBeGreaterThan(1);
      await expect(pinching(page)).toHaveCount(0);
      expect(await storedPageZoom(page)).toBe(120);
      await page.screenshot({ path: test.info().outputPath('webkit-wheel.png') });
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    });
  } finally {
    await webkit.close();
  }
});
