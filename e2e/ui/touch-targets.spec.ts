import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  webkit,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, sendRoomMessage, type MatrixSession } from '../helpers/matrix';

// On a phone (390 by 844, touch) a tapped glass button (the composer's Formatting) keeps no hover
// tint or hover scale afterwards, while a desktop mouse still gets both. Checked in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
// Set TOUCH_TARGET_SHOTS=<directory> to save the controls.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'touch-targets-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.TOUCH_TARGET_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const ROOT = 'Which checks still block the launch on Thursday?';
const REPLIES = [
  'The load test passed at 2,100 requests per second, well above the target we set last week.',
  'Security review signs off on Thursday once the token rotation lands.',
  'The API page needs one more pass before the docs ship; two examples still use the old field.',
] as const;
const COMPOSER = ['Attach files', 'Record voice message', 'Formatting', 'Emoji', 'Send message'];

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `ttg_${name}_${RUN}`;
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

/** 25 other rooms, and one room with a thread of a few replies. */
const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, { name: 'Launch planning' });
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: ROOT,
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

const go = async (page: Page, route: string) => {
  await page.evaluate((to) => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
};

const openRoom = async (page: Page, world: World) => {
  await go(page, `/home/${encodeURIComponent(world.roomId)}`);
  await expect(page.getByText(ROOT, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
};

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

const button = (scope: Page, name: string) => scope.getByRole('button', { name, exact: true });

/** A button's fill and scale, as computed now. */
const surface = (target: Locator) =>
  target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fill: style.backgroundColor,
      scale: style.scale,
      hover: element.matches(':hover'),
      pressed: element.getAttribute('aria-pressed'),
    };
  });

const checkPhone = async (page: Page, world: World, engine: string) => {
  await expect
    .poll(() => page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), {
      message: `${engine}: the phone reports a finger`,
    })
    .toBe(true);
  await openRoom(page, world);
  const composer = COMPOSER.map((name) => button(page, name));
  await shot(page, page.getByRole('banner'), `header-${engine}-phone`);
  await shot(page, composer[0]!.locator('..').locator('..'), `composer-${engine}-phone`);

  // A tapped Formatting button rests like Attach once its toolbar is closed again.
  const formatting = button(page, 'Formatting');
  const attach = button(page, 'Attach files');
  const rest = await surface(attach);
  // The formatting toolbar moves the composer, so each tap finds the button again.
  for (const pressed of ['true', 'false']) {
    // eslint-disable-next-line no-await-in-loop
    const at = await formatting.boundingBox();
    if (!at) throw new Error('no Formatting button');
    // eslint-disable-next-line no-await-in-loop
    await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
    // eslint-disable-next-line no-await-in-loop
    await expect(formatting).toHaveAttribute('aria-pressed', pressed);
  }
  await page.waitForTimeout(400);
  const tapped = await surface(formatting);
  console.log(
    `${engine} Formatting after two taps: ${JSON.stringify(tapped)}, Attach ${JSON.stringify(rest)}`
  );
  await shot(page, formatting, `formatting-after-taps-${engine}-phone`);
  expect.soft(tapped.fill, `${engine}: Formatting keeps no hover tint after a tap`).toBe(rest.fill);
  expect
    .soft(tapped.scale, `${engine}: Formatting keeps no hover scale after a tap`)
    .toBe(rest.scale);
};

const checkDesktop = async (page: Page, world: World, engine: string) => {
  await openRoom(page, world);
  const formatting = button(page, 'Formatting');
  const rest = await surface(button(page, 'Attach files'));
  const at = await formatting.boundingBox();
  if (!at) throw new Error('no Formatting button');
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.waitForTimeout(400);
  const hovered = await surface(formatting);
  console.log(`${engine} desktop hover: ${JSON.stringify(hovered)}`);
  expect(hovered.hover, `${engine}: the mouse is over Formatting`).toBe(true);
  expect(hovered.fill, `${engine}: a mouse over Formatting tints it`).not.toBe(rest.fill);
  expect(hovered.scale, `${engine}: a mouse over Formatting lifts it`).toBe('1.025');
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
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('small controls take a 44 px hit area on a phone (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('small controls take a 44 px hit area on a phone (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
