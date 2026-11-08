import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C) change the
// order text shows in without showing themselves: a room named `Payroll <U+202E>sevihcra<U+202C>`
// reads as "Payroll archives". More places that name a room show each control as its code point:
// the start of the timeline, the call panel of a call someone else is in (no call service needed),
// a room mention and a link to a message, the drop overlay, an invite in the Inbox, the Join a Room
// dialog's directory rows, the page of a room the reader has not joined, and the Canvases page.
// Then in Arabic, where the name sits inside a translated sentence: the header, the call panel,
// the drop overlay, the invite and the join page. Against the disposable homeserver of a slot, on
// a phone (390 by 844, touch) and a desktop (1280 by 800), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// DIRECTION_PLACES_SHOTS=<directory> to save each view.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'direction-places-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DIRECTION_PLACES_SHOTS;
const FILLER_ROOMS = 24;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;
// What a translation puts around a name it holds: a first-strong isolate and its end.
const TRANSLATION_ISOLATES = /[⁨⁩]/g;

const ROOM_NAME = 'Payroll ‮sevihcra‬';
const ROOM_NAME_SHOWN = 'Payroll <U+202E>sevihcra<U+202C>';
const ROOM_TOPIC = 'Where we file ‮stpiecer‬ for the audit';
const ROOM_TOPIC_SHOWN = 'Where we file <U+202E>stpiecer<U+202C> for the audit';
const LINKED_NAME = 'Ledger ‮seton‬';
const LINKED_NAME_SHOWN = 'Ledger <U+202E>seton<U+202C>';
const INVITE_NAME = 'Invoice ⁧tfard⁩ review';
const INVITE_NAME_SHOWN = 'Invoice <U+2067>tfard<U+2069> review';
const INVITE_TOPIC = 'Sign off ‮sesnepxe‬ by Monday';
const INVITE_TOPIC_SHOWN = 'Sign off <U+202E>sesnepxe<U+202C> by Monday';
const PUBLIC_NAME = `Garden ${RUN} ‮bulc‬`;
const PUBLIC_NAME_SHOWN = `Garden ${RUN} <U+202E>bulc<U+202C>`;
const PUBLIC_TOPIC = 'Seeds and ‮spaws‬ for everyone';
const PUBLIC_TOPIC_SHOWN = 'Seeds and <U+202E>spaws<U+202C> for everyone';
const CANVAS_TITLE = 'Quarter close checklist';

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

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string, displayName: string): Promise<Account> => {
  const username = `${name}_${RUN}`;
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
  roomId: string;
  linkedId: string;
  publicId: string;
};

/**
 * The reader's room with a member and an agent, among 24 other rooms, short enough that the
 * timeline reaches its start: a member in a call, a message linking another room and one of its
 * messages, and the agent's canvas. The member invites the reader to a third room, and lists a
 * fourth in the server's directory.
 */
const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`bidiplaces_reader_${engine}`, 'Robin Reader');
  const member = await registerAndLogin(`bidiplaces_member_${engine}`, 'Avery Quinn');
  const agent = await registerAndLogin(`mindroom_planner_bidiplaces_${engine}`, 'Planner');
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Ledger room ${index}` });
  const linkedId = await createRoom(HOMESERVER, reader.accessToken, { name: LINKED_NAME });
  const linkedEventId = await sendRoomMessage(HOMESERVER, reader.accessToken, linkedId, {
    msgtype: 'm.text',
    body: 'The March ledger is closed.',
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId, agent.userId],
  });
  await sendStateEvent(HOMESERVER, reader.accessToken, roomId, 'm.room.topic', '', {
    topic: ROOM_TOPIC,
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
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
  const linkedUrl = `https://matrix.to/#/${linkedId}`;
  await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    // Plain text: each link becomes a pill that names the room.
    body: `Totals are in ${linkedUrl} and the note is ${linkedUrl}/${linkedEventId}`,
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.notice',
    body: `Interactive panel: ${CANVAS_TITLE}.`,
    'io.mindroom.ui_action': {
      version: 1,
      action: 'show_canvas',
      requester_id: reader.userId,
      agent_user_id: agent.userId,
      room_id: roomId,
      thread_id: null,
      canvas: { title: CANVAS_TITLE, html: `<h1>${CANVAS_TITLE}</h1>` },
    },
  });
  // The member is in a call in the room, as another client leaves it while the call runs.
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
  const invited = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: member.accessToken,
    body: JSON.stringify({
      preset: 'private_chat',
      name: INVITE_NAME,
      topic: INVITE_TOPIC,
      invite: [reader.userId],
    }),
  });
  expect(invited.room_id).toBeTruthy();
  const listed = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: member.accessToken,
    body: JSON.stringify({
      preset: 'public_chat',
      visibility: 'public',
      name: PUBLIC_NAME,
      topic: PUBLIC_TOPIC,
    }),
  });
  return { reader, roomId, linkedId, publicId: listed.room_id };
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/**
 * The scope shows `shown` and holds no control character, apart from the isolates a translation
 * puts around a name in a sentence.
 */
