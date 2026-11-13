import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { expectRoomCompact, toggleRoomView } from '../helpers/roomViewSwitch';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The Threads view of a room with an agent lists the newest thread first, where it opens and
// where the reader reads. A "New messages" line there would mark the newest row, not the place
// where the reader stopped, so the view draws none and offers no Jump to Unread or Mark as Read
// pills, as MindRoom Chat does; a room read oldest first (a room of people, and the agent's room in
// Classic) still offers Jump to Unread, which brings the line where the unread messages start into
// view, clear of the header and the composer. Each room holds 30 read and 30 unread messages,
// among 25 rooms; desktop (1280 by 800, classic scrollbars) and phone (390 by 844, touch),
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. The page
// sends no read receipt, so the rooms stay unread. Set UNREAD_LINE_SHOTS=<directory> for
// screenshots.
const PASSWORD = 'threads-view-unread-line-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.UNREAD_LINE_SHOTS;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const AGENT_ROOM = 'Harbor log';
const PEOPLE_ROOM = 'Harbor crew';
const BODIES = [
  'The morning tide came in at the usual height. Crane two loaded the containers for berth four.',
  'Pilot boarding moved to 14:30 because of the fog bank outside the breakwater.',
  'Customs cleared the reefer containers; the paperwork for the last two is in the shared folder.',
  'Berth four is free again after the ferry left, so the barge can come alongside tonight.',
];

