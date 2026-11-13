import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The thread banner's buttons and a message's hover toolbar have no tile at rest and show a
// surface while a pointer hovers them. A touch screen keeps :hover on the element tapped last, so
// there a tapped button kept that surface and read as pressed: after Unpin the pin still looked
// pinned. On a phone (390 by 844, touch) a tap leaves no surface behind, while the pressed pin, the
// resolved check and keyboard focus keep theirs, and a mouse still gets the hover surface. WebKit
// also hovered the button that slid under the finger after a tap and opened its tooltip (Resolve
// after Unpin); on the phone no tooltip opens after a tap, while keyboard focus and a mouse still
// open them. Checked in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit,
// in WebKit.
// Set BANNER_TOUCH_SHOTS=<directory> to save the banner after each step.
const PASSWORD = 'thread-banner-touch-hover-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.BANNER_TOUCH_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const REPLIES = [
  'The load test passed at 2,100 requests per second.',
  'Security review signs off on Thursday.',
  'The API page needs one more pass before the docs ship.',
] as const;
// The banner buttons that rest without a tile.
const QUIET = ['Thread options', 'Pin thread', 'Resolve'];

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `bth_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

/** A room the reader created, so they may pin, with one thread of a few replies. */
const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, { name: 'Launch planning' });
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Which checks still block the launch?',
  });
  let last = rootId;
  for (const body of REPLIES) {
    // eslint-disable-next-line no-await-in-loop
    last = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: last },
      },
    });
  }
  return { reader, roomId, rootId };
};

type World = Awaited<ReturnType<typeof seed>>;

const openThread = async (page: Page, world: World) => {
  await page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`);
  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(REPLIES[2], { exact: true })).toBeVisible({ timeout: 60_000 });
  return banner;
};

/** A finger or a pointer on the middle of a button, without Playwright scrolling it first. */
const center = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to press');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A button's surface and the states it is in. */
const look = (button: Locator) =>
  button.evaluate((element) => {
    const fill = getComputedStyle(element).backgroundColor;
    const channels =
      /rgba?\(([^)]+)\)/
        .exec(fill)?.[1]
        ?.split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number) ?? [];
    const [red = 0, green = 0, blue = 0, opacity = 1] = channels;
    return {
      name: element.getAttribute('aria-label') ?? '',
      fill,
      alpha: fill === 'transparent' || channels.length < 3 ? 0 : opacity,
      green: channels.length >= 3 && green > red + 30 && green > blue,
      hover: element.matches(':hover'),
      focusVisible: element.matches(':focus-visible'),
      pressed: element.getAttribute('aria-pressed') === 'true',
    };
  });

const shot = async (page: Page, target: Locator, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return;
  const x = Math.max(0, box.x - 12);
  const y = Math.max(0, box.y - 12);
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    clip: {
      x,
      y,
      width: Math.min(viewport.width - x, box.width + 24),
      height: Math.min(viewport.height - y, box.height + 24),
    },
  });
};

/** The tooltips on screen. */
const shownTooltips = (page: Page) => page.locator('[role="tooltip"]:visible');

/** No tooltip opens after a tap; the top of the screen is saved to show it. */
const expectNoTooltip = async (page: Page, name: string, where: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(SHOTS, `${name}-top.png`),
      clip: { x: 0, y: 0, width: PHONE.viewport?.width ?? 390, height: 200 },
    });
  }
  const texts = await shownTooltips(page).allTextContents();
  expect.soft(texts, `${where}: no tooltip opens after a tap`).toEqual([]);
};

/** No quiet banner button keeps a surface after a tap, unless it is pressed or keyboard-focused. */
const expectNoLeftoverSurface = async (banner: Locator, where: string) => {
  const looks = await Promise.all(
    QUIET.map(async (name) => {
      const button = banner.getByRole('button', { name, exact: true });
      return (await button.isVisible()) ? look(button) : undefined;
    })
  );
  const shown = looks.filter((state): state is NonNullable<typeof state> => state !== undefined);
  console.log(`${where}: ${JSON.stringify(shown)}`);
  expect(shown.length, `${where}: the quiet buttons are on screen`).toBeGreaterThan(0);
  for (const state of shown) {
    if (!state.pressed && !state.focusVisible) {
      expect
        .soft(state.alpha, `${where}: ${state.name} rests without a surface (${state.fill})`)
        .toBeLessThan(0.01);
    }
  }
};

