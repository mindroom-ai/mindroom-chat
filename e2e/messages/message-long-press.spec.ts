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

// On a phone (390 by 844, touch) a finger resting about half a second on a message opens the
// message's menu where it rests, as a right click does with a mouse: iOS Safari fires no
// contextmenu for a long press. A short tap, a finger that drifts more than 10 px, and a scroll
// during the press open nothing, and once the menu is open the lift does not click. Playwright has
// no long press, so the spec sends the touch events itself, as real TouchEvents where the engine
// can build them. Checked in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit.
// Set LONG_PRESS_SHOTS=<directory> to save the open menu.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'message-long-press-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.LONG_PRESS_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const TOPICS = [
  'The load test passed at 2,100 requests per second, well above the target we set last week.',
  'Security review signs off on Thursday once the token rotation lands in staging.',
  'The API page needs one more pass before the docs ship; two examples still use the old field.',
  'Design wants the empty state to show the keyboard shortcut instead of the long explanation.',
  'Support asked whether the export keeps attachments; it does, as links that expire in a week.',
];
const LAST = 'Final check: the release notes mention the new search filters and the faster sync.';

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
  const username = `mlp_${name}_${RUN}`;
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

/** 25 other rooms, and one room with 30 messages, enough to scroll. */
const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, { name: 'Launch planning' });
  for (let index = 0; index < 29; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `${index + 1}. ${TOPICS[index % TOPICS.length]}`,
    });
  }
  await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, { msgtype: 'm.text', body: LAST });
  return { reader, roomId };
};

type World = Awaited<ReturnType<typeof seed>>;

type Step =
  | { type: 'start' | 'end'; dx?: number; dy?: number }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait'; ms: number }
  | { type: 'scroll'; by: number };

/**
 * One finger on the middle of `target`, driven through `steps`. Answers whether the lift's
 * default was prevented and how the events were built.
 */
const touch = async (target: Locator, steps: Step[]) => {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to touch');
  return target.evaluate(
    async (element, { x, y, plan }) => {
      let real = true;
      const fire = (type: string, dx: number, dy: number, lifted: boolean) => {
        const point = { clientX: x + dx, clientY: y + dy };
        let event: Event;
        try {
          const finger = new Touch({
            identifier: 1,
            target: element,
            ...point,
            pageX: point.clientX + window.scrollX,
            pageY: point.clientY + window.scrollY,
            screenX: point.clientX,
            screenY: point.clientY,
          });
          event = new TouchEvent(type, {
            touches: lifted ? [] : [finger],
            targetTouches: lifted ? [] : [finger],
            changedTouches: [finger],
            bubbles: true,
            cancelable: true,
            composed: true,
          });
        } catch {
          // An engine that cannot build a Touch gets an event that carries the same fields.
          real = false;
          event = new Event(type, { bubbles: true, cancelable: true, composed: true });
          const list = lifted ? [] : [{ identifier: 1, target: element, ...point }];
          Object.defineProperties(event, {
            touches: { value: list },
            targetTouches: { value: list },
            changedTouches: { value: [{ identifier: 1, target: element, ...point }] },
          });
        }
        return element.dispatchEvent(event);
      };
      let liftAllowed = true;
      let at = { dx: 0, dy: 0 };
      for (const step of plan) {
        if (step.type === 'wait') {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => {
            setTimeout(resolve, step.ms);
          });
        } else if (step.type === 'scroll') {
          let scroller: Element | null = element;
          while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
            scroller = scroller.parentElement;
          }
          scroller?.scrollBy(0, step.by);
        } else if (step.type === 'move') {
          at = { dx: step.dx, dy: step.dy };
          fire('touchmove', at.dx, at.dy, false);
        } else if (step.type === 'start') {
          fire('touchstart', 0, 0, false);
        } else {
          liftAllowed = fire('touchend', at.dx, at.dy, true);
        }
      }
      return { liftAllowed, real };
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2, plan: steps }
  );
};

const message = (page: Page, body: string) =>
  page.locator('[data-message-id]').filter({ hasText: body }).last();

/**
 * The message's menu: its toolbar shows More Options pressed, and the menu lists its entries as
 * text (the toolbar's own Reply in Thread is an icon).
 */