const expectShown = async (scope: Locator, shown: string) => {
  await expect(scope).toContainText(shown, { timeout: 30_000 });
  const text = (await scope.textContent()) ?? '';
  expect(text.replace(TRANSLATION_ISOLATES, '')).not.toMatch(CONTROL);
};

/** Moves within the app, as a link would. */
const go = (page: Page, route: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);

const roomPath = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;

/** Drags a file over the room, or (`leave`) takes it away again, as a file manager would. */
const drag = (area: Locator, leave = false) =>
  area.evaluate((element, away) => {
    const data = new DataTransfer();
    data.items.add(new File(['month,total\n'], 'totals.csv', { type: 'text/csv' }));
    for (const type of away ? ['dragleave'] : ['dragenter', 'dragover'])
      element.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
      );
  }, leave);

const openRoom = async (page: Page, world: World) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await go(page, roomPath(world.roomId));
  const header = page.getByRole('banner').filter({ has: page.locator('h1') });
  await expectShown(header.locator('h1'), ROOM_NAME_SHOWN);
};

/** The call panel of the member's call: its name, as its heading and its accessible name. */
const checkCallPanel = async (page: Page, label: string) => {
  await page.locator('[data-room-call-button]').first().click();
  const panel = page.getByTestId('call-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expectShown(panel.locator('h2'), ROOM_NAME_SHOWN);
  expect(await panel.getAttribute('aria-label')).toBe(ROOM_NAME_SHOWN);
  await shot(page, `${label}-call-panel`);
  await panel.locator('header button').last().click();
  await expect(panel).toBeHidden();
};

/** The drop overlay names the room while a file is dragged over it. */
const checkDropOverlay = async (page: Page, label: string) => {
  const area = page.locator('[data-room-footer]');
  await drag(area);
  const overlay = area.getByRole('status').filter({ hasText: 'Payroll' });
  await expectShown(overlay, ROOM_NAME_SHOWN);
  await shot(page, `${label}-drop-overlay`);
  await drag(area, true);
  await expect(overlay).toBeHidden();
};

/** The Inbox's invite names the room and its topic. */
const checkInvite = async (page: Page, label: string) => {
  await go(page, '/inbox/invites/');
  const card = page
    .locator('main')
    .getByText(/^Invoice /)
    .first();
  await expectShown(card, INVITE_NAME_SHOWN);
  // Only the room's own lines: the card puts the inviter's ID in a left-to-right isolate of its own.
  await expectShown(
    page
      .locator('main')
      .getByText(/^Sign off /)
      .first(),
    INVITE_TOPIC_SHOWN
  );
  await shot(page, `${label}-invite`);
};

/** The page of the listed room, which the reader has not joined: its header and its card. */
const checkJoinPage = async (page: Page, world: World, label: string) => {
  await go(page, roomPath(world.publicId));
  const main = page.locator('main');
  await expectShown(main.locator('h1').first(), PUBLIC_NAME_SHOWN);
  await expectShown(main.getByText(/^Seeds and /).first(), PUBLIC_TOPIC_SHOWN);
  await shot(page, `${label}-join-page`);
};

const checkEnglish = async (page: Page, world: World, label: string) => {
  const phone = label.endsWith('phone');
  await openRoom(page, world);

  // The start of the timeline names the room and shows its topic. The view opens at the newest
  // message; scrolled to the top, it reaches the room's start.
  const inner = page.getByTestId('room-virtual-inner');
  const timeline = inner.locator('xpath=..');
  const intro = page.locator('[data-room-intro]');
  await expect
    .poll(
      async () => {
        if ((await intro.count()) > 0) return true;
        await inner.evaluate((element) => {
          let scroller = element.parentElement;
          while (scroller && scroller.scrollHeight <= scroller.clientHeight)
            scroller = scroller.parentElement;
          if (scroller) scroller.scrollTop = 0;
        });
        return false;
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  await intro.scrollIntoViewIfNeeded();
  await expect(intro).toBeVisible();
  await expectShown(intro, ROOM_NAME_SHOWN);
  await expectShown(intro, ROOM_TOPIC_SHOWN);
  await shot(page, `${label}-timeline-start`);
  // A mention of the other room, and a link to one of its messages.
  const mention = timeline.locator(`[data-mention-id="${world.linkedId}"]`);
  await expect(mention).toHaveCount(2);
  await mention.nth(1).scrollIntoViewIfNeeded();
  await expect(mention.nth(1)).toBeVisible();
  await expectShown(mention.first(), `#${LINKED_NAME_SHOWN}`);
  await expectShown(mention.nth(1), `Message in #${LINKED_NAME_SHOWN}`);
  expect(await timeline.textContent()).not.toMatch(CONTROL);
  await shot(page, `${label}-mentions`);

  await checkCallPanel(page, label);
  await checkDropOverlay(page, label);
  await checkInvite(page, label);

  // The Join a Room dialog lists the room in the directory.
  await go(page, '/home/');
  if (phone) {
    const menu = page.locator('#phone-nav-menu-button');
    if ((await menu.getAttribute('aria-expanded')) === 'false') await menu.click();
  }
  await page.locator('[data-home-room-action="join"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Join a Room' });
  await dialog.getByRole('searchbox').fill(RUN);
  const listedRow = dialog.locator('[data-join-room]').filter({ hasText: RUN });
  await expectShown(listedRow.first(), PUBLIC_NAME_SHOWN);
  await expectShown(listedRow.first(), PUBLIC_TOPIC_SHOWN);
  await shot(page, `${label}-join-dialog`);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await checkJoinPage(page, world, label);

  // The Canvases page names the room of the agent's canvas.
  await go(page, '/canvases/');
  const canvases = page.getByTestId('canvases-view');
  const canvasRow = canvases.locator('tbody tr').filter({ hasText: CANVAS_TITLE });
  await expectShown(canvasRow.first(), ROOM_NAME_SHOWN);
  await shot(page, `${label}-canvases`);
};

const checkArabic = async (page: Page, world: World, label: string) => {
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'ar'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 60_000 });
  await openRoom(page, world);
  await checkCallPanel(page, `${label}-ar`);
  // The overlay's sentence holds the name between the translation's isolates.
  const area = page.locator('[data-room-footer]');
  await drag(area);
  const overlay = area.getByRole('status').filter({ hasText: 'Payroll' });
  await expectShown(overlay, `⁨${ROOM_NAME_SHOWN}⁩`);
  await shot(page, `${label}-ar-drop-overlay`);
  await drag(area, true);
  await expect(overlay).toBeHidden();
  await go(page, '/inbox/invites/');
  await expectShown(
    page
      .locator('main')
      .getByText(/^Invoice /)
      .first(),
    INVITE_NAME_SHOWN
  );
  await shot(page, `${label}-ar-invite`);
  await checkJoinPage(page, world, `${label}-ar`);
};

/** The app's runtime config with canvases on. */
const enableCanvases = (context: BrowserContext) =>
  context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as { mindroom?: Record<string, unknown> };
    await route.fulfill({
      json: { ...config, mindroom: { ...config.mindroom, canvas: { enabled: true } } },
    });
  });

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      await enableCanvases(context);
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      const label = `${engine}-${viewport}`;
      await checkEnglish(page, world, label);
      await checkArabic(page, world, label);
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('more places that name a room show direction controls as code points (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  await run(browser, baseURL, 'chromium');
});

test('more places that name a room show direction controls as code points (WebKit)', async ({
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
