import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import { expectRoomCompact, toggleRoomView } from '../helpers/roomViewSwitch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// A reader who scrolled away from the newest messages and sends one sees it land: the view
// follows to it, and once the server has it, the room is read up to it, the messages that came
// while the reader was away included (no New Messages line above their own). Checked in a room
// between two people with 400 messages (the Threads view, newest at the bottom), about 200
// messages up, after a colleague wrote twice meanwhile, and in a room with an agent (the Threads
// view sorted Last Reply, newest first, so newest at the top), and in the Full view. (An open
// thread keeps the place of a reader who scrolled up its replies, as the ported live-row suite
// expects.) Among 25 rooms, with classic scrollbars, on a desktop (1280 by 800) and a phone (390 by 844,
// touch), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit. Set SEND_FOLLOWS_SHOTS to a directory to save each landing.
const PASSWORD = 'send-follows-own-message-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.SEND_FOLLOWS_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const PEOPLE_ROOM = 'Backlog review';
const AGENT_ROOM = 'Release coordination';
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
];

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`sfo_${name}_${RUN}`, PASSWORD);

const note = (index: number) =>
  `Backlog item ${index}: the import job retried twice overnight, the dashboard shows the gap, and the owner will look at it after standup.`;

type Seeded = {
  reader: MatrixSession & { username: string };
  colleague: MatrixSession;
  peopleRoomId: string;
  agentRoomId: string;
};

const send = (session: MatrixSession, roomId: string, content: Record<string, unknown>) =>
  sendRoomMessage(HOMESERVER, session.accessToken, roomId, content);

const seed = async (label: string): Promise<Seeded> => {
  const reader = await registerAndLogin(`reader_${label}`);
  const colleague = await registerAndLogin(`colleague_${label}`);
  const agent = await registerAgentAccount(HOMESERVER, `helper_${label}`);
  for (const name of OTHER_ROOMS) {
    // eslint-disable-next-line no-await-in-loop
    await createRoom(HOMESERVER, reader.accessToken, { name });
  }
  const peopleRoomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: PEOPLE_ROOM,
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, peopleRoomId);
  for (let index = 1; index <= 400; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(index % 2 ? colleague : reader, peopleRoomId, {
      msgtype: 'm.text',
      body: note(index),
    });
  }
  const agentRoomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: AGENT_ROOM,
    invite: [colleague.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, agentRoomId);
  await joinRoom(HOMESERVER, agent.accessToken, agentRoomId);
  for (let index = 1; index <= 60; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(index % 3 ? colleague : agent, agentRoomId, {
      msgtype: 'm.text',
      body: `Release step ${index}: the checklist item is done and the notes are in the tracker.`,
    });
  }
  return { reader, colleague, peopleRoomId, agentRoomId };
};

/** Whether a row with this text shows to the reader, not covered by the header or composer. */
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

/**
 * Scrolls the open timeline away from where it is, in steps, as a reader does: each step starts
 * with a wheel event (the reader's gesture), and older history pages in between the steps.
 */
const scrollAway = async (page: Page, deltaY: number, steps = 5) => {
  for (let step = 0; step < steps; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((delta) => {
      // The scroll area of the timeline's rows, the room's or the open thread's.
      let scroller = document.querySelector('[data-message-id]')?.parentElement ?? null;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      scroller?.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true }));
      scroller?.scrollBy({ top: delta });
    }, deltaY);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(800);
};

const typeAndSend = async (page: Page, text: string, phone: boolean) => {
  await page.locator('[data-room-footer="true"] [contenteditable="true"]').click();
  await page.keyboard.type(text);
  // A phone's Enter starts a new line; its send button sends.
  if (phone) await page.getByRole('button', { name: 'Send message', exact: true }).click();
  else await page.keyboard.press('Enter');
};

const expectLanded = async (page: Page, text: string, where: string) => {
  await expect
    .poll(() => rowShown(page, text), { message: `"${text}" shows ${where}`, timeout: 10_000 })
    .toBe(true);
  await page.waitForTimeout(1_000);
  expect(await rowShown(page, text), `"${text}" stays shown ${where}`).toBe(true);
};

