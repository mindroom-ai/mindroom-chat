import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';

import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
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
  const still = await watchVisibleRows(page);
  const scrolledBody = `Update for ${label}: the certificate for the staging host renews tomorrow at noon.`;
  const scrolled = await agentPosts(seeded, scrolledBody);
  await expectFirst(page, scrolled, scrolledBody, `scrolled down, under the pointer (${label})`);
  await page.waitForTimeout(600);
  await still();
  await shot(page, `${label}-4-held-scrolled`);
};

const listView = (page: Page) => page.locator('[data-compact-room-view]');
const updatePill = (page: Page) => page.getByRole('button', { name: 'Show updated order' });

/** Sample the layout shells, headers and the actual animated rows on every frame. */
const watchVisibleRows = async (page: Page) => {
  const watch = await listView(page).evaluateHandle((view) => {
    const bounds = view.getBoundingClientRect();
    const edge = bounds.top + view.clientTop + parseFloat(getComputedStyle(view).scrollPaddingTop);
    const rows = [
      ...view.querySelectorAll('[data-scroll-anchor], [data-motion-row], [data-compact-section]'),
    ].flatMap((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > edge + 1 && rect.top < bounds.bottom ? [{ row, top: rect.top }] : [];
    });
    let max = 0;
    let minTop = view.scrollTop;
    let frame = 0;
    const sample = () => {
      minTop = Math.min(minTop, view.scrollTop);
      rows.forEach(({ row, top }) => {
        max = Math.max(
          max,
          row.isConnected ? Math.abs(row.getBoundingClientRect().top - top) : Infinity
        );
      });
    };
    const tick = () => {
      sample();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return {
      read: () =>
        new Promise<{ rows: number; max: number; minTop: number }>((resolve) => {
          cancelAnimationFrame(frame);
          requestAnimationFrame(() => {
            sample();
            resolve({ rows: rows.length, max, minTop });
          });
        }),
    };
  });
  return async () => {
    const result = await watch.evaluate(({ read }) => read());
    await watch.dispose();
    expect(result.rows).toBeGreaterThan(2);
    expect(result.minTop, 'the list never clamped to its top').toBeGreaterThan(0);
    expect(result.max, 'largest visible movement in any frame').toBeLessThanOrEqual(1);
  };
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
  | 'freeze-return'
  | 'sections-swap';

const checkMove = async (page: Page, seeded: Seeded, move: Move) => {
  const { reader, roomId, rootIds } = seeded;
  const sections = move === 'sections' || move === 'sections-swap';
  const freezeReturn = move === 'freeze-return';
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
  const lock = page.locator('[data-thread-sort-freeze]');
  if (freezeReturn && !(await lock.isVisible())) {
    await page.locator('[data-thread-filter-bar-toggle]').click();
    await expect(lock).toBeVisible();
  }
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
  const leads = move === 'lead' || move === 'lead-two' || freezeReturn;
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
    'freeze-return': [shown[0]],
    'sections-swap': [shown[1]],
  };
  const movers = moversOf[move].map((rootId) => rootId ?? '');
  const mover = movers[0] ?? '';
  if (freezeReturn) {
    const frozen = await cardOrder(page);
    await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    await cardOf(page, shown[2] ?? '').click();
    await expect(page).toHaveURL(/threadId=/);
    await expect(page.locator('[data-compact-room-view]')).toHaveCount(0);
    const replyText = 'The leading card got an answer while the reader was elsewhere.';
    await reply(mover, replyText);
    await page.goBack();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(CARDS)).toHaveCount(THREAD_COUNT, { timeout: 60_000 });
    await expect(cardOf(page, mover)).toContainText(replyText);
    expect(await cardOrder(page)).toEqual(frozen);
    await page.mouse.move(5, 795);
    await expect.poll(() => listScrollTop(page)).toBeGreaterThan(0);
  }
  const before = await cardOrder(page);
  const still = await watchVisibleRows(page);
  if (freezeReturn) {
    await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'false');
  } else if (move === 'sections') {
    await agentStartsOn(seeded, mover);
    await expect(cardOf(page, mover)).toHaveAccessibleName(/Agent streaming/, { timeout: 30_000 });
  } else {
    for (const [index, rootId] of movers.entries()) {
      const text = `Found it: cause ${index + 1} is in the exporter.`;
      // eslint-disable-next-line no-await-in-loop
      await reply(rootId, text);
      // eslint-disable-next-line no-await-in-loop
      await expect(cardOf(page, rootId)).toContainText(text, { timeout: 30_000 });
    }
    await page.mouse.move(5, 795);
  }
  await page.waitForTimeout(600);
  await still();
  expect(await cardOrder(page)).toEqual(before);
  await expect(updatePill(page)).toBeVisible();
  if (move === 'release') {
    // A natural return to zero must keep the pointer hold until the pointer leaves.
    const box = (await cardOf(page, shown[1] ?? '').boundingBox())!;
    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
    await scrollList(page, 0);
    await expect(updatePill(page)).toHaveCount(0, { timeout: 1000 });
    expect(await listScrollTop(page)).toBe(0);
    await expect(page.locator('[data-order-held]')).toHaveCount(1, { timeout: 1000 });
    expect(await cardOrder(page)).toEqual(before);
    await page.mouse.move(5, 795);
    await expect
      .poll(async () => (await cardOrder(page)).slice(0, movers.length))
      .toEqual([...movers].reverse());
  }
};

