import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type Route,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// A room with unread messages, scrolled to the top of the rows it opened with while its older
// history is still loading: the floating Jump to Unread and Mark as Read pills sit under the room
// header, and "[+all]" (Expand all long messages) sits in the first line of the timeline, at the
// same height. Neither may cover the other: on a phone, where the centered pills reach past the
// line's end, "[+all]" moves to the line's start edge while they show (the pills keep clear of
// it) and returns when they go. Nothing above the rows changes height when the pills come or go,
// so no row moves. Checked on a phone (390 by 844, touch) and on desktop windows 1280 and 1440
// wide, where "[+all]" keeps its place, in light and dark, in English and Arabic (right to left),
// in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
// Set UNREAD_PILLS_SHOTS=<directory> to save each screen. On a phone the pills also fit the screen
// in every language the app offers, each label whole and inside its pill.
const PASSWORD = 'unread-pills-expand-all-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.UNREAD_PILLS_SHOTS;
const READ = 30;
const UNREAD = 30;
/** Read messages that start a thread of `REPLIES` replies. */
const THREAD_ROOTS = [2, 5, 9, 14];
const REPLIES = 3;

const DEVICES: [string, BrowserContextOptions][] = [
  ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['desktop-1280', { viewport: { width: 1280, height: 800 } }],
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }],
];
const LOCALES = ['en', 'ar'];

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`upx_${name}_${RUN}`, PASSWORD);

type Labels = { jump: string; mark: string };

/** The pills' labels in a language, from the app's catalog. */
const pillLabels = (code: string): Labels => {
  const catalog = JSON.parse(
    readFileSync(path.join(process.cwd(), 'src/app/i18n/locales', `${code}.json`), 'utf8')
  ) as {
    mindroomUi: { threads: { mindroomRoomTimeline: { jumpToUnread: string; markAsRead: string } } };
  };
  const strings = catalog.mindroomUi.threads.mindroomRoomTimeline;
  return { jump: strings.jumpToUnread, mark: strings.markAsRead };
};

const BODIES = [
  'The morning tide came in at the usual height. Crane two loaded the containers for berth four.',
  'Pilot boarding moved to 14:30 because of the fog bank outside the breakwater.',
  'Customs cleared the reefer containers; the paperwork for the last two is in the shared folder.',
  'Berth four is free again after the ferry left, so the barge can come alongside tonight.',
];

type Accounts = { reader: MatrixSession & { username: string }; writer: MatrixSession };

/** A reader with 25 other rooms, and a writer. */
const seedAccounts = async (engine: string): Promise<Accounts> => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const writer = await registerAndLogin(`writer_${engine}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  return { reader, writer };
};

/**
 * A room of `READ` messages from the writer that the reader has read, some of them with a thread,
 * followed by `UNREAD` messages the reader has not.
 */
const seedRoom = async ({ reader, writer }: Accounts, name: string) => {
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, writer.accessToken, roomId, { msgtype: 'm.text', ...content });
  const entry = (index: number) => `Entry ${index}: ${BODIES[index % BODIES.length] ?? ''}`;
  let lastRead = '';
  for (let index = 1; index <= READ; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    lastRead = await send({ body: entry(index) });
    if (THREAD_ROOTS.includes(index)) {
      const rootId = lastRead;
      let previous = rootId;
      for (let reply = 1; reply <= REPLIES; reply += 1) {
        // eslint-disable-next-line no-await-in-loop
        previous = await send({
          body: `Reply ${reply} to entry ${index}: noted, the harbor office has the update.`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: rootId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: previous },
          },
        });
      }
    }
  }
  await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/read_markers`, {
    method: 'POST',
    accessToken: reader.accessToken,
    body: JSON.stringify({ 'm.fully_read': lastRead, 'm.read': lastRead }),
  });
  for (let index = READ + 1; index <= READ + UNREAD; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send({ body: entry(index) });
  }
  return { roomId };
};

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, to: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, to);

/**
 * The reader scrolls the timeline up by part of a screen: a wheel turn or a swipe starts it (a
 * gesture the timeline takes as the reader's), and the position moves `step` px.
 */
const scrollUp = (page: Page, step: number) =>
  page.evaluate((by) => {
    let scroller = document.querySelector<HTMLElement>(
      '[data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -by, bubbles: true }));
    scroller.scrollTop -= by;
  }, step);

/** The timeline's scroll position, from its top, once its rows are there; -1 before. */
const scrollPosition = (page: Page) =>
  page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
    let scroller = inner?.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller || !document.querySelector('[data-message-id]')) return -1;
    return scroller.scrollTop;
  });

