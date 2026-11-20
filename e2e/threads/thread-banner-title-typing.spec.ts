import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Typing in the banner's title field leaves the thread's messages where they are. The field sits
// in the sticky banner, which the scroller's top padding covers, and the browser revealed the caret
// past that padding after each keystroke: the messages under the banner moved up a step per
// character. While the field has the focus the padding leaves the banner out, and the timeline
// still reads the banner as covering the rows: a reader in the middle of the thread keeps the row
// under the banner while a reply behind the banner grows and a new one arrives. Checked on a
// desktop, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const PASSWORD = 'thread-banner-title-typing-password';
const RUN = Date.now().toString(36);
const ROOT = 'Plan the example launch checklist';
const TYPED = ' for Friday';
const REPLIES = 24;

test.describe.configure({ timeout: 180_000 });

const stepBody = (index: number) =>
  `Example step ${index}: check the item and note who owns it.\nA second line keeps the thread long.`;

/** A room with a thread of 24 replies from a colleague, who can add to it later. */
const seed = async (key: string) => {
  const reader = await registerDisposableUser(`btt_${key}_${RUN}`, PASSWORD);
  const colleague = await registerDisposableUser(`btt_${key}_c_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Example planning',
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: ROOT,
  });
  const inThread = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  const reply = (body: string) =>
    sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': inThread,
    });
  const replyIds: string[] = [];
  for (let index = 1; index <= REPLIES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    replyIds.push(await reply(stepBody(index)));
  }
  const edit = (eventId: string, body: string) =>
    sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body },
      'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
    });
  return { reader, roomId, rootId, replyIds, reply, edit };
};

type Timeline = { top: number; height: number; below: number; padding: number; edge: number };

/**
 * The thread's timeline, the banner's nearest scrolling ancestor: its offset, its content's
 * height, the rest below, its computed top scroll padding and where that padding ends on the page.
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
      edge:
        node.getBoundingClientRect().top +
        Number.parseFloat(getComputedStyle(node).scrollPaddingTop),
    };
  });
const timelineScrollTop = async (banner: Locator): Promise<number> => (await timeline(banner)).top;

/** Waits until the timeline is still for half a second: three samples 250 ms apart agree. */
const settle = async (banner: Locator) => {
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
};

/** The thread's rows: the root and its replies, once all of them are loaded. */
const threadRows = (page: Page, count: number) =>
  expect(page.locator(`[data-thread-count="${count}"]`)).toBeAttached({ timeout: 30_000 });

/** Signs the reader in and opens the seeded thread at its end, all of it loaded and still. */
const openThread = async (browser: Browser, key: string, baseURL?: string) => {
  const world = await seed(key);
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
  await threadRows(page, REPLIES + 1);
  await expect(page.getByText(`Example step ${REPLIES}:`, { exact: false })).toBeInViewport({
    timeout: 30_000,
  });
  // At the bottom, with history above to scroll back to.
  await expect
    .poll(async () => (await timeline(banner)).below, { timeout: 15_000 })
    .toBeLessThan(2);
  await expect.poll(() => timelineScrollTop(banner)).toBeGreaterThan(200);
  await settle(banner);
  const field = banner.getByRole('textbox', { name: 'Summary', exact: true });
  const editTitle = async () => {
    await banner.locator('[data-thread-context-root-title]').dblclick();
    await expect(field).toBeFocused();
  };
  return { world, context, page, banner, field, editTitle };
};

const checkTyping = async (browser: Browser, engine: string, baseURL?: string) => {
  const { context, page, banner, field, editTitle } = await openThread(
    browser,
    engine.slice(0, 1),
    baseURL
  );
  const { top: start, padding } = await timeline(banner);
  await editTitle();
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

const checkAnchoring = async (browser: Browser, engine: string, baseURL?: string) => {
  const { world, context, page, banner, field, editTitle } = await openThread(
    browser,
    `${engine.slice(0, 1)}a`,
    baseURL
  );
  // Step 6 at the top of the reader's view, where the scroll padding ends below the banner, well
  // away from the end, which a reader there would follow; step 5 above it, under the banner.
  const behind = page.locator(`[data-message-id="${world.replyIds[4]}"]`).first();
  const reading = page.locator(`[data-message-id="${world.replyIds[5]}"]`).first();
  const top = (row: Locator) => row.evaluate((element) => element.getBoundingClientRect().top);
  // Rows measured after the jump can still move it, so it is repeated until it holds.
  await expect
    .poll(
      async () => {
        await reading.evaluate((element) => element.scrollIntoView({ block: 'start' }));
        await settle(banner);
        const { edge } = await timeline(banner);
        return (await top(reading)) >= edge - 1 && (await top(behind)) < edge;
      },
      { message: 'step 6 starts at the top of the view, step 5 above it', timeout: 60_000 }
    )
    .toBe(true);
  const before = await top(reading);
  expect((await timeline(banner)).below, 'the end is out of view').toBeGreaterThan(200);

  await editTitle();
  expect(Math.abs((await top(reading)) - before), 'opening the field').toBeLessThanOrEqual(1);
  // The reply behind the banner grows by four lines, and a new reply arrives at the end.
  await world.edit(
    world.replyIds[4]!,
    `${stepBody(5)}\nIt grew a third line.\nAnd a fourth.\nAnd a fifth.\nAnd a sixth.`
  );
  await world.reply(stepBody(REPLIES + 1));
  await expect(behind).toContainText('And a sixth.', { timeout: 30_000 });
  await threadRows(page, REPLIES + 2);
  await settle(banner);
  await expect(field).toBeFocused();
  expect(
    Math.abs((await top(reading)) - before),
    'step 6 holds while the thread changes during the edit'
  ).toBeLessThanOrEqual(2);

  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await settle(banner);
  expect(
    Math.abs((await top(reading)) - before),
    'step 6 holds once the field closes'
  ).toBeLessThanOrEqual(2);
  await context.close();
};

for (const [name, check] of [
  ['typing in the banner title field keeps the thread in place', checkTyping],
  ['a mid-thread reader keeps their row while the title field is open', checkAnchoring],
] as const) {
  test(`${name}, Chromium`, async ({ browser, baseURL }) => {
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    await check(browser, 'chromium', baseURL);
  });

  test(`${name}, WebKit`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    const browser = await launchWebKit();
    try {
      await check(browser, 'webkit', baseURL);
    } finally {
      await browser.close();
    }
  });
}