const openScrolled = async (page: Page, seeded: Seeded, hideResolved = false) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.reader.username,
    password: PASSWORD,
  });
  if (hideResolved) {
    await seedRoomOverviewState({
      page,
      roomId: seeded.roomId,
      userId: seeded.reader.userId,
      viewMode: 'compact',
      filterState: {
        ...createDefaultThreadFilterState(),
        resolved: 'exclude',
        searchQuery: '-is:resolved',
      },
    });
  }
  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
  await expectRoomCompact(page, true, 60_000);
  await expect(page.locator(CARDS)).toHaveCount(THREAD_COUNT, { timeout: 60_000 });
  await scrollList(page, 700);
  await page.waitForTimeout(400);
};

const checkRelease = async (
  page: Page,
  seeded: Seeded,
  action: 'click' | 'tap' | 'Enter' | 'scroll'
) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await openScrolled(page, seeded);
  const rootId = seeded.rootIds[0] ?? '';
  const before = await cardOrder(page);
  const body = 'The report is ready for review.';
  await sendRoomMessage(HOMESERVER, seeded.agent.accessToken, seeded.roomId, {
    msgtype: 'm.text',
    body,
    'm.relates_to': threadRelation(rootId),
  });
  await expect(cardOf(page, rootId)).toContainText(body, { timeout: 30_000 });
  const pill = updatePill(page);
  await expect(pill).toBeInViewport();
  expect(await cardOrder(page)).toEqual(before);
  const gap = await pill.evaluate((button) => {
    const bar = document.querySelector('[data-room-thread-overview]');
    if (!bar) throw new Error('No floating filter bar');
    return button.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
  });
  expect(gap, 'gap below the floating filter bar').toBeGreaterThanOrEqual(0);
  expect(gap, 'gap below the floating filter bar').toBeLessThanOrEqual(16);
  await shot(page, `pill-${action}`);
  const formerFirstRow = listView(page).locator(`[data-motion-row="${before[0] ?? ''}"]`);
  const glide = await formerFirstRow.evaluateHandle((row) => {
    let glided = false;
    let frame = 0;
    const sample = () => {
      glided ||= getComputedStyle(row).translate !== 'none';
      frame = requestAnimationFrame(sample);
    };
    sample();
    return {
      read: () => glided,
      stop: () => cancelAnimationFrame(frame),
    };
  });
  if (action === 'tap') await pill.tap();
  else if (action === 'click') await pill.click();
  else if (action === 'Enter') {
    await pill.focus();
    const point = await listView(page).evaluate((view) => {
      const bounds = view.getBoundingClientRect();
      const card = [...view.querySelectorAll('[data-thread-root-id]')]
        .map((element) => element.getBoundingClientRect())
        .find((rect) => rect.top > bounds.top + bounds.height / 2 && rect.bottom < bounds.bottom);
      if (!card) throw new Error('No card below the pill to hover');
      return { x: card.left + card.width / 4, y: card.top + card.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('[data-thread-root-id]:hover')).toHaveCount(1);
    await page.keyboard.press('Enter');
    // The resting pointer normally holds for three seconds. Enter must not wait for it.
    await expect.poll(async () => (await cardOrder(page))[0], { timeout: 1000 }).toBe(rootId);
  } else await scrollList(page, 0);
  await expect.poll(() => listScrollTop(page)).toBe(0);
  await expect.poll(async () => (await cardOrder(page))[0]).toBe(rootId);
  await expect(pill).toHaveCount(0);
  if (action !== 'scroll') await expect(listView(page)).toBeFocused();
  await expect.poll(() => glide.evaluate(({ read }) => read())).toBe(true);
  await glide.evaluate(({ stop }) => stop());
  await glide.dispose();
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

test.describe('Compact order stays calm while scrolled', () => {
  test.use(DESKTOP);

  const moves: Move[] = [
    'below',
    'below-reduced',
    'sections',
    'in-view',
    'swap',
    'release',
    'rotate',
    'lead',
    'under',
    'lead-two',
    'freeze-return',
    'sections-swap',
  ];
  for (const [index, move] of moves.entries()) {
    test(`holds ${move} through rest (Chromium)`, async ({ page }) => {
      test.setTimeout(180_000);
      await checkMove(page, await seed(`m${index}`), move);
    });
  }

  test('removing a card above preserves the visible rows', async ({ page }) => {
    test.setTimeout(180_000);
    const seeded = await seed('leave');
    await openScrolled(page, seeded, true);
    const newest = seeded.rootIds.at(-1) ?? '';
    const still = await watchVisibleRows(page);
    await sendStateEvent(
      HOMESERVER,
      seeded.reader.accessToken,
      seeded.roomId,
      'com.mindroom.thread.tags',
      JSON.stringify([newest, 'resolved']),
      { set_by: seeded.reader.userId, set_at: new Date().toISOString() }
    );
    await expect(cardOf(page, newest)).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(600);
    await still();
    await expect(updatePill(page)).toHaveCount(0);
  });

  for (const action of ['click', 'Enter', 'scroll'] as const) {
    test(`${action} applies the order at the top with a glide`, async ({ page }) => {
      test.setTimeout(180_000);
      await checkRelease(page, await seed(action.toLowerCase()), action);
    });
  }
});

test.describe('Compact catch-up on a phone', () => {
  test.use(PHONE);

  test('tapping applies the order at the top with a glide', async ({ page }) => {
    test.setTimeout(180_000);
    await checkRelease(page, await seed('tap'), 'tap');
  });

  test('tapping applies the order at the top with a glide (WebKit)', async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright WebKit');
    test.setTimeout(180_000);
    const browser = await launchWebKit();
    try {
      const context = await browser.newContext({ ...PHONE, baseURL });
      await checkRelease(await context.newPage(), await seed('wtap'), 'tap');
    } finally {
      await browser.close();
    }
  });
});