/** Scrolls up part of a screen at a time until the timeline rests at its top. */
const scrollToTop = async (page: Page) => {
  await expect
    .poll(
      async () => {
        await scrollUp(page, 600);
        await page.waitForTimeout(300);
        return scrollPosition(page);
      },
      { timeout: 60_000, intervals: [300] }
    )
    .toBe(0);
};

type Box = { left: number; right: number; top: number; bottom: number };

/** The boxes of "[+all]", its line, the pills (grown to their 44 px touch height), the area. */
const measure = (page: Page, labels: Labels) =>
  page.evaluate(({ jump, mark }) => {
    const box = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
    const toggle = document.querySelector<HTMLElement>('[data-timeline-overlay] > button');
    let scroller = toggle?.parentElement ?? null;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const line = toggle?.parentElement?.parentElement;
    const inner = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
    const pills = [...document.querySelectorAll<HTMLElement>('button')]
      .filter((button) => [jump, mark].includes(button.textContent?.trim() ?? ''))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        // The pill's touch layer reaches out until its area is 44 px tall.
        const grow = Math.max(0, (44 - rect.height) / 2);
        return { ...box(rect), top: rect.top - grow, bottom: rect.bottom + grow };
      });
    if (!toggle || !scroller || !line || !inner) throw new Error('Timeline parts missing');
    const lineBox = box(line.getBoundingClientRect());
    return {
      dir: document.documentElement.dir,
      toggle: box(toggle.getBoundingClientRect()),
      name: toggle.getAttribute('aria-label') ?? '',
      line: lineBox,
      area: box(scroller.getBoundingClientRect()),
      pills,
      // The rows follow the line: a line that changes height moves every row.
      rowsGap: inner.getBoundingClientRect().top - lineBox.bottom,
      lineHeight: lineBox.bottom - lineBox.top,
    };
  }, labels);

type Measured = Awaited<ReturnType<typeof measure>>;

const intersects = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Which half of the line "[+all]" is in: its start (left, or right in right to left) or end. */
const toggleSide = (m: Measured) => {
  const middle = (m.line.left + m.line.right) / 2;
  const center = (m.toggle.left + m.toggle.right) / 2;
  return center < middle === (m.dir !== 'rtl') ? 'start' : 'end';
};

const fmt = (b: Box) =>
  `${b.left.toFixed(0)}..${b.right.toFixed(0)} x ${b.top.toFixed(0)}..${b.bottom.toFixed(0)}`;

/** The rows in view, by event ID, and where each sits on screen. */
const rowPlaces = (page: Page) =>
  page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
    let scroller = inner?.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error('Timeline scroller missing');
    const area = scroller.getBoundingClientRect();
    const places: Record<string, number> = {};
    document.querySelectorAll<HTMLElement>('[data-message-id]').forEach((row) => {
      const rect = row.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > area.top && rect.top < area.bottom) {
        places[row.getAttribute('data-message-id') ?? ''] = rect.top;
      }
    });
    return places;
  });

const report: string[] = [];

/** The room at its start, pills shown: nothing intersects, in each color scheme. */
const checkStart = async (page: Page, where: string, labels: Labels, phone: boolean) => {
  for (const scheme of ['light', 'dark'] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(200);
    // eslint-disable-next-line no-await-in-loop
    const m = await measure(page, labels);
    const at = `${where}, ${scheme}`;
    report.push(
      `${at}: toggle ${fmt(m.toggle)} (${toggleSide(m)}), pills ${m.pills
        .map(fmt)
        .join(' / ')}, line ${m.lineHeight.toFixed(1)} px, area ${fmt(m.area)}`
    );
    expect(m.pills.length, `both pills show (${at})`).toBe(2);
    expect(m.name.length, `"[+all]" keeps its name (${at})`).toBeGreaterThan(0);
    m.pills.forEach((pill, index) => {
      expect
        .soft(
          intersects(m.toggle, pill),
          `"[+all]" ${fmt(m.toggle)} clear of pill ${index} ${fmt(pill)} (${at})`
        )
        .toBe(false);
      expect
        .soft(
          pill.left >= m.area.left && pill.right <= m.area.right,
          `pill ${index} ${fmt(pill)} on screen (${at})`
        )
        .toBe(true);
    });
    // Desktop keeps "[+all]" at the end of its line; a phone moves it to the start.
    expect.soft(toggleSide(m), `"[+all]" side (${at})`).toBe(phone ? 'start' : 'end');
    if (SHOTS) {
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: `${SHOTS}/${where.replace(/, /g, '-')}-${scheme}.png` });
    }
  }
};

/**
 * Mark as Read hides the pills: "[+all]" is back at its line's end, the line keeps its height,
 * and no row in view moves on screen. Coming back is the same change in reverse.
 */