const menuOf = (page: Page, row: Locator) => ({
  more: row.getByRole('button', { name: 'More Options', exact: true }),
  entry: page
    .getByRole('button', { name: 'Reply in Thread', exact: true })
    .filter({ hasText: 'Reply in Thread' }),
});

const expectNoMenu = async (page: Page, row: Locator, where: string) => {
  await page.waitForTimeout(300);
  await expect(menuOf(page, row).entry, `${where}: no menu`).toHaveCount(0);
  await expect(page.locator('[aria-label="More Options"][aria-pressed="true"]')).toHaveCount(0);
};

const checkPhone = async (page: Page, world: World, engine: string) => {
  await expect
    .poll(() => page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), {
      message: `${engine}: the phone reports a finger`,
    })
    .toBe(true);
  await page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}`);
  const row = message(page, LAST);
  await expect(row).toBeVisible({ timeout: 60_000 });
  const text = row.getByText(LAST, { exact: true });

  // A short tap opens no menu, and its lift may click.
  const tap = await touch(text, [{ type: 'start' }, { type: 'wait', ms: 120 }, { type: 'end' }]);
  console.log(`${engine} tap: ${JSON.stringify(tap)}`);
  expect(tap.liftAllowed, `${engine}: a tap's lift may click`).toBe(true);
  await expectNoMenu(page, row, `${engine} after a tap`);

  // A finger that drifts 15 px is dragging, not pressing.
  await touch(text, [
    { type: 'start' },
    { type: 'wait', ms: 150 },
    { type: 'move', dx: 0, dy: 15 },
    { type: 'wait', ms: 600 },
    { type: 'end' },
  ]);
  await expectNoMenu(page, row, `${engine} after a drift`);

  // A scroll during the press, without the finger reporting a move, cancels it too.
  await touch(text, [
    { type: 'start' },
    { type: 'wait', ms: 150 },
    { type: 'scroll', by: -40 },
    { type: 'wait', ms: 600 },
    { type: 'end' },
    { type: 'scroll', by: 40 },
  ]);
  await expectNoMenu(page, row, `${engine} after a scroll`);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(row).toBeVisible();

  // A long press opens the menu where the finger rests; small jitter is allowed.
  const box = await text.boundingBox();
  const press = await touch(text, [
    { type: 'start' },
    { type: 'wait', ms: 200 },
    { type: 'move', dx: 3, dy: -2 },
    { type: 'wait', ms: 450 },
    { type: 'end' },
  ]);
  console.log(`${engine} long press: ${JSON.stringify(press)}`);
  const { more, entry } = menuOf(page, row);
  await expect(entry, `${engine}: a long press opens the message menu`).toBeVisible();
  await expect(more).toHaveAttribute('aria-pressed', 'true');
  expect(press.liftAllowed, `${engine}: the lift after the menu opens does not click`).toBe(false);
  // The menu opens at the finger, as a right click opens it at the pointer: a corner of it touches
  // the finger's point, give or take the pop-out's offset and the menu's padding.
  const menu = await entry.evaluate((element) => {
    let box: Element = element;
    while (box.parentElement && box.getBoundingClientRect().height < 5 * element.clientHeight) {
      box = box.parentElement;
    }
    const { left, right, top, bottom } = box.getBoundingClientRect();
    return { left, right, top, bottom };
  });
  if (!box) throw new Error('no message text');
  const finger = { x: box.x + box.width / 2 + 3, y: box.y + box.height / 2 - 2 };
  console.log(`${engine} menu ${JSON.stringify(menu)} finger ${JSON.stringify(finger)}`);
  const near = (value: number, ...edges: number[]) =>
    Math.min(...edges.map((edge) => Math.abs(edge - value)));
  expect(
    near(finger.x, menu.left, menu.right),
    `${engine}: the menu meets the finger`
  ).toBeLessThan(16);
  expect(
    near(finger.y, menu.top, menu.bottom),
    `${engine}: the menu meets the finger`
  ).toBeLessThan(16);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `long-press-menu-${engine}-phone.png`) });
  }
  // The menu stays open after the lift.
  await page.waitForTimeout(300);
  await expect(entry).toBeVisible();
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
  const { context, page } = await newPage(browser, { ...PHONE, baseURL });
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await checkPhone(page, world, engine);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a long press opens the message menu on a phone (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('a long press opens the message menu on a phone (WebKit)', async ({ baseURL }) => {
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
