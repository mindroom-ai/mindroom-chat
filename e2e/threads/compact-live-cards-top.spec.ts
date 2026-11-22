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
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
  createDefaultThreadFilterState,
  seedRoomOverviewState,
  sendStateEvent,
} from '../helpers/matrix';
import { expectRoomCompact } from '../helpers/roomViewSwitch';
import { launchWebKit, onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';
import { withMovingMouseOverCard } from '../helpers/threadOverview';

// Compact cards sorted by last reply, newest first, have their live end at the top: a card that
// arrives while the room is open (a new thread, or an agent's answer in the main timeline) shows
// first, and a thread that gets a reply moves up there. That holds while the reader aims the
// pointer too, when the order of the cards already shown is held (THR-04): a new card
// still joins at the top. Scrolled down the list, the card under the pointer stays where it is.
// A room with 26 threads between a person and an agent, among 25 rooms, with classic scrollbars,
// on a desktop (1280 by 800) and a phone (390 by 844, touch), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set COMPACT_LIVE_SHOTS=<dir>
// to save each step.
const PASSWORD = 'compact-live-cards-top-password';
const RUN = Date.now().toString(36);
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
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

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
  const reader = await registerDisposableUser(`clct_reader_${label}_${RUN}`, PASSWORD);
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

const HOLD_FRAMES = 24;

/** Start before the sync arrives, then sample through the same number of frames after it. */
const expectHeldArrival = async (
  view: Locator,
  id: string,
  count: number,
  point: { x: number; y: number },
  label: string,
  arrive: () => string | Promise<string>
) => {
  const watch = await view.evaluateHandle(
    (scroller, { id, count, point, frames }) => {
      const selector = `[data-thread-root-id="${CSS.escape(id)}"]:not([inert] *)`;
      const top = () => scroller.querySelector(selector)?.getBoundingClientRect().top;
      const before = top();
      if (before === undefined) throw new Error('Held card is not mounted before the arrival');
      const scrollBefore = scroller.scrollTop;
      const sample = async () => {
        let maxDisplacement = 0;
        let missingFrames = 0;
        let missedPointerFrames = 0;
        let afterArrival = 0;
        while (afterArrival < frames) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const now = top();
          if (now === undefined) missingFrames += 1;
          else maxDisplacement = Math.max(maxDisplacement, Math.abs(now - before));
          const hit = document.elementFromPoint(point.x, point.y)?.closest(selector);
          if (!hit) missedPointerFrames += 1;
          if (scroller.getAttribute('data-compact-card-count') === String(count)) {
            afterArrival += 1;
          }
        }
        return {
          maxDisplacement,
          missingFrames,
          missedPointerFrames,
          scrollBefore,
          scrollAfter: scroller.scrollTop,
        };
      };
      return { result: sample() };
    },
    { id, count, point, frames: HOLD_FRAMES }
  );
  try {
    const arrival = await arrive();
    // The new card can be outside the mounted window.
    await expect(view).toHaveAttribute('data-compact-card-count', String(count));
    const result = await watch.evaluate(({ result }) => result);
    test.info().annotations.push({ type: 'held card', description: JSON.stringify(result) });
    expect(result.scrollBefore).toBeGreaterThan(0);
    expect(result.missingFrames, `${label}: held card unmounted`).toBe(0);
    expect(result.maxDisplacement, `${label}: the card under the pointer moved`).toBeLessThan(1);
    expect(result.missedPointerFrames, `${label}: pointer left the held card`).toBe(0);
    return arrival;
  } finally {
    await watch.dispose();
  }
};

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

const findMiddleCard = async (view: Locator, label: string): Promise<string> => {
  let middle: string | undefined;
  await expect
    .poll(
      async () => {
        middle = await view.evaluate((scroller) => {
          const { x, y, width, height } = scroller.getBoundingClientRect();
          return (
            [0, 16, -16]
              .map((offset) =>
                document
                  .elementFromPoint(x + width / 2, y + height / 2 + offset)
                  ?.closest('[data-thread-root-id]')
                  ?.getAttribute('data-thread-root-id')
              )
              .find((id) => !!id) ?? undefined
          );
        });
        return middle;
      },
      { message: `${label}: a card in the middle of the scrolled view` }
    )
    .toBeTruthy();
  if (!middle) throw new Error('No card at the center of the Compact view');
  return middle;
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
  const view = page.locator('[data-compact-room-view]');
  await expect(view).toHaveAttribute('data-compact-card-count', String(THREAD_COUNT), {
    timeout: 60_000,
  });
  await expect(page.locator(CARDS).first(), `${label}: the newest thread leads`).toHaveAttribute(
    'data-thread-root-id',
    seeded.rootIds[THREAD_COUNT - 1]!
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
    await expect.poll(() => listScrollTop(page)).toBeGreaterThan(0);
    await scrollList(page, 0);
    await expect.poll(() => listScrollTop(page)).toBe(0);
    const phoneBody = `Heads up for ${label}: the status page shows a partial outage of the search API.`;
    const phoneCard = await agentPosts(seeded, phoneBody);
    await expectFirst(page, phoneCard, phoneBody, `after scrolling back up (${label})`);
    await shot(page, `${label}-3-scrolled-back`);
    return;
  }

  // 3. The pointer aims at the second card, holding the order: a new card still joins at
  // the top, the live end.
  const order = await cardOrder(page);
  const second = cardOf(page, order[1] ?? '');
  const heldBody = `Update for ${label}: the nightly backup finished in 14 minutes, all volumes verified.`;
  await withMovingMouseOverCard(page, second, async () => {
    const held = await agentPosts(seeded, heldBody);
    await expectFirst(page, held, heldBody, `while the order is held at the top (${label})`);
  });
  await shot(page, `${label}-3-held-top`);

  // 4. Scrolled down the list, the pointer on a card: the new card joins at the top and the card
  // under the pointer stays where it is.
  await page.mouse.move(5, 795);
  await scrollList(page, 700);
  // Start the hold on a settled card, not one still gliding from the previous arrival.
  await expect
    .poll(() =>
      view.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              (animation.effect as KeyframeEffect | null)?.target?.hasAttribute(
                'data-motion-row'
              ) && animation.playState !== 'finished'
          )
      )
    )
    .toBe(false);
  const middle = await findMiddleCard(view, label);
  const scrolledBody = `Update for ${label}: the certificate for the staging host renews tomorrow at noon.`;
  const scrolled = await withMovingMouseOverCard(page, cardOf(page, middle), (pointer) =>
    expectHeldArrival(view, middle, THREAD_COUNT + 3, pointer, label, () =>
      agentPosts(seeded, scrolledBody)
    )
  );
  await shot(page, `${label}-4-held-scrolled`);
  await page.mouse.move(5, 795);
  await scrollList(page, 0);
  await expectFirst(page, scrolled, scrolledBody, `after returning to the top (${label})`);
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
      test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
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