test.use({
  launchOptions: {
    // Classic scrollbars, as desktop browsers show them. The other options repeat
    // playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  // A repeated test (--repeat-each) runs in the same worker, with the same RUN.
  const username = `tvu_${name}_${RUN}${test.info().repeatEachIndex}`;
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

/** A room where `writer` sent 30 messages the reader read and 30 it has not. */
const seedRoom = async (
  reader: MatrixSession,
  writer: MatrixSession,
  name: string
): Promise<string> => {
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  const send = (index: number) =>
    sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Entry ${index}: ${BODIES[index % BODIES.length] ?? ''}`,
    });
  let lastRead = '';
  for (let index = 1; index <= 30; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    lastRead = await send(index);
  }
  await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/read_markers`, {
    method: 'POST',
    accessToken: reader.accessToken,
    body: JSON.stringify({ 'm.fully_read': lastRead, 'm.read': lastRead }),
  });
  for (let index = 31; index <= 60; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(index);
  }
  return roomId;
};

const seed = async (label: string) => {
  const reader = await registerAndLogin(`reader_${label}`);
  const colleague = await registerAndLogin(`colleague_${label}`);
  const agent = await registerAgentAccount(HOMESERVER, `harbor_${label}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const agentRoom = await seedRoom(reader, agent, AGENT_ROOM);
  const peopleRoom = await seedRoom(reader, colleague, PEOPLE_ROOM);
  return { reader, agentRoom, peopleRoom };
};

const shots = async (page: Page, name: string) => {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
};

/** The timeline's scroll container, scrolled by `by` px (down when positive). */
const scrollBy = (page: Page, by: number) =>
  page.evaluate((delta) => {
    let scroller = document.querySelector<HTMLElement>(
      '[data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true }));
    scroller.scrollTop += delta;
  }, by);

/**
 * Where the "New Messages" line is once the view rests (its scroll position held for 30 frames):
 * 'in view' when all of it is inside the timeline's visible band, the scroll area less the bars
 * over its edges (its scroll padding), at least `margin` px from either edge; otherwise what was
 * seen instead.
 */
const restingLinePlace = (page: Page, margin = 16) =>
  page.evaluate(async (margin) => {
    let scroller = document.querySelector<HTMLElement>(
      '[data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return 'no scroll area';
    const area = scroller;
    let still = 0;
    let frames = 0;
    let last = area.scrollTop;
    while (still < 30) {
      if (frames > 600) return `still scrolling at ${Math.round(area.scrollTop)}`;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(requestAnimationFrame);
      frames += 1;
      still = Math.abs(area.scrollTop - last) < 1 ? still + 1 : 0;
      last = area.scrollTop;
    }
    const at = `scrollTop ${Math.round(area.scrollTop)} of ${area.scrollHeight - area.clientHeight}`;
    const line = [...area.querySelectorAll('[role="separator"]')].find((element) =>
      element.textContent?.includes('New Messages')
    );
    if (!line) return `no line mounted, ${at}`;
    const style = getComputedStyle(area);
    const view = area.getBoundingClientRect();
    const top = view.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
    const bottom = view.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
    const box = line.getBoundingClientRect();
    if (box.top >= top + margin && box.bottom <= bottom - margin) return 'in view';
    return `line at ${Math.round(box.top)} to ${Math.round(box.bottom)}, visible band ${Math.round(
      top
    )} to ${Math.round(bottom)}, ${at}`;
  }, margin);

const check = async (browser: Browser, label: string, options: BrowserContextOptions) => {
  const { reader, agentRoom, peopleRoom } = await seed(label);
  // The service worker would take requests out of the page's routes (WebKit).
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  context.setDefaultTimeout(30_000);
  // The rooms stay unread: no read receipt or marker leaves the page.
  await context.route(
    (url) => /\/(receipt|read_markers)(\/|$)/.test(url.pathname),
    (route) => route.fulfill({ json: {} })
  );
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    const line = page.getByText('New Messages', { exact: true });
    const pills = page.getByRole('button', { name: /^(Jump to Unread|Mark as Read)$/ });

    // The agent's room, in its Threads view: newest first.
    await page.goto(`/home/${encodeURIComponent(agentRoom)}/`);
    await expectRoomCompact(page, true, 60_000);
    await toggleRoomView(page);
    await expectRoomCompact(page, false);
    await expect(page.getByText(/^Entry 60:/).first()).toBeVisible();
    // Long enough for the line and the pills to have come if they were to.
    await page.waitForTimeout(2_000);
    await shots(page, `${label}-threads-top`);
    await expect(line).toHaveCount(0);
    await expect(pills).toHaveCount(0);
    // Down past where the unread messages end: still no line where they meet the read ones.
    let boundarySeen = false;
    for (let step = 0; step < 8; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await scrollBy(page, 500);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(300);
      // eslint-disable-next-line no-await-in-loop
      await expect(line).toHaveCount(0);
      // eslint-disable-next-line no-await-in-loop
      if ((await page.getByText(/^Entry 30:/).count()) > 0) boundarySeen = true;
    }
    expect(boundarySeen, 'the rows where read and unread meet were shown').toBe(true);

    // A room of people, read oldest first: the line sits right above the first unread message.
    // It opens at its newest messages and offers Jump to Unread, which leads to the line.
    await page.goto(`/home/${encodeURIComponent(peopleRoom)}/`);
    const jump = page.getByRole('button', { name: 'Jump to Unread', exact: true });
    await expect(jump).toBeVisible({ timeout: 60_000 });
    if (options.hasTouch) await jump.tap();
    else await jump.click();
    // The jump alone brings the line into view and leaves it there: the test does not scroll.
    await expect.poll(() => restingLinePlace(page), { timeout: 15_000 }).toBe('in view');
    const [lineBox, firstUnread, lastRead] = await Promise.all([
      line.boundingBox(),
      page
        .getByText(/^Entry 31:/)
        .first()
        .boundingBox(),
      page
        .getByText(/^Entry 30:/)
        .first()
        .boundingBox(),
    ]);
    expect(lineBox!.y).toBeLessThan(firstUnread!.y);
    expect(lineBox!.y).toBeGreaterThan(lastRead!.y);
    await shots(page, `${label}-people-room`);

    // The agent's room in Classic, oldest first as well: Jump to Unread brings its line into view.
    await seedRoomOverviewState({
      page,
      roomId: agentRoom,
      userId: reader.userId,
      viewMode: 'classic',
    });
    await page.goto(`/home/${encodeURIComponent(agentRoom)}/`);
    await expect(jump).toBeVisible({ timeout: 60_000 });
    if (options.hasTouch) await jump.tap();
    else await jump.click();
    await expect.poll(() => restingLinePlace(page), { timeout: 15_000 }).toBe('in view');
    await shots(page, `${label}-agent-room-classic`);
  } catch (error) {
    // A WebKit page is not the test's own, so Playwright keeps no screenshot of it.
    await page.screenshot({ path: test.info().outputPath(`${label}-failed.png`) }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.setTimeout(240_000);
});

for (const [device, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`a newest-first Threads view draws no New Messages line (Chromium ${device})`, async ({
    browser,
  }) => {
    await check(browser, `chromium-${device}`, options);
  });

  test(`a newest-first Threads view draws no New Messages line (WebKit ${device})`, async () => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    const browser = await launchWebKit();
    try {
      await check(browser, `webkit-${device}`, options);
    } finally {
      await browser.close();
    }
  });
}
