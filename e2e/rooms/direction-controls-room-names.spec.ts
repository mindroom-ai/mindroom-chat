import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  addRoomToSpace,
  createDefaultThreadFilterState,
  createPrivateSpace,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C) change the
// order text shows in without showing themselves: a room named `Payroll <U+202E>sevihcra<U+202C>`
// reads as "Payroll archives". Wherever the app shows a room's or a space's name or topic, or a
// thread's summary, each control shows as its code point: the room header and its topic viewer,
// the timeline's rename rows and thread summary, the thread banner, room settings, message search,
// the command palette, an incoming call, the space's lobby, sidebar and rail tab, and the
// sidebar's thread tooltip. Against the disposable homeserver of a slot, on a phone (390 by 844,
// touch) and a desktop (1280 by 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set DIRECTION_NAMES_SHOTS=<directory> to save each view.
const PASSWORD = 'direction-names-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DIRECTION_NAMES_SHOTS;
const FILLER_ROOMS = 24;
const MEMBER_NAME = 'Avery Quinn';

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

const ROOM_NAME = 'Payroll ‮sevihcra‬';
const ROOM_NAME_SHOWN = 'Payroll <U+202E>sevihcra<U+202C>';
const ROOM_TOPIC = 'Where we file ‮stpiecer‬ for the audit';
const ROOM_TOPIC_SHOWN = 'Where we file <U+202E>stpiecer<U+202C> for the audit';
const SPACE_NAME = 'Finance ‮sweiver‬';
const SPACE_NAME_SHOWN = 'Finance <U+202E>sweiver<U+202C>';
const SPACE_TOPIC = 'Plans for the ‮esolc‬ of the quarter';
const SPACE_TOPIC_SHOWN = 'Plans for the <U+202E>esolc<U+202C> of the quarter';
const SUMMARY = 'Audit of ‮xslx.exe‬ before Friday';
const SUMMARY_SHOWN = 'Audit of <U+202E>xslx.exe<U+202C> before Friday';
const SEARCH_WORD = `zephyrledger${RUN}`;

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string, displayName: string): Promise<Account> => {
  const username = `bidinames_${name}_${RUN}`;
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
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { ...session, username };
};

type World = {
  reader: Account;
  member: Account;
  roomId: string;
  spaceId: string;
  rootId: string;
};

const threadRelation = (rootId: string, lastId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: lastId },
});

/**
 * Two people in a room of the reader's space, among 24 other rooms. The room and the space take
 * names and topics with controls (the room's by a rename after it was made, so the timeline has a
 * rename row), then a few messages and a thread the member titles with a summary.
 */
