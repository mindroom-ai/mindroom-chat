import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { sampleScreenshot } from '../helpers/glassVisual';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// The page that the native iOS tests load in place of the web bundle (ios/Tests/public/; see
// ios/Tests/RoomRouteReloadTests.swift and ios/Tests/UI/NativeDiagnosticsTests.swift), served as
// the app's native asset handler serves it: a file of that folder by its root path, index.html
// for every app route. Checked at phone size in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit (the iPhone engine), in WebKit.
const ORIGIN = 'http://ios-test-page.localhost';
const PUBLIC = new URL('../../ios/Tests/public/', import.meta.url);
const ASSETS: Record<string, string> = { '/boot.js': 'text/javascript', '/style.css': 'text/css' };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
// A room route whose last segment looks like a file to the native asset handler.
const DEEP_ROUTE = '/home/!room%3Aexample.mp4';
const FIXTURE_COLOR = [21, 62, 53];

// A native snapshot with enough events to make the result's label thousands of characters long.
const SNAPSHOT = {
  schemaVersion: 1,
  status: 'available',
  currentSessionId: 'session-a',
  droppedEventCount: 0,
  events: Array.from({ length: 200 }, (_, index) => ({
    at: 1_700_000_000_000 + index,
    monotonicMs: index,
    sequence: index + 1,
    sessionId: 'session-a',
    name: index === 0 ? 'app.launch' : 'scene.active',
    data: { attached: true, hidden: false, loading: false, opaque: false, transparent: false },
  })),
};

const resultButton = (page: Page) => page.getByRole('button', { name: /^Native diagnostics / });
const readButton = (page: Page) =>
  page.getByRole('button', { name: 'Read native diagnostics', exact: true });
/** The label that the UI test decodes: the prefix, then the snapshot and the page's read count. */
const label = (snapshot: object, readCount: number) =>
  `Native diagnostics ${JSON.stringify({ ...snapshot, readCount })}`;
const bootId = (page: Page) =>
  page.evaluate(() => (window as Window & { routingBootId?: unknown }).routingBootId);

/** Serves the folder like the native asset handler and returns the paths the pages request. */
const serve = async (context: BrowserContext): Promise<string[]> => {
  const requested: string[] = [];
  await context.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    requested.push(pathname);
    const contentType = ASSETS[pathname];
    const file = contentType ? pathname : '/index.html';
    await route.fulfill({
      body: readFileSync(new URL(`.${file}`, PUBLIC)),
      contentType: contentType ?? 'text/html',
    });
  });
  return requested;
};

/** A stand-in for the Capacitor bridge whose diagnostics read answers the snapshot. */
const installBridge = (context: BrowserContext) =>
  context.addInitScript((snapshot) => {
    const calls: unknown[] = [];
    Object.assign(window, {
      nativeCalls: calls,
      Capacitor: {
        isPluginAvailable: (name: string) => name === 'MindRoomDiagnostics',
        nativePromise: (plugin: string, method: string, options: object) => {
          calls.push([plugin, method, options]);
          return Promise.resolve(snapshot);
        },
      },
    });
  }, SNAPSHOT);

const checkWithBridge = async (context: BrowserContext) => {
  const requested = await serve(context);
  await installBridge(context);
  const page = await context.newPage();
  await page.goto(`${ORIGIN}${DEEP_ROUTE}`);
  await expect(resultButton(page)).toHaveAccessibleName(label(SNAPSHOT, 1));

  // Its assets come from the web root at any route, and it leaves policy and storage to the tests.
  const assets = requested.filter((path) => path !== DEEP_ROUTE && path !== '/favicon.ico');
  expect(assets.sort()).toEqual(['/boot.js', '/style.css']);
  expect(
    await page.evaluate(() => ({
      contentType: document.contentType,
      background: getComputedStyle(document.body).backgroundColor,
      policies: document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]').length,
      stored: localStorage.length + sessionStorage.length,
      cookie: document.cookie,
    }))
  ).toEqual({
    contentType: 'text/html',
    background: 'rgb(21, 62, 53)',
    policies: 0,
    stored: 0,
    cookie: '',
  });

  // Every boot has its own id, and a reload stays at the same URL.
  const first = await bootId(page);
  expect(typeof first === 'string' && first.length > 0).toBe(true);
  await page.reload();
  await expect(resultButton(page)).toHaveAccessibleName(label(SNAPSHOT, 1));
  const second = await bootId(page);
  expect(typeof second === 'string' && second.length > 0).toBe(true);
  expect(second).not.toBe(first);
  expect(page.url()).toBe(`${ORIGIN}${DEEP_ROUTE}`);

  // A tap reads again, and the label counts the reads of this boot.
  await readButton(page).click();
  await expect(resultButton(page)).toHaveAccessibleName(label(SNAPSHOT, 2));
  expect(
    await page.evaluate(() => (window as Window & { nativeCalls?: unknown }).nativeCalls)
  ).toEqual([
    ['MindRoomDiagnostics', 'read', {}],
    ['MindRoomDiagnostics', 'read', {}],
  ]);

  // The buttons stay small and in the top half, and the centre of the view shows the color.
  const viewport = page.viewportSize() ?? PHONE.viewport;
  await expect(readButton(page)).toBeInViewport();
  for (const button of [readButton(page), resultButton(page)]) {
    const box = await button.boundingBox();
    expect(box && box.y + box.height < viewport.height / 2).toBe(true);
  }
  const [centre] = await sampleScreenshot(page, [
    { x: viewport.width / 2, y: viewport.height / 2 },
  ]);
  const matches = FIXTURE_COLOR.every(
    (value, channel) => Math.abs((centre?.[channel] ?? -1) - value) <= 5
  );
  expect(matches, `centre pixel ${String(centre)}`).toBe(true);
};

const checkWithoutBridge = async (context: BrowserContext) => {
  await serve(context);
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await expect(resultButton(page)).toHaveAccessibleName(
    label({ status: 'unsupported', events: [] }, 1)
  );
  await page.evaluate(() => {
    Object.assign(window, {
      Capacitor: {
        isPluginAvailable: () => true,
        nativePromise: () => Promise.reject(new Error('read failed')),
      },
    });
  });
  await readButton(page).click();
  await expect(resultButton(page)).toHaveAccessibleName(
    label({ status: 'unavailable', events: [] }, 2)
  );
};

test('the native test page boots at app routes and shows native diagnostics', async ({
  browser,
}) => {
  const context = await browser.newContext(PHONE);
  try {
    await checkWithBridge(context);
  } finally {
    await context.close();
  }
});

test('the native test page reports a missing or failing diagnostics plugin', async ({
  browser,
}) => {
  const context = await browser.newContext(PHONE);
  try {
    await checkWithoutBridge(context);
  } finally {
    await context.close();
  }
});

test('the native test page works the same in WebKit', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    await checkWithBridge(await browser.newContext(PHONE));
    await checkWithoutBridge(await browser.newContext(PHONE));
  } finally {
    await browser.close();
  }
});
