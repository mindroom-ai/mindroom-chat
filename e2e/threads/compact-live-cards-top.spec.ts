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
  createDefaultThreadFilterState,
  joinRoom,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { expectRoomCompact } from '../helpers/roomViewSwitch';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
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
// A card that moves up past the cards in view (its thread got a reply, or its agent started and it
// went to Working) leaves them where they are too, on the desktop in Chromium: from below the
// view, with and without motion, in sections under the Needs you header, from the view itself,
// and when it only swaps with the card that leads the view.
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

/** The agent starts on a thread, as MindRoom does: its card moves to Working. */
const agentStartsOn = (seeded: Seeded, rootId: string) =>
  sendRoomMessage(HOMESERVER, seeded.agent.accessToken, seeded.roomId, {
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'pending',
    'm.relates_to': threadRelation(rootId),
  });

const sectionHeader = (page: Page, id: string) => page.locator(`[data-compact-section="${id}"]`);

/** The threads the agent works on before the reader scrolls, so Working shows above Needs you. */
const WORKING = 3;

/** What a frame shows of the rows that lead the view, from the list's top edge. */
type LeadPlaces = {
  /** The row that leads the view: a card, or a section's header. */
  row: number;
  /** The first card in view that is not the one that moves. */
  card: number;
  scrollTop: number;
  /** Whether the card that moves shows before the row that leads the view. */
  crossed: boolean;
};

type LeadWatch = {
  before: LeadPlaces;
  /** The first frame that shows the card that moves before the leading row. */
  first?: LeadPlaces;
  /** The furthest the leading row or card showed from its place in any frame since. */
  furthest: number;
  read: () => LeadPlaces;
};

/**
 * Watches the row and the card that lead the view, frame by frame, while the card of `moverId`
 * moves; returns where they show now, and where that card shows and how high it is.
 */