const checkMarkAsRead = async (page: Page, where: string, labels: Labels) => {
  const before = await rowPlaces(page);
  const shown = await measure(page, labels);
  await page.getByRole('button', { name: labels.mark, exact: true }).click();
  await expect(page.getByRole('button', { name: labels.mark, exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  const hidden = await measure(page, labels);
  const after = await rowPlaces(page);
  expect.soft(toggleSide(hidden), `"[+all]" back at the end (${where})`).toBe('end');
  expect
    .soft(hidden.toggle.top, `"[+all]" keeps its line (${where})`)
    .toBeCloseTo(shown.toggle.top, 1);
  expect
    .soft(hidden.lineHeight, `the line keeps its height (${where})`)
    .toBeCloseTo(shown.lineHeight, 1);
  expect.soft(shown.rowsGap, `rows follow the line (${where})`).toBeCloseTo(0, 1);
  expect.soft(hidden.rowsGap, `rows follow the line without pills (${where})`).toBeCloseTo(0, 1);
  const shared = Object.keys(before).filter((id) => id in after);
  expect(shared.length, `rows in view both times (${where})`).toBeGreaterThan(0);
  shared.forEach((id) => {
    expect
      .soft(Math.abs((after[id] ?? 0) - (before[id] ?? 0)), `row ${id} keeps its place (${where})`)
      .toBeLessThanOrEqual(0.5);
  });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${where.replace(/, /g, '-')}-read.png` });
};

const run = async (browser: Browser, engine: string, baseURL: string | undefined) => {
  const accounts = await seedAccounts(engine);
  // Every room is there before the reader signs in, so each opens with its newest rows.
  const rooms = new Map<string, string>();
  for (const [device] of DEVICES) {
    for (const code of LOCALES) {
      // eslint-disable-next-line no-await-in-loop
      const room = await seedRoom(accounts, `Harbor log ${device} ${code}`);
      rooms.set(`${device} ${code}`, room.roomId);
    }
  }
  try {
    await runDevices(browser, engine, baseURL, accounts, rooms);
  } finally {
    console.log(report.join('\n'));
  }
};

const runDevices = async (
  browser: Browser,
  engine: string,
  baseURL: string | undefined,
  accounts: Accounts,
  rooms: Map<string, string>
) => {
  for (const [device, options] of DEVICES) {
    // The service worker would take the history requests out of the page's reach (WebKit).
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
    // Older history of the rooms this device checks is slow to come, from sign-in on: the
    // reader reaches the top of the rows a room opened with while its start is still to load.
    const held = new Map<string, Route[]>();
    LOCALES.forEach((code) => held.set(rooms.get(`${device} ${code}`) ?? '', []));
    const release = async (roomId: string) => {
      const routes = held.get(roomId) ?? [];
      held.delete(roomId);
      await Promise.all(routes.map((route) => route.continue().catch(() => undefined)));
    };
    try {
      // eslint-disable-next-line no-await-in-loop
      await context.route(
        (url) => /\/rooms\/[^/]+\/messages/.test(url.pathname),
        async (route) => {
          const { pathname } = new URL(route.request().url());
          const roomId = decodeURIComponent(pathname.split('/rooms/')[1]?.split('/')[0] ?? '');
          const routes = held.get(roomId);
          if (routes) routes.push(route);
          else await route.continue();
        }
      );
      // eslint-disable-next-line no-await-in-loop
      const page = await context.newPage();
      // eslint-disable-next-line no-await-in-loop
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: accounts.reader.username,
        password: PASSWORD,
      });
      for (const code of LOCALES) {
        const where = `${engine}, ${device}, ${code}`;
        const labels = pillLabels(code);
        // A room of its own: Mark as Read ends its unread state.
        const roomId = rooms.get(`${device} ${code}`) ?? '';
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate((language) => localStorage.setItem('i18nextLng', language), code);
        // eslint-disable-next-line no-await-in-loop
        await page.goto('/home/');
        // eslint-disable-next-line no-await-in-loop
        await expect
          .poll(() => page.evaluate(() => document.documentElement.dir))
          .toBe(code === 'ar' ? 'rtl' : 'ltr');
        // eslint-disable-next-line no-await-in-loop
        await openPath(page, `/home/${encodeURIComponent(roomId)}`);
        // eslint-disable-next-line no-await-in-loop
        await scrollToTop(page);
        // eslint-disable-next-line no-await-in-loop
        await expect
          .poll(() => held.get(roomId)?.length ?? 0, { timeout: 20_000 })
          .toBeGreaterThan(0);
        // eslint-disable-next-line no-await-in-loop
        await expect(page.getByRole('button', { name: labels.jump, exact: true })).toBeVisible({
          timeout: 30_000,
        });
        // eslint-disable-next-line no-await-in-loop
        await checkStart(page, where, labels, device === 'phone');
        // eslint-disable-next-line no-await-in-loop
        await checkMarkAsRead(page, where, labels);
        // eslint-disable-next-line no-await-in-loop
        await release(roomId);
      }
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the unread pills and "[+all]" never cover each other (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(480_000);
  await run(browser, 'chromium', baseURL);
});

test('the unread pills and "[+all]" never cover each other (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(480_000);
  const browser = await launchWebKit();
  try {
    await run(browser, 'webkit', baseURL);
  } finally {
    await browser.close();
  }
});

/** Every language the app offers: one catalog per language. */
const ALL_LOCALES = readdirSync(path.join(process.cwd(), 'src/app/i18n/locales'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

/**
 * Each pill's box, its label's box and whether the label's text fits inside it, and the box of the
 * timeline's area.
 */
const measurePills = (page: Page, labels: Labels) =>
  page.evaluate(({ jump, mark }) => {
    const box = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
    const inner = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
    let scroller = inner?.parentElement ?? null;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error('Timeline scroller missing');
    const pills = [...document.querySelectorAll<HTMLElement>('button')]
      .filter((button) => [jump, mark].includes(button.textContent?.trim() ?? ''))
      .map((button) => {
        const label = [...button.querySelectorAll<HTMLElement>('*')].find(
          (element) => element.textContent?.trim() === button.textContent?.trim()
        );
        // Where the label's letters are drawn, which can spill out of a pill that is too small.
        const range = document.createRange();
        if (label) range.selectNodeContents(label);
        const pill = button.getBoundingClientRect();
        const text = range.getBoundingClientRect();
        return {
          text: button.textContent?.trim() ?? '',
          pill: box(pill),
          labelFits:
            !!label &&
            label.scrollWidth <= label.clientWidth + 1 &&
            text.top >= pill.top - 0.5 &&
            text.bottom <= pill.bottom + 0.5 &&
            text.left >= pill.left - 0.5 &&
            text.right <= pill.right + 0.5,
        };
      });
    return { area: box(scroller.getBoundingClientRect()), pills };
  }, labels);

const checkEveryLanguage = async (
  browser: Browser,
  engine: string,
  baseURL: string | undefined
) => {
  const accounts = await seedAccounts(`langs_${engine}`);
  const { roomId } = await seedRoom(accounts, 'Harbor log languages');
  const context = await browser.newContext({ ...DEVICES[0]![1], baseURL, serviceWorkers: 'block' });
  // The room stays unread through every language's visit: no read receipt or marker leaves.
  await context.route(
    (url) => /\/(receipt|read_markers)(\/|$)/.test(url.pathname),
    (route) => route.fulfill({ json: {} })
  );
  try {
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: accounts.reader.username,
      password: PASSWORD,
    });
    const problems: string[] = [];
    for (const code of ALL_LOCALES) {
      const labels = pillLabels(code);
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((language) => localStorage.setItem('i18nextLng', language), code);
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`/home/${encodeURIComponent(roomId)}/`);
      // eslint-disable-next-line no-await-in-loop
      await expect(page.getByRole('button', { name: labels.jump, exact: true })).toBeVisible({
        timeout: 30_000,
      });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(300);
      // eslint-disable-next-line no-await-in-loop
      const m = await measurePills(page, labels);
      const widths = m.pills.map((pill) => (pill.pill.right - pill.pill.left).toFixed(0));
      report.push(`${engine}, phone, ${code}: pills ${widths.join(' + ')} px in ${fmt(m.area)}`);
      if (m.pills.length !== 2) problems.push(`${code}: ${m.pills.length} pills`);
      m.pills.forEach((pill) => {
        if (pill.pill.left < m.area.left - 0.5 || pill.pill.right > m.area.right + 0.5) {
          problems.push(`${code}: "${pill.text}" ${fmt(pill.pill)} leaves ${fmt(m.area)}`);
        }
        if (!pill.labelFits) problems.push(`${code}: "${pill.text}" is cut or spills out`);
      });
      const [first, second] = m.pills;
      if (first && second && intersects(first.pill, second.pill)) {
        problems.push(`${code}: the pills overlap`);
      }
      if (SHOTS && ['de', 'ru', 'bn'].includes(code)) {
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: `${SHOTS}/${engine}-phone-${code}-pills.png` });
      }
    }
    expect(problems).toEqual([]);
  } finally {
    console.log(report.join('\n'));
    await context.close();
  }
};

test('the unread pills fit a phone in every language (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(480_000);
  await checkEveryLanguage(browser, 'chromium', baseURL);
});

test('the unread pills fit a phone in every language (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(480_000);
  const browser = await launchWebKit();
  try {
    await checkEveryLanguage(browser, 'webkit', baseURL);
  } finally {
    await browser.close();
  }
});
