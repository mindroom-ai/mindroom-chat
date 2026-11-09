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
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// On a phone (390 by 844, touch) the small controls get a hit area a finger can find: 44 px tall,
// and 44 px wide where the next control is far enough, else up to the middle of the gap, so two
// controls never share a point. Measured with elementFromPoint, which hit-tests like a tap: the
// room header buttons, the composer buttons, the thread banner buttons and "[+all]". Their look
// does not change. A tapped glass button (the composer's More actions) also keeps no hover tint or
// hover scale afterwards, while a desktop mouse still gets both (on Formatting). Checked in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
// Set TOUCH_TARGET_SHOTS=<directory> to save the controls, and a mock of the composer and banner
// with 44 px between button centres (the visible change a full 44 px width would need).
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'touch-targets-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.TOUCH_TARGET_SHOTS;
const TARGET = 44;

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
// A phone composer keeps voice and Send; Attach, Formatting and Emoji are in More actions' menu.
const COMPOSER = ['More actions', 'Record voice message', 'Send message'];
// A phone's room header keeps Back, the name and More Options; the rest is in the room menu.
const HEADER = ['Back', 'More Options'];
const BANNER = ['Thread options', 'Pin thread', 'Resolve'];

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

const openThread = async (page: Page, world: World) => {
  await go(
    page,
    `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`
  );
  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(REPLIES[2], { exact: true })).toBeVisible({ timeout: 60_000 });
  return banner;
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

type Hit = { name: string; at: string; hit: string; inside: boolean };

/**
 * Taps around each control of a row (left to right): the points 1 px inside its hit area must land
 * on it and the points 1 px outside must not. The area is 44 px tall, and 44 px wide unless the
 * row's controls stand closer than that: then it reaches the middle of the gap on both sides.
 */
const measureRow = async (row: Locator[]) => {
  const handles = await Promise.all(row.map((control) => control.elementHandle()));
  const page = row[0]?.page();
  if (!page) throw new Error('empty row');
  return page.evaluate(
    ({ elements, size }) => {
      const named = (element: Element | null) => {
        const owner = element?.closest('button');
        if (owner) return owner.getAttribute('aria-label') ?? owner.textContent?.trim() ?? '';
        const attributes = element
          ? [...element.attributes].map((attribute) => attribute.name)
          : [];
        return `not a button: ${element?.tagName ?? 'nothing'} ${attributes.join(' ')}`;
      };
      const rects = elements.map((element) => element!.getBoundingClientRect());
      const centres = rects.map((rect) => rect.left + rect.width / 2);
      const pitch = Math.min(
        size,
        ...centres.slice(1).map((centre, index) => centre - centres[index]!)
      );
      const hits: { name: string; at: string; hit: string; inside: boolean }[] = [];
      rects.forEach((rect, index) => {
        const name = named(elements[index] ?? null);
        const cx = centres[index]!;
        const cy = rect.top + rect.height / 2;
        const halfHeight = Math.max(size, rect.height) / 2;
        // A control wider than the pitch keeps its own width. Its hit area below and above it is
        // laid out from its padding box, so the inner probes stay inside its border.
        const halfWidth = {
          inner: Math.max(pitch, elements[index]!.clientWidth) / 2,
          outer: Math.max(pitch, rect.width) / 2,
        };
        const probe = (at: string, dx: number, dy: number, inside: boolean) =>
          hits.push({ name, at, inside, hit: named(document.elementFromPoint(cx + dx, cy + dy)) });
        // Hit testing rounds the point to whole pixels, so the probes stay 1 px from each edge.
        for (const inside of [true, false]) {
          const where = inside ? 'in' : 'out';
          const y = halfHeight + (inside ? -1 : 1);
          const x = inside ? halfWidth.inner - 1 : halfWidth.outer + 1;
          probe(`top ${where}`, 0, -y, inside);
          probe(`bottom ${where}`, 0, y, inside);
          probe(`start ${where}`, -x, 0, inside);
          probe(`end ${where}`, x, 0, inside);
          probe(`corner ${where}`, x, y, inside);
        }
      });
      return { hits, widths: rects.map((rect) => rect.width), pitch };
    },
    { elements: handles, size: TARGET }
  );
};

