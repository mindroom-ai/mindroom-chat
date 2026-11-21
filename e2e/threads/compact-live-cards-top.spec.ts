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
// when it leads the view itself, and when
// several move at once as a resting pointer lets their order go: three from below the view, the
// three under the first two cards, which then stand above those two, the two under the card that
// leads the view, or that card and the next. A card that only trades places with the one before
// it, the card that leads the view, flat or in sections under the header that leads it, leaves
// the rows under the two where they are: the two trade places.
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
  /** The first row in view that does not move: a card, or a section's header. */
  row: number;
  /** The first card in view that does not move. */
  card: number;
  scrollTop: number;
  /**
   * Whether the card that moves shows before that row, or, when it led the view itself, before
   * the row that stood right before it.
   */
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
 * Watches the row and the card that lead the view, of those that stay, frame by frame, while the
 * cards of `moverIds` move; returns where they show now, and where the first of those cards shows
 * and how high it is. The card of `tradedId` does not stay either: the card that moves trades
 * places with it.
 */
const watchLead = (page: Page, moverIds: string[], tradedId?: string) => {
  const watched = [tradedId, ...moverIds];
  return page.evaluate(([traded, ...movers]) => {
    const mover = movers[0] ?? '';
    const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
    if (!view) throw new Error('no Compact list');
    // The view's top edge is where the browser anchors from: under the bar that floats over the
    // list's top, which the list's scroll padding leaves room for.
    const edge =
      view.getBoundingClientRect().top +
      view.clientTop +
      parseFloat(getComputedStyle(view).scrollPaddingTop);
    const cardOf = (rootId: string) =>
      [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')].find(
        (shell) => shell.getAttribute('data-scroll-anchor') === rootId
      );
    const rows = [
      ...view.querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-compact-section]'),
    ];
    const inView = rows.filter((row) => row.getBoundingClientRect().bottom > edge + 1);
    const stays = (row: HTMLElement) =>
      ![...movers, traded].includes(row.getAttribute('data-scroll-anchor') ?? '');
    const leadRow = inView.find(stays);
    const leadCard = inView.find((row) => row.hasAttribute('data-scroll-anchor') && stays(row));
    const moving = cardOf(mover);
    if (!leadRow || !leadCard || !moving) throw new Error('no row leads the view');
    // A card that leads the view itself moves up past the row before it, and one that trades
    // places past the card it trades with, which is another card in the page afterwards.
    const before = inView[0] === moving ? rows[rows.indexOf(moving) - 1] ?? leadRow : leadRow;
    const passed = () => (traded && cardOf(traded)) || before;
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
          !!now && !!(passed().compareDocumentPosition(now) & Node.DOCUMENT_POSITION_PRECEDING),
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
  }, watched);
};

const leadWatch = (page: Page) =>
  page.evaluate(() => {
    const { first, furthest, read } = (window as unknown as { leadWatch: LeadWatch }).leadWatch;
    return { first, furthest, now: read() };
  });

type Move =
  | 'below'
  | 'below-reduced'
  | 'sections'
  | 'in-view'
  | 'swap'
  | 'release'
  | 'rotate'
  | 'lead'
  | 'under'
  | 'lead-two'
  | 'sections-swap';

/**
 * A reader scrolled down the list, the pointer away from it: a card moves up past the cards in
 * view, and the row and the card that lead the view, of those that stay, show where they did, in
 * the first frame that shows the move, in every frame while the cards glide, and once they have.
 */