const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`reader_${engine}`, 'Robin Reader');
  const member = await registerAndLogin(`member_${engine}`, MEMBER_NAME);
  const spaceId = await createPrivateSpace(HOMESERVER, reader.accessToken, {
    name: SPACE_NAME,
    topic: SPACE_TOPIC,
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Payroll',
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await addRoomToSpace(HOMESERVER, reader.accessToken, spaceId, roomId);
  // Any member may join a call in the room, as in a room made for calls.
  const levelsPath = `/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`;
  const levels = await matrixFetch<{ events?: Record<string, number> }>(HOMESERVER, levelsPath, {
    accessToken: reader.accessToken,
  });
  await matrixFetch(HOMESERVER, levelsPath, {
    method: 'PUT',
    accessToken: reader.accessToken,
    body: JSON.stringify({
      ...levels,
      events: { ...levels.events, 'org.matrix.msc3401.call.member': 0 },
    }),
  });
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Ledger room ${index}` });
  await sendStateEvent(HOMESERVER, reader.accessToken, roomId, 'm.room.name', '', {
    name: ROOM_NAME,
  });
  await sendStateEvent(HOMESERVER, reader.accessToken, roomId, 'm.room.topic', '', {
    topic: ROOM_TOPIC,
  });
  const say = (account: Account, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, account.accessToken, roomId, content);
  await say(member, { msgtype: 'm.text', body: 'Morning. The receipts for March are scanned.' });
  await say(reader, {
    msgtype: 'm.text',
    body: `Thanks. I tagged the ledger entries with ${SEARCH_WORD} so we can find them later.`,
  });
  const rootId = await say(member, {
    msgtype: 'm.text',
    body: 'Can someone check the audit files before the review on Friday?',
  });
  const replyId = await say(reader, {
    msgtype: 'm.text',
    body: 'I can take that this afternoon.',
    'm.relates_to': threadRelation(rootId, rootId),
  });
  await say(member, {
    msgtype: 'm.notice',
    body: SUMMARY,
    'm.relates_to': threadRelation(rootId, replyId),
    'io.mindroom.thread_summary': {
      version: 1,
      summary: SUMMARY,
      message_count: 2,
      generated_at: new Date().toISOString(),
      model: 'default',
    },
  });
  return { reader, member, roomId, spaceId, rootId };
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The scope shows `shown` and holds no control character. */
const expectShown = async (scope: Locator, shown: string) => {
  await expect(scope).toContainText(shown, { timeout: 30_000 });
  expect(await scope.textContent()).not.toMatch(CONTROL);
};

/** Moves within the app, as a link would. */
const go = (page: Page, route: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);

const roomPath = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;

/**
 * The member rings the room, as another client does when it starts a call: its call membership,
 * then a ring. A ring whose call has nobody in it stops within a second, so the membership keeps
 * this one up until the reader dismisses it.
 */
const ring = async (world: World, tag: string) => {
  const { member, reader, roomId } = world;
  const { device_id: device } = await matrixFetch<{ device_id: string }>(
    HOMESERVER,
    '/account/whoami',
    { accessToken: member.accessToken }
  );
  await sendStateEvent(
    HOMESERVER,
    member.accessToken,
    roomId,
    'org.matrix.msc3401.call.member',
    `_${member.userId}_${device}_m.call`,
    {
      application: 'm.call',
      call_id: '',
      scope: 'm.room',
      device_id: device,
      expires: 14_400_000,
      focus_active: { type: 'livekit', focus_selection: 'oldest_membership' },
      foci_preferred: [],
    }
  );
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/org.matrix.msc4075.rtc.notification/ring${tag}`,
    {
      method: 'PUT',
      accessToken: member.accessToken,
      body: JSON.stringify({
        notification_type: 'ring',
        'm.mentions': { user_ids: [reader.userId] },
        sender_ts: Date.now(),
        lifetime: 120_000,
      }),
    }
  );
};

