import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { previewBuildDir, serveBuild } from '../helpers/staticBuildServer';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A deployment while the app is open (L7-F018). A page that already loaded every part it uses has
// nothing fail to load, and said nothing until the person reloaded on their own. The page must
// offer the new version once it is shown again (or comes back online, or after its five-minute
// check). Served from the production build of scripts/e2e-slot.sh --preview by a static server
// whose version.json the test changes, as a deployment does. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver.
const PASSWORD = 'new-version-announced-password';
const RUN = Date.now().toString(36);

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.skip(!previewBuildDir(), 'Needs the production build of scripts/e2e-slot.sh --preview');
});

const deployment = { version: undefined as string | undefined };

type Box = { x: number; y: number; width: number; height: number };

/** Saves a screenshot as `<name>.png` when CONNECTION_STATE_SHOTS names a directory. */
const shot = async (page: Page, name: string) => {
  const directory = process.env.CONNECTION_STATE_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

/** What the notice is placed against: the room list on a desktop, the top bar on a phone. */
const anchorOf = (page: Page) =>
  (page.viewportSize()?.width ?? 0) <= 750
    ? page.locator('[data-phone-top-bar]')
    : page.getByTestId('resizable-page-nav');

/**
 * The notice is a card floating over the page, which stays where it was: inside the room list at
 * its foot on a desktop, right below the top bar on a phone, with nothing painted over it.
 */
const floatsInItsPlace = async (page: Page, anchorBefore: Box) => {
  const phone = (page.viewportSize()?.width ?? 0) <= 750;
  const card = page.locator('[data-new-version-card]');
  await expect(card).toHaveAttribute('data-new-version-card', phone ? 'page' : 'list');
  const anchor = await anchorOf(page).boundingBox();
  const box = await card.boundingBox();
  if (!anchor || !box) throw new Error('the notice card or what it is placed against has no size');
  expect(anchor).toEqual(anchorBefore);
  if (phone) {
    expect(box.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
    expect(box.y).toBeLessThan(anchor.y + anchor.height + 24);
  } else {
    expect(box.x).toBeGreaterThanOrEqual(anchor.x);
    expect(box.x + box.width).toBeLessThanOrEqual(anchor.x + anchor.width);
    expect(box.y + box.height).toBeLessThanOrEqual(anchor.y + anchor.height);
    expect(anchor.y + anchor.height - (box.y + box.height)).toBeLessThan(32);
  }
  expect(
    await card.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const hit = document.elementFromPoint(x + width / 2, y + height / 2);
      return hit !== null && element.contains(hit);
    })
  ).toBe(true);
};

const announcesTheNewVersion = async (page: Page, browserName: string) => {
  const user = await registerDisposableUser(`newver_${browserName}_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  const notice = page.getByText('A new version of MindRoom is available.');
  // The page's own build: nothing to announce, also when it is shown again.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2_000);
  await expect(notice).toHaveCount(0);

  const anchorBefore = await anchorOf(page).boundingBox();
  if (!anchorBefore) throw new Error('no room list or top bar to place the notice against');

  deployment.version = `deployment-${browserName}-${RUN}`;
  // The person comes back to the tab.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const region = page.locator('[data-new-version-notice]');
  if ((await region.getAttribute('data-phone-layer-open')) !== null) {
    // A phone's drawer, out on a section's own page, covers the page: the notice waits under it.
    await expect(page.locator('[data-new-version-card]')).toBeAttached({ timeout: 15_000 });
    await expect(notice).toBeHidden();
    await page.keyboard.press('Escape');
  }
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await floatsInItsPlace(page, anchorBefore);
  await shot(page, `new-version-${browserName}`);
};

const withDeployment = async (run: (origin: string) => Promise<void>) => {
  deployment.version = undefined;
  const server = await serveBuild(previewBuildDir()!, {
    publishedVersion: () => deployment.version,
  });
  try {
    await run(server.origin);
  } finally {
    await server.close();
  }
};

test('a deployment is announced when the page is shown again (Chromium)', async ({
  browser,
  browserName,
}) => {
  test.setTimeout(180_000);
  await withDeployment(async (origin) => {
    const context = await browser.newContext({ baseURL: origin });
    try {
      await announcesTheNewVersion(await context.newPage(), browserName);
    } finally {
      await context.close();
    }
  });
});

test('a deployment is announced when the page is shown again (WebKit)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await withDeployment((origin) =>
    onWebKitPage(
      { viewport: { width: 390, height: 844 }, hasTouch: true, baseURL: origin },
      (page) => announcesTheNewVersion(page, 'webkit')
    )
  );
});
