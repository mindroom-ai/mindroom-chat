import { expect, test, type Browser, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { createPrivateRoom } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A press on the button of an open menu closes the menu and leaves it closed. The menu's focus
// trap closes it as the press starts (a click outside it); the click that ends the press then
// reached the button, which opened the menu again. Mouse on a desktop and touch on a phone,
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit, against the
// disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'menu-trigger-spec-password';
const RUN = Date.now().toString(36);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const STARTUP_MS = 120_000;

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = (name: string) => registerDisposableUser(`toggle_${name}_${RUN}`, PASSWORD);

const pressTwice = async (page: Page, name: string, touch: boolean) => {
  const reader = await register(name);
  const roomName = `Quay notes ${name} ${RUN}`;
  const roomId = await createPrivateRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    topic: 'Mooring lines and fenders',
  });
  await page.goto(buildLoginPath(HOMESERVER));
  await page.locator('input[name="usernameInput"]').fill(reader.username, { timeout: STARTUP_MS });
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/(home|inbox|direct)\//, { timeout: STARTUP_MS });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(page.getByRole('heading', { level: 1, name: roomName })).toBeVisible({
    timeout: STARTUP_MS,
  });

  const options = page
    .getByRole('main')
    .getByRole('button', { name: 'More Options', exact: true })
    .first();
  const menu = page.getByRole('menu');
  // At the button's place on the screen, as a finger or the mouse presses it: whatever lies on
  // top there while the menu is open takes the press.
  const box = await options.boundingBox();
  if (!box) throw new Error('No More Options button');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const press = () => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  await press();
  await expect(menu).toBeVisible();
  await press();
  await expect(menu).toHaveCount(0);
  // The menu does not come back once the press has ended either.
  await page.waitForTimeout(500);
  await expect(menu).toHaveCount(0);
  // The next press opens it again.
  await press();
  await expect(menu).toBeVisible();
  if (!touch) return;

  // A finger reaches the button 2 px past its box (44 px touch area): a tap there closes the menu
  // and leaves it closed as well, and the next one opens it.
  const edge = () => page.touchscreen.tap(x, box.y - 1);
  await edge();
  await expect(menu).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(menu).toHaveCount(0);
  await edge();
  await expect(menu).toBeVisible();
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a press on the button of an open menu closes it';

for (const touch of [false, true]) {
  const device = touch ? 'phone, touch' : 'desktop, mouse';
  const viewport = touch ? PHONE : DESKTOP;
  test(`${TITLE} (Chromium, ${device})`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({
      viewport,
      hasTouch: touch,
      isMobile: touch,
      baseURL,
    });
    try {
      await pressTwice(await context.newPage(), touch ? 'cp' : 'cd', touch);
    } finally {
      await context.close();
    }
  });

  test(`${TITLE} (WebKit, ${device})`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    let own: Browser | undefined;
    try {
      own = await launchWebKit();
      const context = await own.newContext({ viewport, hasTouch: touch, baseURL });
      await pressTwice(await context.newPage(), touch ? 'wp' : 'wd', touch);
    } finally {
      await own?.close();
    }
  });
}