const checkPhone = async (page: Page, world: World, engine: string) => {
  await expect
    .poll(() => page.evaluate(() => matchMedia('(hover: none)').matches), {
      message: `${engine}: the phone reports a pointer that cannot hover`,
    })
    .toBe(true);
  const banner = await openThread(page, world);
  const button = (name: string) => banner.getByRole('button', { name, exact: true });
  const tap = async (name: string) => {
    // A button waits, disabled, while the change before it is saved.
    await expect(button(name)).toBeEnabled({ timeout: 20_000 });
    const { x, y } = await center(button(name));
    await page.touchscreen.tap(x, y);
  };

  await tap('Pin thread');
  await expect(button('Unpin thread')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 20_000,
  });
  await page.waitForTimeout(400);
  const pinned = await look(button('Unpin thread'));
  expect(pinned.alpha, `${engine}: the pressed pin keeps its surface`).toBeGreaterThan(0.01);
  await shot(page, banner, `banner-pinned-${engine}-phone`);
  await expectNoTooltip(page, `banner-pinned-${engine}-phone`, `${engine} after Pin`);

  await tap('Unpin thread');
  await expect(button('Pin thread')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await shot(page, banner, `banner-after-unpin-${engine}-phone`);
  await expectNoTooltip(page, `banner-after-unpin-${engine}-phone`, `${engine} after Unpin`);
  await expectNoLeftoverSurface(banner, `${engine} after Unpin`);

  await tap('Resolve');
  await expect(button('Resolved')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);
  const resolved = await look(button('Resolved'));
  expect(resolved.green && resolved.alpha > 0.9, `${engine}: the check stays solid green`).toBe(
    true
  );
  await shot(page, banner, `banner-resolved-${engine}-phone`);
  await expectNoTooltip(page, `banner-resolved-${engine}-phone`, `${engine} after Resolve`);

  await tap('Resolved');
  await expect(button('Resolve')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await shot(page, banner, `banner-after-reopen-${engine}-phone`);
  await expectNoTooltip(page, `banner-after-reopen-${engine}-phone`, `${engine} after reopening`);
  await expectNoLeftoverSurface(banner, `${engine} after reopening`);

  // A keyboard keeps its focus surface: Tab from Thread options to the pin. WebKit, as Safari,
  // tabs to buttons with Option held.
  await expect(button('Thread options')).toBeEnabled({ timeout: 20_000 });
  await expect(button('Pin thread')).toBeEnabled({ timeout: 20_000 });
  await button('Thread options').focus();
  await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
  const focused = await look(page.locator(':focus'));
  console.log(`${engine} Tab: ${JSON.stringify(focused)}`);
  expect(focused.name, `${engine}: Tab reaches the pin`).toBe('Pin thread');
  expect(focused.focusVisible, `${engine}: the pin shows keyboard focus`).toBe(true);
  expect(focused.alpha, `${engine}: keyboard focus keeps its surface`).toBeGreaterThan(0.01);
  // Keyboard focus still names the button in its tooltip.
  await expect(
    shownTooltips(page).filter({ hasText: 'Pin thread' }),
    `${engine}: Tab to the pin opens its tooltip`
  ).toHaveCount(1);

  // A message's toolbar shares the style: a hovering pointer leaves no surface on a touch screen.
  const message = page.locator('[data-message-id]').filter({ hasText: REPLIES[1] }).last();
  const text = message.getByText(REPLIES[1], { exact: true });
  const spot = await center(text);
  await page.touchscreen.tap(spot.x, spot.y);
  const reply = message.getByRole('button', { name: 'Reply', exact: true });
  await expect(reply).toBeVisible();
  const replyAt = await center(reply);
  await page.mouse.move(replyAt.x, replyAt.y);
  await page.waitForTimeout(300);
  // Chromium's touch emulation puts :hover back at the last tap when Reply's tooltip (hidden on a
  // phone) comes into the page; the pointer moves once more to be over Reply again.
  await page.mouse.move(replyAt.x + 1, replyAt.y);
  await page.waitForTimeout(100);
  const toolbar = await look(reply);
  console.log(`${engine} toolbar: ${JSON.stringify(toolbar)}`);
  expect(toolbar.hover, `${engine}: the pointer is over Reply`).toBe(true);
  expect
    .soft(toolbar.alpha, `${engine}: Reply shows no hover surface on a phone`)
    .toBeLessThan(0.01);
};

const checkDesktop = async (page: Page, world: World, engine: string) => {
  const banner = await openThread(page, world);
  const options = banner.getByRole('button', { name: 'Thread options', exact: true });
  const at = await center(options);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(300);
  const hovered = await look(options);
  expect(hovered.alpha, `${engine}: a mouse over Thread options shows a surface`).toBeGreaterThan(
    0.01
  );
  await shot(page, banner, `banner-hover-${engine}-desktop`);
  await expect(
    shownTooltips(page).filter({ hasText: 'Thread options' }),
    `${engine}: a mouse over Thread options opens its tooltip`
  ).toHaveCount(1);

  const message = page.locator('[data-message-id]').filter({ hasText: REPLIES[1] }).last();
  const spot = await center(message.getByText(REPLIES[1], { exact: true }));
  await page.mouse.move(spot.x, spot.y);
  const reply = message.getByRole('button', { name: 'Reply', exact: true });
  await expect(reply).toBeVisible();
  const replyAt = await center(reply);
  await page.mouse.move(replyAt.x, replyAt.y);
  await page.waitForTimeout(300);
  expect(
    (await look(reply)).alpha,
    `${engine}: a mouse over Reply shows a surface`
  ).toBeGreaterThan(0.01);
};

/**
 * A page in a new context. Chromium on macOS now and then starts a touch context without its touch
 * emulation (no touch points, a pointer that hovers); such a context is replaced, twice at most.
 */
const newPage = async (browser: Browser, options: BrowserContextOptions) => {
  const attempts = options.hasTouch ? 3 : 1;
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext(options);
    // eslint-disable-next-line no-await-in-loop
    const page = await context.newPage();
    // eslint-disable-next-line no-await-in-loop
    if (await page.evaluate(() => matchMedia('(hover: none)').matches)) return { context, page };
    console.log(`context ${attempt} started without touch emulation; replacing it`);
    // eslint-disable-next-line no-await-in-loop
    await context.close();
  }
  const context = await browser.newContext(options);
  return { context, page: await context.newPage() };
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  const signIn = async (options: BrowserContextOptions) => {
    const { context, page } = await newPage(browser, { ...options, baseURL });
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    return { context, page };
  };
  const phone = await signIn(PHONE);
  try {
    await checkPhone(phone.page, world, engine);
  } finally {
    await phone.context.close();
  }
  const desktop = await signIn(DESKTOP);
  try {
    await checkDesktop(desktop.page, world, engine);
  } finally {
    await desktop.context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a tap leaves no hover surface on the thread banner (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('a tap leaves no hover surface on the thread banner (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