const watchLead = (page: Page, moverId: string) =>
  page.evaluate((mover) => {
    const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
    if (!view) throw new Error('no Compact list');
    const edge = view.getBoundingClientRect().top + view.clientTop;
    const cardOf = (rootId: string) =>
      [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')].find(
        (shell) => shell.getAttribute('data-scroll-anchor') === rootId
      );
    const inView = [
      ...view.querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-compact-section]'),
    ].filter((row) => row.getBoundingClientRect().bottom > edge + 1);
    const leadRow = inView[0];
    const leadCard = inView.find(
      (row) =>
        row.hasAttribute('data-scroll-anchor') && row.getAttribute('data-scroll-anchor') !== mover
    );
    const moving = cardOf(mover);
    if (!leadRow || !leadCard || !moving) throw new Error('no row leads the view');
    // A header glides to its place (`translate`), a card's shell never does: a row's place in the
    // list is where it shows without the glide, which a frame mid-glide still tells apart.
    const placeOf = (row: HTMLElement) => {
      const glide = parseFloat(getComputedStyle(row).translate.split(' ')[1] ?? '');
      return row.getBoundingClientRect().top - edge - (glide || 0);
    };
    const read = (): LeadPlaces => {
      const now = cardOf(mover);
      return {
        row: placeOf(leadRow),
        card: placeOf(leadCard),
        scrollTop: view.scrollTop,
        // eslint-disable-next-line no-bitwise
        crossed:
          !!now && !!(leadRow.compareDocumentPosition(now) & Node.DOCUMENT_POSITION_PRECEDING),
      };
    };
    const watch: LeadWatch = { before: read(), furthest: 0, read };
    (window as unknown as { leadWatch: LeadWatch }).leadWatch = watch;
    const frame = () => {
      const now = read();
      if (now.crossed) {
        watch.first ??= now;
        watch.furthest = Math.max(
          watch.furthest,
          Math.abs(now.row - watch.before.row),
          Math.abs(now.card - watch.before.card)
        );
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const rect = moving.getBoundingClientRect();
    return {
      before: watch.before,
      leadCardId: leadCard.getAttribute('data-scroll-anchor') ?? '',
      moverTop: rect.top - edge,
      moverHeight: rect.height,
      viewHeight: view.clientHeight,
    };
  }, moverId);

const leadWatch = (page: Page) =>
  page.evaluate(() => {
    const { first, furthest, read } = (window as unknown as { leadWatch: LeadWatch }).leadWatch;
    return { first, furthest, now: read() };
  });

type Move = 'below' | 'below-reduced' | 'sections' | 'in-view' | 'swap';

/**
 * A reader scrolled down the list, the pointer away from it: a card moves up past the cards in
 * view, and the row and the card that lead the view show where they did, in the first frame that
 * shows the move and once the cards have glided.
 */
const checkMove = async (page: Page, seeded: Seeded, move: Move) => {
  const { reader, roomId, rootIds } = seeded;
  const sections = move === 'sections';
  if (move === 'below-reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.evaluate(
    ({ userId, on }) =>
      localStorage.setItem(`compactRoomSections:${userId}`, JSON.stringify({ on, folded: [] })),
    { userId: reader.userId, on: sections }
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expectRoomCompact(page, true, 60_000);
  await expect(page.locator(CARDS)).toHaveCount(THREAD_COUNT, { timeout: 60_000 });
  await page.mouse.move(5, 795);

  const reply = (rootId: string, body: string) =>
    sendRoomMessage(HOMESERVER, seeded.agent.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': threadRelation(rootId),
    });
  if (sections) {
    // The agent starts on the newest threads while the reader is at the top: Working comes and
    // grows, and the Needs you header glides down each time.
    for (const [index, rootId] of rootIds.slice(-WORKING).entries()) {
      // eslint-disable-next-line no-await-in-loop
      await agentStartsOn(seeded, rootId);
      // eslint-disable-next-line no-await-in-loop
      await expect(sectionHeader(page, 'working')).toHaveText(new RegExp(`· ${index + 1}$`), {
        timeout: 30_000,
      });
      // The glide ends.
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
    }
    // The Needs you header leads the view, over its cards: no card shows above it.
    await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
      const header = view?.querySelector<HTMLElement>('[data-compact-section="needsYou"]');
      if (!view || !header) return;
      const edge = view.getBoundingClientRect().top + view.clientTop;
      view.scrollTop += header.getBoundingClientRect().top - edge;
    });
  } else {
    // Cards glide first: two replies move their cards to the top while the reader is there.
    for (const rootId of [rootIds[3] ?? '', rootIds[4] ?? '']) {
      // eslint-disable-next-line no-await-in-loop
      await reply(rootId, 'An earlier note on this ticket.');
      // eslint-disable-next-line no-await-in-loop
      await expect.poll(async () => (await cardOrder(page))[0], { timeout: 30_000 }).toBe(rootId);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
    }
    // A swap: the first card still leads the view, cut by 30 px.
    await scrollList(page, move === 'swap' ? 30 : 700);
  }
  await page.waitForTimeout(300);

  // The card that moves: the oldest thread's, far below the view, or one in view, the card after
  // the one that leads it (a swap) or three cards below that one.
  const inView = move === 'in-view' || move === 'swap';
  const mover = inView
    ? await page.evaluate(
        (place) => {
          const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
          const edge = view?.getBoundingClientRect().top ?? 0;
          const shown = [...(view?.querySelectorAll<HTMLElement>('[data-scroll-anchor]') ?? [])]
            .filter((shell) => shell.getBoundingClientRect().bottom > edge + 1)
            .map((shell) => shell.getAttribute('data-scroll-anchor') ?? '');
          return shown[place] ?? '';
        },
        move === 'swap' ? 1 : 3
      )
    : rootIds[0] ?? '';
  const start = await watchLead(page, mover);
  const { before } = start;
  expect(before.scrollTop, `${move}: the list is scrolled`).toBeGreaterThan(0);
  expect(before.crossed, `${move}: the card that moves shows after the leading row`).toBe(false);
  expect(start.leadCardId, `${move}: another card leads the view`).not.toBe(mover);
  if (inView) {
    expect(start.moverTop, `${move}: the card that moves shows in view`).toBeGreaterThan(
      before.card + 1
    );
    expect(start.moverTop + start.moverHeight).toBeLessThan(start.viewHeight);
  } else {
    expect(start.moverTop, `${move}: the card that moves is below the view`).toBeGreaterThan(
      start.viewHeight
    );
  }
  if (sections) expect(Math.abs(before.row), `${move}: the header leads the view`).toBeLessThan(1);
  await shot(page, `move-${move}-1-before`);

  if (sections) {
    await agentStartsOn(seeded, mover);
    await expect(sectionHeader(page, 'working')).toHaveText(new RegExp(`· ${WORKING + 1}$`), {
      timeout: 30_000,
    });
  } else {
    await reply(mover, 'Found it: the exporter quotes a comma twice.');
  }
  // The card really moved past what leads the view.
  await expect
    .poll(async () => (await leadWatch(page)).now.crossed, {
      message: `${move}: the card moved up past the row that leads the view`,
      timeout: 30_000,
    })
    .toBe(true);
  if (!sections) expect((await cardOrder(page))[0], `${move}: the card leads the list`).toBe(mover);
  // The glides end.
  await page.waitForTimeout(600);
  const { first, furthest, now } = await leadWatch(page);
  const moved = (places: LeadPlaces | undefined) =>
    places ? Math.max(Math.abs(places.row - before.row), Math.abs(places.card - before.card)) : NaN;
  test.info().annotations.push({
    type: 'leading card',
    description: `${move}: moved ${moved(first)} px in the first frame, ${moved(
      now
    )} px at rest, ${furthest} px at most; scrollTop ${before.scrollTop} to ${
      now.scrollTop
    }; the card that moved is ${start.moverHeight} px high`,
  });
  await shot(page, `move-${move}-2-after`);
  expect(moved(first), `${move}: what leads the view moved, in the first frame`).toBeLessThan(1);
  expect(moved(now), `${move}: what leads the view moved, at rest`).toBeLessThan(1);
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

test.describe('a card moves up past the cards in view (Chromium, desktop)', () => {
  test.use(DESKTOP);

  for (const [index, [move, title]] of (
    [
      [
        'below',
        'a reply in a thread whose card is below the view leaves the cards in view in place',
      ],
      ['below-reduced', 'with reduced motion, a card that moves up from below the view does too'],
      ['sections', 'in sections, a card that moves to Working leaves Needs you in view in place'],
      ['in-view', 'a reply in a thread whose card is in view leaves the cards above it in place'],
      [
        'swap',
        'a reply in the thread of the second card leaves the first, which leads the view, in place',
      ],
    ] as const
  ).entries()) {
    test(title, async ({ page }) => {
      test.setTimeout(300_000);
      const seeded = await seed(`m${index}`);
      await checkMove(page, seeded, move);
    });
  }
});
