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
import { roomViewSwitch } from '../helpers/roomViewSwitch';
import { launchWebKit } from '../helpers/webkit';

// The Threads view of a room with an agent lists the room's threads under the filter bar, in the
// bar's order (Last Reply, newest first, by default). Whichever way the reader reaches it, it
// opens where the newest thread is, and a message the reader sends shows there at once. A room
// with 80 messages from two people and an agent, three of them threads, among 25 rooms, with
// classic scrollbars, on a desktop (1280 by 800) and a phone (390 by 844, touch), in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. The ways in: the
// view switch from Compact, a reload, the room list (unread), back from a thread, Compact and back;
// a permalink still lands on its own message, and Jump to Latest from there goes back up. Set
// THREADS_VIEW_SHOTS=<directory> to save each step.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'threads-view-opens-at-newest-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.THREADS_VIEW_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const ROOM_NAME = 'Release coordination';
const MESSAGE_COUNT = 80;
// Roots whose threads get replies, right after the root, so their last reply stays in history.
const THREAD_ROOTS = new Set([5, 20, 45]);
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
  const username = `tvn_${name}_${RUN}`;
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

const messageBody = (index: number) =>
  `Status update ${index}: the staging deploy for build ${
    1200 + index
  } finished, the smoke tests passed, and the release notes draft is ready for review.`;

type Seeded = {
  reader: MatrixSession & { username: string };
  colleague: MatrixSession;
  roomId: string;
  eventIds: string[];
};

