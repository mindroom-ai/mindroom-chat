import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { expectRoomCompact } from '../helpers/roomViewSwitch';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Compact cards sorted by last reply, newest first, have their live end at the top: a card that
// arrives while the room is open (a new thread, or an agent's answer in the main timeline) shows
// first, and a thread that gets a reply moves up there. That holds while the reader's pointer
// rests on the list too, where the order of the cards already shown is held (THR-04): a new card
// still joins at the top. Scrolled down the list, the card under the pointer stays where it is.
// A room with 26 threads between a person and an agent, among 25 rooms, with classic scrollbars,
// on a desktop (1280 by 800) and a phone (390 by 844, touch), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set COMPACT_LIVE_SHOTS=<dir>
// to save each step.
const PASSWORD = 'compact-live-cards-top-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.COMPACT_LIVE_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const ROOM_NAME = 'Support queue';
const THREAD_COUNT = 26;
const TOPICS = [
  'The export to CSV drops the last column when a cell holds a comma',
  'Password reset emails arrive twice for accounts with two addresses',
  'The calendar sync skips events that start before midnight in UTC',
  'Dark theme: the chart legend is unreadable on the billing page',
  'Login loop on the mobile app after the token refresh fails',
];
const OTHER_ROOMS = [
  'Design reviews',
  'Infrastructure',
  'Customer feedback',
  'Hiring',
  'Weekly sync',
  'Docs and guides',
  'Billing questions',
  'Mobile app',
  'Security reviews',
  'Data pipeline',
  'Marketing site',
  'Support escalations',
  'Partner integrations',
  'Office logistics',
  'Research notes',
  'Accessibility',
  'Performance budget',
  'Localization',
  'Incident reviews',
  'Onboarding',
  'Roadmap',
  'Quality assurance',
  'Analytics',
  'Random',
];

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `clct_${name}_${RUN}`;
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

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

type Seeded = {
  reader: MatrixSession & { username: string };
  agent: MatrixSession;
  roomId: string;
  rootIds: string[];
};

/** The reader's 25 rooms; the main one holds 26 threads, oldest first, each answered. */
const seed = async (label: string): Promise<Seeded> => {
  const reader = await registerAndLogin(`reader_${label}`);
  const agent = await registerAgentAccount(HOMESERVER, `helper_${label}`);
  await Promise.all(
    OTHER_ROOMS.map((name) => createRoom(HOMESERVER, reader.accessToken, { name }))
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootIds: string[] = [];
  for (let index = 0; index < THREAD_COUNT; index += 1) {
    const topic = TOPICS[index % TOPICS.length] ?? '';
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Ticket ${500 + index}: ${topic}. Can someone take a look today?`,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Looking into ticket ${500 + index} now. I can reproduce it and will post the cause.`,
      'm.relates_to': threadRelation(rootId),
    });
    rootIds.push(rootId);
  }
  return { reader, agent, roomId, rootIds };
};

const CARDS = '[data-compact-room-view] [data-thread-root-id]';
const cardOf = (page: Page, rootId: string) =>
  page.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`);

/** The root IDs of the cards, top to bottom. */
const cardOrder = (page: Page) =>
  page
    .locator(CARDS)
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-thread-root-id') ?? ''));

const topOf = (card: Locator) => card.evaluate((element) => element.getBoundingClientRect().top);

const scrollList = (page: Page, top: number) =>
  page.evaluate((scrollTop) => {
    const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
    if (view) view.scrollTop = scrollTop;
  }, top);

const listScrollTop = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>('[data-compact-room-view]')?.scrollTop);

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The agent answers in the main timeline: a new card. */
const agentPosts = (seeded: Seeded, body: string) =>
  sendRoomMessage(HOMESERVER, seeded.agent.accessToken, seeded.roomId, {
    msgtype: 'm.text',
    body,
  });

const expectFirst = async (page: Page, rootId: string, body: string, where: string) => {
  await expect(cardOf(page, rootId)).toContainText(body.slice(0, 40), { timeout: 30_000 });
  await expect
    .poll(async () => (await cardOrder(page)).indexOf(rootId), {
      message: `the new card's place ${where}`,
      timeout: 10_000,
    })
    .toBe(0);
};

