import { expect, test, type Browser, type Locator } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Typing in the banner's title field leaves the thread's messages where they are. The field sits
// in the sticky banner, which the scroller's top padding covers, and the browser revealed the caret
// past that padding after each keystroke: the messages under the banner moved up a step per
// character. Checked at the bottom of a long thread on a desktop, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const PASSWORD = 'thread-banner-title-typing-password';
const RUN = Date.now().toString(36);
const ROOT = 'Plan the example launch checklist';
const TYPED = ' for Friday';

test.describe.configure({ timeout: 180_000 });

const seed = async (key: string) => {
  const reader = await registerDisposableUser(`btt_${key}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, { name: 'Example planning' });
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: ROOT,
  });
  for (let index = 1; index <= 24; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Example step ${index}: check the item and note who owns it.\nA second line keeps the thread long.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  return { reader, roomId, rootId };
};

type Timeline = { top: number; height: number; below: number; padding: number };

/**
 * The thread's timeline, the banner's nearest scrolling ancestor: its offset, its content's
 * height, the rest below and its computed top scroll padding.
 */
const timeline = (banner: Locator): Promise<Timeline> =>
  banner.evaluate((element) => {
    let node = element.parentElement;
    while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
      node = node.parentElement;
    }
    if (!node) throw new Error('no scrolling ancestor');
    return {
      top: node.scrollTop,
      height: node.scrollHeight,
      below: node.scrollHeight - node.scrollTop - node.clientHeight,
      padding: Number.parseFloat(getComputedStyle(node).scrollPaddingTop),
    };
  });
const timelineScrollTop = async (banner: Locator): Promise<number> => (await timeline(banner)).top;

const check = async (browser: Browser, engine: string, baseURL?: string) => {
  const world = await seed(engine.slice(0, 1));
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, baseURL });
  await context.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.reader.username,
    password: PASSWORD,
  });
  await page.goto(
    `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`
  );
  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Example step 24:', { exact: false })).toBeInViewport({
    timeout: 30_000,
  });
  // Settled at the bottom, with history above to scroll back to.
  await expect
    .poll(async () => (await timeline(banner)).below, { timeout: 15_000 })
    .toBeLessThan(2);
  await expect.poll(() => timelineScrollTop(banner)).toBeGreaterThan(200);
  // Still for half a second: three samples 250 ms apart with the same offset and height.
  const stillFor500Ms = async () => {
    const samples: Timeline[] = [];
    for (let index = 0; index < 3; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 250));
      // eslint-disable-next-line no-await-in-loop
      samples.push(await timeline(banner));
    }
    return samples.every(
      ({ top, height }) => top === samples[0]?.top && height === samples[0]?.height
    );
  };
  await expect.poll(stillFor500Ms, { timeout: 20_000 }).toBe(true);
  const { top: start, padding } = await timeline(banner);

  await banner.locator('[data-thread-context-root-title]').dblclick();
  const field = banner.getByRole('textbox', { name: 'Summary', exact: true });
  await expect(field).toBeFocused();
  // While the field has the focus, the scroll padding leaves the banner out.
  expect((await timeline(banner)).padding).toBeLessThan(padding);
  await page.keyboard.press('End');
  const offsets: number[] = [];
  for (const character of TYPED) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.type(character, { delay: 40 });
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    // eslint-disable-next-line no-await-in-loop
    offsets.push(Math.round(start - (await timelineScrollTop(banner))));
  }
  await expect(field).toHaveValue(`${ROOT}${TYPED}`);
  expect(
    offsets.map((offset) => Math.abs(offset) <= 1),
    `px the timeline scrolled up after each typed character: ${offsets.join(', ')}`
  ).toEqual(offsets.map(() => true));
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect.poll(async () => (await timeline(banner)).padding).toBe(padding);
  await context.close();
};

test('typing in the banner title field keeps the thread in place, Chromium', async ({
  browser,
  baseURL,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  await check(browser, 'chromium', baseURL);
});

test('typing in the banner title field keeps the thread in place, WebKit', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  const browser = await launchWebKit();
  try {
    await check(browser, 'webkit', baseURL);
  } finally {
    await browser.close();
  }
});