/** The reader's 25 rooms; the main one holds the conversation with a colleague and an agent. */
const seed = async (label: string): Promise<Seeded> => {
  const reader = await registerAndLogin(`reader_${label}`);
  const colleague = await registerAndLogin(`colleague_${label}`);
  const agent = await registerAgentAccount(HOMESERVER, `helper_${label}`);
  for (const name of OTHER_ROOMS) {
    // eslint-disable-next-line no-await-in-loop
    await createRoom(HOMESERVER, reader.accessToken, { name });
  }
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [colleague.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const senders = [reader, colleague, agent] as const;
  const eventIds: string[] = [];
  for (let index = 1; index <= MESSAGE_COUNT; index += 1) {
    const sender = senders[index % senders.length] ?? reader;
    // eslint-disable-next-line no-await-in-loop
    const eventId = await sendRoomMessage(HOMESERVER, sender.accessToken, roomId, {
      msgtype: 'm.text',
      body: messageBody(index),
    });
    eventIds.push(eventId);
    if (THREAD_ROOTS.has(index)) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Checked build ${1200 + index}: no regressions in the dashboards, I will watch the error rate.`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: eventId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: eventId },
        },
      });
    }
  }
  return { reader, colleague, roomId, eventIds };
};

/**
 * Whether a timeline row with this text shows to the reader: the topmost element at a point of
 * the row is the row itself, not the header, the filter bar or the composer over it.
 */
const rowShown = (page: Page, text: string) =>
  page.evaluate((needle) => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].filter((row) =>
      row.textContent?.includes(needle)
    );
    return rows.some((row) => {
      const rect = row.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 160);
      return [rect.top + 8, rect.top + rect.height / 2, rect.bottom - 8].some((y) => {
        if (y < 0 || y > window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && row.contains(hit);
      });
    });
  }, text);

/** The room timeline's scroll position and the status updates in view, for failure messages. */
const describeView = (page: Page) =>
  page.evaluate(() => {
    const inner = document.querySelector('[data-testid="room-virtual-inner"]');
    let scroller = inner?.parentElement ?? null;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
      scroller = scroller.parentElement;
    }
    const shown = [...document.querySelectorAll<HTMLElement>('[data-message-id]')]
      .filter((row) => {
        const rect = row.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + 40, rect.top + rect.height / 2);
        return !!hit && row.contains(hit);
      })
      .map((row) => row.textContent?.match(/Status update \d+|Draft agenda \w+/)?.[0] ?? '?');
    return {
      scrollTop: Math.round(scroller?.scrollTop ?? -1),
      scrollRange: Math.round((scroller?.scrollHeight ?? 0) - (scroller?.clientHeight ?? 0)),
      shown,
    };
  });

const expectShown = async (page: Page, text: string, where: string) => {
  await expect
    .poll(() => rowShown(page, text), {
      message: `"${text}" shows ${where}`,
      timeout: 20_000,
    })
    .toBe(true);
  // Still there once the view settles: nothing scrolls it away afterwards.
  await page.waitForTimeout(1_500);
  const shown = await rowShown(page, text);
  expect(shown, `"${text}" stays shown ${where}: ${JSON.stringify(await describeView(page))}`).toBe(
    true
  );
};

/** Scrolls the room timeline down, as a reader does, until a virtualized row is mounted. */
const scrollUntilMounted = async (page: Page, row: Locator) => {
  for (let step = 0; step < 40 && (await row.count()) === 0; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => {
      const inner = document.querySelector('[data-testid="room-virtual-inner"]');
      let scroller = inner?.parentElement ?? null;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      scroller?.scrollBy({ top: scroller.clientHeight * 0.7 });
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(150);
  }
  await row.first().scrollIntoViewIfNeeded();
};

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const openRoomFromList = async (page: Page, phone: boolean) => {
  if (phone) await page.goto('/home/');
  await page.getByRole('link', { name: ROOM_NAME }).first().click();
};

const checkWaysIn = async (page: Page, seeded: Seeded, label: string, phone: boolean) => {
  const newest = 'Status update 80:';
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.reader.username,
    password: PASSWORD,
  });
  await page.goto('/home/');
  await openRoomFromList(page, phone);
  // A room with an agent opens in Compact; the switch moves it to Threads.
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await expect(page.locator('[data-thread-root-id]').first()).toBeVisible({ timeout: 30_000 });
  await roomViewSwitch(page).click();
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await expectShown(page, newest, `after switching to Threads (${label})`);
  await shot(page, `${label}-1-switch`);

  // A message the reader sends shows where the reader is.
  const sent = `Draft agenda ${RUN}: walk through the release checklist and the open questions.`;
  const composer = page.locator('[data-room-footer="true"] [contenteditable="true"]');
  await composer.click();
  await page.keyboard.type(sent);
  // A phone's Enter starts a new line; its send button sends.
  if (phone) await page.getByRole('button', { name: 'Send message', exact: true }).click();
  else await page.keyboard.press('Enter');
  await expectShown(page, `Draft agenda ${RUN}`, `after sending (${label})`);
  await shot(page, `${label}-2-sent`);

  await page.reload();
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
  await expectShown(page, `Draft agenda ${RUN}`, `after a reload (${label})`);
  await shot(page, `${label}-3-reload`);

  // Another room, where the reader misses a colleague's message, then back through the room
  // list: the unread room opens at its newest thread, the colleague's.
  if (phone) {
    await page.goto('/home/');
  }
  await page.getByRole('link', { name: 'Design reviews' }).first().click();
  await expect(page.getByText('Design reviews').first()).toBeVisible();
  await sendRoomMessage(HOMESERVER, seeded.colleague.accessToken, seeded.roomId, {
    msgtype: 'm.text',
    body: messageBody(81),
  });
  await openRoomFromList(page, phone);
  await expectShown(page, 'Status update 81:', `unread, after the room list (${label})`);
  await shot(page, `${label}-4-room-list`);

  // Into a thread further down and back.
  const threadRow = page.locator('[data-message-id]').filter({ hasText: 'Status update 45:' });
  await scrollUntilMounted(page, threadRow);
  await threadRow.getByRole('button', { name: /1 reply/ }).first().click();
  await expect(page.getByText('Checked build 1245').first()).toBeVisible({ timeout: 20_000 });
  await page.goBack();
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'false', { timeout: 20_000 });
  await expectShown(page, 'Status update 81:', `back from a thread (${label})`);
  await shot(page, `${label}-5-back`);

  // To Compact and back to Threads.
  await roomViewSwitch(page).click();
  await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 20_000 });
  await roomViewSwitch(page).click();
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await expectShown(page, 'Status update 81:', `after Compact and back (${label})`);
  await shot(page, `${label}-6-compact-and-back`);

  // A permalink still lands on its own message, even an old one.
  const oldEventId = seeded.eventIds[29] ?? '';
  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/${encodeURIComponent(oldEventId)}`);
  await expectShown(page, 'Status update 30:', `at its permalink (${label})`);
  await shot(page, `${label}-7-permalink`);

  // From there, Jump to Latest leads back up to the newest thread.
  await page.getByRole('button', { name: 'Jump to Latest' }).click();
  await expectShown(page, 'Status update 81:', `after Jump to Latest (${label})`);
  await shot(page, `${label}-8-jump-to-latest`);
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(`${form}`, () => {
    test.use(options);

    test(`the Threads view opens at the newest thread and shows a send (Chromium, ${form})`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const seeded = await seed(`c${form[0]}`);
      await checkWaysIn(page, seeded, `chromium-${form}`, form === 'phone');
    });

    test(`the Threads view opens at the newest thread and shows a send (WebKit, ${form})`, async ({
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
        await checkWaysIn(page, seeded, `webkit-${form}`, form === 'phone');
      } finally {
        await browser.close();
      }
    });
  });
}