const checkLiveEnd = async (page: Page, seeded: Seeded, label: string, phone: boolean) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.reader.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
  // A room with an agent opens in Compact, sorted by last reply, newest first.
  await expectRoomCompact(page, true, 60_000);
  await expect(page.locator(CARDS)).toHaveCount(THREAD_COUNT, { timeout: 60_000 });
  expect((await cardOrder(page))[0], `${label}: the newest thread leads`).toBe(
    seeded.rootIds[THREAD_COUNT - 1]
  );
  // The pointer away from the list.
  if (!phone) await page.mouse.move(5, 795);

  // 1. Nothing held: the agent's answer in the main timeline shows first.
  const firstBody = `Update for ${label}: the deploy of build 1302 finished, and the dashboards look normal.`;
  const first = await agentPosts(seeded, firstBody);
  await expectFirst(page, first, firstBody, `with nothing held (${label})`);
  await shot(page, `${label}-1-idle`);

  // 2. A reply in the oldest thread moves its card up to the top.
  const oldest = seeded.rootIds[0] ?? '';
  const replyBody = `Found it: ticket 500 comes from the quoting of commas in the exporter.`;
  await sendRoomMessage(HOMESERVER, seeded.agent.accessToken, seeded.roomId, {
    msgtype: 'm.text',
    body: replyBody,
    'm.relates_to': threadRelation(oldest),
  });
  await expectFirst(page, oldest, replyBody, `after a reply (${label})`);

  if (phone) {
    // 3. A phone reader who scrolled down the list and back up to its top.
    await scrollList(page, 900);
    await page.waitForTimeout(300);
    await scrollList(page, 0);
    const phoneBody = `Heads up for ${label}: the status page shows a partial outage of the search API.`;
    const phoneCard = await agentPosts(seeded, phoneBody);
    await expectFirst(page, phoneCard, phoneBody, `after scrolling back up (${label})`);
    await shot(page, `${label}-3-scrolled-back`);
    return;
  }

  // 3. The pointer rests on the second card at the top of the list, so the order is held: a new
  // card still joins at the top, the live end.
  const order = await cardOrder(page);
  const rested = cardOf(page, order[1] ?? '');
  const box = (await rested.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-order-held]')).toHaveCount(1);
  const heldBody = `Update for ${label}: the nightly backup finished in 14 minutes, all volumes verified.`;
  const held = await agentPosts(seeded, heldBody);
  await expectFirst(page, held, heldBody, `under a resting pointer at the top (${label})`);
  await shot(page, `${label}-3-held-top`);

  // 4. Scrolled down the list, the pointer on a card: the new card joins at the top and the card
  // under the pointer stays where it is.
  await page.mouse.move(5, 795);
  await scrollList(page, 700);
  await page.waitForTimeout(300);
  const midOrder = await cardOrder(page);
  const middle = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
    const rect = view?.getBoundingClientRect();
    if (!rect) return undefined;
    const hit = document
      .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      ?.closest('[data-thread-root-id]');
    return hit?.getAttribute('data-thread-root-id') ?? undefined;
  });
  expect(middle, `${label}: a card in the middle of the list`).toBeTruthy();
  expect(midOrder.indexOf(middle!)).toBeGreaterThan(3);
  const midCard = cardOf(page, middle!);
  const midBox = (await midCard.boundingBox())!;
  const pointer = { x: midBox.x + midBox.width / 2, y: midBox.y + midBox.height / 2 };
  await page.mouse.move(pointer.x, pointer.y);
  await expect(page.locator('[data-order-held]')).toHaveCount(1);
  const before = await topOf(midCard);
  const scrolledBefore = await listScrollTop(page);
  const scrolledBody = `Update for ${label}: the certificate for the staging host renews tomorrow at noon.`;
  const scrolled = await agentPosts(seeded, scrolledBody);
  await expectFirst(page, scrolled, scrolledBody, `scrolled down, under the pointer (${label})`);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );
  const moved = (await topOf(midCard)) - before;
  const scrolledAfter = await listScrollTop(page);
  test.info().annotations.push({
    type: 'held card',
    description: `${label}: moved ${moved} px, scrollTop ${scrolledBefore} to ${scrolledAfter}`,
  });
  expect(Math.abs(moved), `${label}: the card under the pointer moved`).toBeLessThan(1);
  await shot(page, `${label}-4-held-scrolled`);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(`${form}`, () => {
    test.use(options);

    test(`new Compact cards join at the top of a newest-first list (Chromium, ${form})`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const seeded = await seed(`c${form[0]}`);
      await checkLiveEnd(page, seeded, `chromium-${form}`, form === 'phone');
    });

    test(`new Compact cards join at the top of a newest-first list (WebKit, ${form})`, async ({
      baseURL,
    }) => {
      test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(300_000);
      const seeded = await seed(`w${form[0]}`);
      // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
      const browser = await launchWebKit();
      try {
        const context = await browser.newContext({ ...options, baseURL });
        const page = await context.newPage();
        await checkLiveEnd(page, seeded, `webkit-${form}`, form === 'phone');
      } finally {
        await browser.close();
      }
    });
  });
}