const checkMove = async (page: Page, seeded: Seeded, move: Move) => {
  const { reader, roomId, rootIds } = seeded;
  const sections = move === 'sections' || move === 'sections-swap';
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
      const edge =
        view.getBoundingClientRect().top +
        view.clientTop +
        parseFloat(getComputedStyle(view).scrollPaddingTop);
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
    // A swap, and three cards that rotate above two: the first card leads the view, cut by 30 px.
    await scrollList(page, move === 'swap' || move === 'rotate' ? 30 : 700);
  }
  const leads = move === 'lead' || move === 'lead-two';
  if (leads || move === 'under') {
    // The card that leads the view is cut by 30 px, far down the list.
    await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
      if (!view) return;
      const edge =
        view.getBoundingClientRect().top +
        view.clientTop +
        parseFloat(getComputedStyle(view).scrollPaddingTop);
      const lead = [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')].find(
        (shell) => shell.getBoundingClientRect().bottom > edge + 1
      );
      view.scrollTop += (lead?.getBoundingClientRect().top ?? edge) - edge + 30;
    });
  }
  await page.waitForTimeout(300);

  const shown = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
    if (!view) return [];
    const edge =
      view.getBoundingClientRect().top +
      view.clientTop +
      parseFloat(getComputedStyle(view).scrollPaddingTop);
    return [...view.querySelectorAll<HTMLElement>('[data-scroll-anchor]')]
      .filter((shell) => shell.getBoundingClientRect().bottom > edge + 1)
      .map((shell) => shell.getAttribute('data-scroll-anchor') ?? '');
  });
  // The second card in view trades places with the first: flat, at the list's top, and in
  // sections, at the top of Needs you, whose cards the newest reply leads.
  const trades = move === 'swap' || move === 'sections-swap';
  const inView = trades || move === 'in-view' || move === 'rotate' || move === 'under';
  // The cards that move, the first reply first. One: the oldest thread's, far below the view, or
  // one in view, the card after the one that leads it, three cards below that one, or the one
  // that leads it. Several, as a held order is let go: the three oldest threads', the
  // third to fifth card in view, the fifth first, so they keep their order above the first two,
  // the two cards under the one that leads the view, or that one and the next.
  const moversOf: Record<Move, (string | undefined)[]> = {
    below: [rootIds[0]],
    'below-reduced': [rootIds[0]],
    sections: [rootIds[0]],
    'in-view': [shown[3]],
    swap: [shown[1]],
    release: rootIds.slice(0, 3),
    rotate: [shown[4], shown[3], shown[2]],
    lead: [shown[0]],
    under: [shown[1], shown[2]],
    'lead-two': [shown[0], shown[1]],
    'sections-swap': [shown[1]],
  };
  const movers = moversOf[move].map((rootId) => rootId ?? '');
  const held = movers.length > 1;
  const mover = movers[0] ?? '';
  const start = await watchLead(page, movers, trades ? shown[0] : undefined);
  const { before } = start;
  expect(before.scrollTop, `${move}: the list is scrolled`).toBeGreaterThan(0);
  expect(before.crossed, `${move}: the card that moves shows after the row it passes`).toBe(false);
  expect(movers, `${move}: a card that stays leads the view`).not.toContain(start.leadCardId);
  if (leads) {
    expect(start.moverTop, `${move}: the card that moves leads the view, cut`).toBeCloseTo(-30, 0);
    expect(before.card, `${move}: the cards that stay show under it`).toBeGreaterThan(30);
  } else if (trades) {
    expect(start.moverTop, `${move}: the card that moves shows in view`).toBeGreaterThan(0);
    expect(before.card, `${move}: the cards that stay show under it`).toBeGreaterThan(
      start.moverTop + start.moverHeight
    );
  } else if (inView) {
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

  if (move === 'sections') {
    await agentStartsOn(seeded, mover);
    await expect(sectionHeader(page, 'working')).toHaveText(new RegExp(`· ${WORKING + 1}$`), {
      timeout: 30_000,
    });
  } else if (held) {
    // The pointer rests on a card in view, which holds the order, while each of the threads
    // gets a reply. A mouse at rest lets go after three seconds, so it keeps moving a
    // little until every reply shows.
    const rest = move === 'rotate' ? 1 : move === 'release' ? 2 : 3;
    const box = (await cardOf(page, shown[rest] ?? '').boundingBox())!;
    const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(pointer.x, pointer.y);
    await expect(page.locator('[data-order-held]')).toHaveCount(1);
    let moves = 0;
    const moving = setInterval(() => {
      moves += 1;
      page.mouse.move(pointer.x + (moves % 2), pointer.y).catch(() => undefined);
    }, 1_000);
    try {
      for (const [index, rootId] of movers.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await reply(rootId, `Found it: cause ${index + 1} is in the exporter.`);
        // eslint-disable-next-line no-await-in-loop
        await expect(cardOf(page, rootId)).toContainText(`cause ${index + 1} is in the exporter`, {
          timeout: 30_000,
        });
      }
    } finally {
      clearInterval(moving);
    }
    await expect(page.locator('[data-order-held]')).toHaveCount(1);
    expect((await leadWatch(page)).now.crossed, `${move}: the held cards kept their order`).toBe(
      false
    );
    // The pointer leaves the list: the cards move up in one render.
    await page.mouse.move(5, 795);
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
  if (!sections) {
    expect(
      (await cardOrder(page)).slice(0, movers.length),
      `${move}: the cards that moved lead the list, the last reply first`
    ).toEqual([...movers].reverse());
  }
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
  // The same places in every frame since: a header's without its glide, a card's as it shows.
  expect(furthest, `${move}: what leads the view moved, in some frame`).toBeLessThan(1);
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
        'a reply in the thread of the second card trades its place with the first, which leads the view, and leaves the cards under the two in place',
      ],
      [
        'release',
        'three cards that move up at once, a held order let go, leave the cards in view in place',
      ],
      [
        'rotate',
        'the three cards under the first two move above them at once, and the first, cut at the top, stays in place',
      ],
      [
        'lead',
        'a reply in the thread of the card that leads the view, cut at the top, leaves the cards under it in place',
      ],
      [
        'under',
        'replies at once in the threads of the two cards under the one that leads the view leave it in place',
      ],
      [
        'lead-two',
        'replies at once in the threads of the card that leads the view and the next leave the cards under them in place',
      ],
      [
        'sections-swap',
        'in sections, a reply in the second card under the Needs you header, which leads the view, trades its place with the first and leaves the header and the cards under the two in place',
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