const expectRow = async (row: Locator[], where: string) => {
  const { hits, widths, pitch } = await measureRow(row);
  console.log(`${where}: widths ${JSON.stringify(widths)}, pitch ${pitch}`);
  const wrong = hits.filter((hit: Hit) => (hit.hit === hit.name) !== hit.inside);
  if (wrong.length) console.log(`${where} wrong: ${JSON.stringify(wrong)}`);
  expect
    .soft(wrong, `${where}: each hit area is 44 px or reaches the gap's middle, no further`)
    .toEqual([]);
};

const button = (scope: Page | Locator, name: string) =>
  scope.getByRole('button', { name, exact: true });

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
  // The expand toggle lies under a row's hover toolbar until the pointer leaves the rows.
  const all = page.getByRole('button', { name: 'Expand all long messages', exact: true });
  await expect(all).toBeVisible();
  await shot(page, page.getByRole('banner'), `header-${engine}-phone`);
  await shot(page, composer[0]!.locator('..').locator('..'), `composer-${engine}-phone`);

  // A tapped More actions button rests like the voice button once its menu is closed again.
  const more = button(page, 'More actions');
  const rest = await surface(button(page, 'Record voice message'));
  for (const expanded of ['true', 'false']) {
    // eslint-disable-next-line no-await-in-loop
    const at = await more.boundingBox();
    if (!at) throw new Error('no More actions button');
    // eslint-disable-next-line no-await-in-loop
    await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
    // eslint-disable-next-line no-await-in-loop
    await expect(more).toHaveAttribute('aria-expanded', expanded);
  }
  await page.waitForTimeout(400);
  const tapped = await surface(more);
  console.log(
    `${engine} More actions after two taps: ${JSON.stringify(tapped)}, voice ${JSON.stringify(
      rest
    )}`
  );
  await shot(page, more, `more-actions-after-taps-${engine}-phone`);
  expect
    .soft(tapped.fill, `${engine}: More actions keeps no hover tint after a tap`)
    .toBe(rest.fill);
  expect
    .soft(tapped.scale, `${engine}: More actions keeps no hover scale after a tap`)
    .toBe(rest.scale);

  await expectRow(
    HEADER.map((name) => button(page.getByRole('banner'), name)),
    `${engine} room header`
  );
  await expectRow(composer.slice(0, 2), `${engine} composer start`);
  await expectRow(composer.slice(2), `${engine} composer end`);
  await expectRow([all], `${engine} [+all] in the room`);

  const banner = await openThread(page, world);
  await shot(page, banner, `banner-${engine}-phone`);
  await expectRow(
    BANNER.map((name) => button(banner, name)),
    `${engine} thread banner`
  );
  // A thread has no [+all] line.
  await expect(all).toHaveCount(0);

  if (SHOTS) {
    // What a full 44 px width would look like: 12 px between the buttons instead of 4.
    await page.addStyleTag({
      content:
        '[data-thread-context-banner] button + button, [aria-label="Record voice message"] { margin-inline-start: 8px !important; }',
    });
    await shot(page, banner, `mock-44-pitch-banner-${engine}-phone`);
    await shot(
      page,
      composer[0]!.locator('..').locator('..'),
      `mock-44-pitch-composer-${engine}-phone`
    );
  }
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
  // A mouse gets no larger hit area: just above the button is not the button.
  const above = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
    { x: at.x + at.width / 2, y: at.y - 2 }
  );
  expect(above, `${engine}: 2 px above Formatting is not Formatting on a desktop`).not.toBe(
    'Formatting'
  );
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
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