/** The reader's main-timeline receipt in a room, as the server reports it. */
const readerReceipt = async (seeded: Seeded, roomId: string) => {
  const sync = await matrixFetch<{
    rooms?: {
      join?: Record<string, { ephemeral?: { events?: Array<{ type: string; content: unknown }> } }>;
    };
  }>(HOMESERVER, '/sync?timeout=0', { accessToken: seeded.reader.accessToken });
  const events = sync.rooms?.join?.[roomId]?.ephemeral?.events ?? [];
  for (const event of events) {
    if (event.type !== 'm.receipt') continue;
    const content = event.content as Record<
      string,
      Record<string, Record<string, { thread_id?: string }>>
    >;
    for (const [eventId, byType] of Object.entries(content)) {
      const receipt = byType['m.read']?.[seeded.reader.userId];
      if (receipt && (receipt.thread_id ?? 'main') === 'main') return eventId;
    }
  }
  return undefined;
};

const latestEventId = async (seeded: Seeded, roomId: string, body: string) => {
  const page = await matrixFetch<{
    chunk: Array<{ event_id: string; content?: { body?: string } }>;
  }>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=10`, {
    accessToken: seeded.reader.accessToken,
  });
  return page.chunk.find((event) => event.content?.body === body)?.event_id;
};

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const openRoom = async (page: Page, name: string, phone: boolean) => {
  if (phone) await page.goto('/home/');
  await page.getByRole('link', { name }).first().click();
};

const checkSends = async (page: Page, seeded: Seeded, label: string, phone: boolean) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.reader.username,
    password: PASSWORD,
  });
  await page.goto('/home/');

  // A room between two people: scrolled up, a colleague writes twice, the reader sends.
  await openRoom(page, PEOPLE_ROOM, phone);
  await expect(page.getByText('Backlog item 400:').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  // About 200 messages up, so the window of rows leaves the live end.
  await scrollAway(page, -1_500, 12);
  expect(await rowShown(page, 'Backlog item 400:'), 'the reader scrolled away').toBe(false);
  await send(seeded.colleague, seeded.peopleRoomId, { msgtype: 'm.text', body: note(401) });
  await send(seeded.colleague, seeded.peopleRoomId, { msgtype: 'm.text', body: note(402) });
  await page.waitForTimeout(1_000);
  const roomText = `Own note ${RUN} ${label}: I will rerun the import after lunch.`;
  await typeAndSend(page, roomText, phone);
  await expectLanded(page, roomText, `in the room (${label})`);
  await expect(page.getByText('New Messages')).toHaveCount(0);
  await shot(page, `${label}-room`);
  const ownId = await latestEventId(seeded, seeded.peopleRoomId, roomText);
  expect(ownId, 'the server has the message').toBeTruthy();
  await expect
    .poll(() => readerReceipt(seeded, seeded.peopleRoomId), {
      message: `the room is read up to the reader's message (${label})`,
      timeout: 10_000,
    })
    .toBe(ownId);

  // The same room in the Full view, a stored choice.
  await seedRoomOverviewState({
    page,
    roomId: seeded.peopleRoomId,
    userId: seeded.reader.userId,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await page.reload();
  await expect(page.getByText(roomText).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await scrollAway(page, -1_500, 12);
  expect(await rowShown(page, roomText), 'the reader scrolled away in the Full view').toBe(false);
  const fullText = `Own Full view note ${RUN} ${label}: the rerun is scheduled for two.`;
  await typeAndSend(page, fullText, phone);
  await expectLanded(page, fullText, `in the Full view (${label})`);
  await shot(page, `${label}-full`);

  // A room with an agent, newest first: scrolled down, the reader sends.
  await openRoom(page, AGENT_ROOM, phone);
  await expectRoomCompact(page, true);
  await toggleRoomView(page);
  await expect(page.getByText('Release step 60:').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await scrollAway(page, 1_600);
  expect(await rowShown(page, 'Release step 60:'), 'the reader scrolled down').toBe(false);
  const agentRoomText = `Own step ${RUN} ${label}: the release notes are ready for review.`;
  await typeAndSend(page, agentRoomText, phone);
  await expectLanded(page, agentRoomText, `in the newest-first Threads view (${label})`);
  await shot(page, `${label}-newest-first`);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);

    test(`a message sent while scrolled away lands in view and reads the room (Chromium, ${form})`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const seeded = await seed(`c${form[0]}`);
      await checkSends(page, seeded, `chromium-${form}`, form === 'phone');
    });

    test(`a message sent while scrolled away lands in view and reads the room (WebKit, ${form})`, async ({
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
        await checkSends(page, seeded, `webkit-${form}`, form === 'phone');
      } finally {
        await browser.close();
      }
    });
  });
}