const check = async (page: Page, world: World, label: string) => {
  const { roomId, spaceId, rootId } = world;
  const phone = label.endsWith('phone');
  const main = page.locator('main');

  // The room: its header, the topic viewer, the rename rows and the thread's summary.
  await seedRoomOverviewState({
    page,
    roomId,
    userId: world.reader.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await go(page, roomPath(roomId));
  const header = page.getByRole('banner').filter({ has: page.locator('h1') });
  await expectShown(header.locator('h1'), ROOM_NAME_SHOWN);
  await expectShown(header.getByRole('button', { name: /^Where we file/ }), ROOM_TOPIC_SHOWN);
  await expectShown(
    main.getByText(/changed the room name to/).filter({ hasText: 'sevihcra' }),
    ROOM_NAME_SHOWN
  );
  await expectShown(
    main.getByText(/changed the (room )?topic to/).filter({ hasText: 'stpiecer' }),
    ROOM_TOPIC_SHOWN
  );
  // The summary under the thread's root, and nothing else in the room, shows a control either.
  await expectShown(main.getByText(SUMMARY_SHOWN).first(), SUMMARY_SHOWN);
  expect(await main.textContent()).not.toMatch(CONTROL);
  await shot(page, `${label}-room`);
  await header.getByRole('button', { name: /^Where we file/ }).click();
  const topicViewer = page.getByRole('dialog', { name: ROOM_NAME_SHOWN });
  await expectShown(topicViewer, ROOM_TOPIC_SHOWN);
  await shot(page, `${label}-topic-viewer`);
  await page.keyboard.press('Escape');
  await expect(topicViewer).toBeHidden();

  // An incoming call names the room.
  await ring(world, label);
  const ringCard = page.getByRole('alertdialog', { name: 'Incoming Call' });
  await expectShown(ringCard, `${MEMBER_NAME} is calling in ${ROOM_NAME_SHOWN}`);
  await shot(page, `${label}-incoming-call`);
  await ringCard.getByRole('button', { name: 'Ignore' }).click({ timeout: 30_000 });
  await expect(ringCard).toBeHidden();

  // The thread banner shows the thread's summary.
  await go(page, `${roomPath(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  const summary = page.locator('[data-thread-context-summary]');
  await expectShown(summary, SUMMARY_SHOWN);
  // The thread's own row for the summary describes it too.
  expect(await main.textContent()).not.toMatch(CONTROL);
  await shot(page, `${label}-thread-banner`);

  // The sidebar's thread list, whose tooltip names the room (desktop: a phone shows no tooltips).
  if (!phone) {
    const threadsCategory = page
      .locator('nav [aria-expanded]')
      .filter({ hasText: /^Threads$/i })
      .first();
    if ((await threadsCategory.getAttribute('aria-expanded')) === 'false') {
      await threadsCategory.click();
    }
    const entry = page.getByRole('button', { name: `Open thread: ${SUMMARY_SHOWN}` }).first();
    await expect(entry).toBeVisible({ timeout: 30_000 });
    expect(await entry.getAttribute('aria-label')).toContain(ROOM_NAME_SHOWN);
    expect(await entry.getAttribute('aria-label')).not.toMatch(CONTROL);
    await entry.hover();
    await expectShown(page.getByRole('tooltip').filter({ hasText: 'Room' }), ROOM_NAME_SHOWN);
    await shot(page, `${label}-sidebar-thread`);
    await page.mouse.move(0, 0);
  }

  // Room settings: the dialog's title and the room's name and topic.
  await go(page, roomPath(roomId));
  await header.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
  // A phone opens on the settings' menu, a desktop on the General page with the room's profile.
  const settings = page.getByRole('dialog').last();
  await expectShown(settings, ROOM_NAME_SHOWN);
  if (!phone) await expectShown(settings, ROOM_TOPIC_SHOWN);
  await shot(page, `${label}-room-settings`);
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  // Message search in the room: its name over the results and on the room's chip.
  await go(page, `/home/search/?term=${SEARCH_WORD}&rooms=${encodeURIComponent(roomId)}`);
  await expectShown(
    main
      .locator('h2')
      .filter({ hasText: /^Payroll / })
      .first(),
    ROOM_NAME_SHOWN
  );
  await expectShown(
    main
      .getByRole('button')
      .filter({ hasText: /^Payroll / })
      .first(),
    ROOM_NAME_SHOWN
  );
  await shot(page, `${label}-search`);

  // The command palette: the room, with its topic, and a message in it.
  if (phone) {
    await go(page, '/home/');
    await page.locator('button[aria-keyshortcuts]').first().click();
  } else {
    await pressPaletteShortcut(page);
  }
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill('Payroll');
  const roomOption = palette.getByRole('option').filter({ hasText: 'Payroll' });
  await expectShown(roomOption.first(), ROOM_NAME_SHOWN);
  await expectShown(roomOption.first(), ROOM_TOPIC_SHOWN);
  await palette.getByRole('combobox').fill(SEARCH_WORD);
  await expectShown(
    palette.getByRole('option').filter({ hasText: SEARCH_WORD }).first(),
    ROOM_NAME_SHOWN
  );
  await shot(page, `${label}-palette`);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  // The space: its lobby (name, topic, the room's card), its sidebar and its rail tab.
  await go(page, `/${encodeURIComponent(spaceId)}/lobby/`);
  await expectShown(
    main
      .locator('h2')
      .filter({ hasText: /^Finance / })
      .first(),
    SPACE_NAME_SHOWN
  );
  await expectShown(main.getByText(/^Plans for the /).first(), SPACE_TOPIC_SHOWN);
  await expectShown(main, ROOM_NAME_SHOWN);
  await expectShown(main, ROOM_TOPIC_SHOWN);
  await shot(page, `${label}-lobby`);
  // The rail tab and the space's list. A phone keeps both in its navigation drawer, which leaving
  // the Home list put away: it drops them once it has slid out (320 ms), so a check that comes
  // later finds neither. The phone opens it here, from the closed state the lobby leaves it in.
  if (phone) {
    const menu = page.locator('#phone-nav-menu-button');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  }
  const drawer = page.locator('#phone-nav-drawer');
  const railTab = (phone ? drawer : page.locator('body')).locator(`[data-id="${spaceId}"]`);
  await expectShown(railTab.first(), SPACE_NAME_SHOWN);
  const spaceList = (phone ? drawer : page.locator('nav')).getByText(/^Finance /);
  await expectShown(spaceList.first(), SPACE_NAME_SHOWN);
  await shot(page, `${label}-space-navigation`);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine}-${viewport}`);
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('room names, topics and thread summaries show direction controls as code points (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  await run(browser, baseURL, 'chromium');
});

test('room names, topics and thread summaries show direction controls as code points (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