test('a sync batch larger than the Compact window does not displace a held card (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const seeded = await seed('batch');
  const batchSize = 40;
  await onWebKitPage({ ...DESKTOP, baseURL, reducedMotion: 'reduce' }, async (page) => {
    let buffering = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let deliveredIds: string[] = [];
    await page.route(/\/_matrix\/client\/(?:v3|r0)\/sync(?:\?|$)/, async (route) => {
      let response = await route.fetch({ timeout: 60_000 }).catch(() => undefined);
      if (!response) return;
      const url = new URL(route.request().url());
      if (buffering && url.searchParams.has('since')) {
        await gate;
        buffering = false;
        // The pending poll can return as soon as the first post arrives. Replay it from the
        // same since token with room for the entire batch, not the client's usual 20 events.
        url.searchParams.set('timeout', '0');
        url.searchParams.set(
          'filter',
          JSON.stringify({ room: { timeline: { limit: batchSize + 20 } } })
        );
        response = await route.fetch({ url: url.href, timeout: 15_000 });
        const sync = (await response.json()) as {
          rooms?: { join?: Record<string, { timeline?: { events?: { event_id: string }[] } }> };
        };
        deliveredIds =
          sync.rooms?.join?.[seeded.roomId]?.timeline?.events?.map((event) => event.event_id) ?? [];
      }
      await route.fulfill({ response }).catch(() => undefined);
    });
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: seeded.reader.username,
      password: PASSWORD,
    });
    await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
    const view = page.locator('[data-compact-room-view]');
    await expect(view).toHaveAttribute('data-compact-card-count', String(THREAD_COUNT), {
      timeout: 60_000,
    });
    await scrollList(page, 700);
    await expect.poll(() => listScrollTop(page)).toBeGreaterThan(0);

    buffering = true;
    try {
      const roots: string[] = [];
      for (let index = 0; index < batchSize; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        roots.push(await agentPosts(seeded, `Batch update ${index}: Export check complete.`));
      }
      const middle = await findMiddleCard(view, 'webkit-batch');
      expect(await page.locator(CARDS).count(), 'cards mounted before the batch').toBeLessThan(
        batchSize
      );
      const newest = await withMovingMouseOverCard(page, cardOf(page, middle), (pointer) =>
        expectHeldArrival(view, middle, THREAD_COUNT + batchSize, pointer, 'webkit-batch', () => {
          release();
          return roots.at(-1)!;
        })
      );
      expect(deliveredIds).toEqual(expect.arrayContaining(roots));
      await page.mouse.move(5, 795);
      await scrollList(page, 0);
      await expectFirst(page, newest, `Batch update ${batchSize - 1}:`, 'after the batch');
    } finally {
      release();
    }
  });
});

test('Chromium keeps a held Done card under the pointer when Needs you arrives above it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const seeded = await seed('before_done');
  await Promise.all(
    seeded.rootIds.map((id) =>
      sendStateEvent(
        HOMESERVER,
        seeded.reader.accessToken,
        seeded.roomId,
        'com.mindroom.thread.tags',
        JSON.stringify([id, 'resolved']),
        { set_by: seeded.reader.userId, set_at: new Date().toISOString() }
      )
    )
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId: seeded.roomId,
    userId: seeded.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.evaluate(
    (userId) =>
      localStorage.setItem(
        `compactRoomSections:${userId}`,
        JSON.stringify({ on: true, folded: [] })
      ),
    seeded.reader.userId
  );
  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
  const view = page.locator('[data-compact-room-view]');
  await expect(view.locator('[data-compact-section="done"]')).toContainText(`· ${THREAD_COUNT}`, {
    timeout: 60_000,
  });
  await expect(view).not.toHaveAttribute('data-cards-pending', 'true');
  await scrollList(page, 700);
  const middle = await findMiddleCard(view, 'chromium-done');
  await withMovingMouseOverCard(page, cardOf(page, middle), (pointer) =>
    expectHeldArrival(view, middle, THREAD_COUNT + 1, pointer, 'chromium-done', () =>
      agentPosts(seeded, 'A newly opened ticket')
    )
  );
  await expect(view.locator('[data-compact-section="needsYou"]')).toContainText('· 1');
});
