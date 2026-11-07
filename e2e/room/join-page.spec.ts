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
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// The page a room link opens when the person is not in the room. A room left on another device
// just as the app starts keeps its name there. A join the server refuses says why, there and on
// a space lobby's card. A person banned from the room reads that they are, who banned them and
// why, whether this device knew the room or not. On a phone, where the page fills the screen,
// a back button leads to where the person came from, or to the list the page belongs to. The person has 25 other rooms; desktop (1280 by
// 800, classic scrollbars) and phone (390 by 844, touch), light and dark, Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. Set JOIN_PAGE_SHOTS=<directory>
// for screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'join-page-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.JOIN_PAGE_SHOTS;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const TOPIC = 'Measurements from the north face, and who walks which section next week';
const LEFT_AT_START = 'Quarry survey';
const LINKED = 'Open studio';
const LOBBY_ROOM = 'Garden club';
const BANNED_BEFORE = 'Old front desk';
const BANNED_LIVE = 'Night shift';
const BAN_REASON = 'Repeated off-topic posts in the handover thread';
/** What the app says for the server's 403, and the start of the server's own words. */
const REFUSED = "You don't have permission to do this.";

test.use({
  launchOptions: {
    // Classic scrollbars, as desktop browsers show them. The other options repeat
    // playwright.config.ts.
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

const register = async (name: string) => {
  const username = `jp_${name}_${RUN}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

type Account = Awaited<ReturnType<typeof register>>;

const post = (account: Account, path: string, body: Record<string, unknown> = {}) =>
  matrixFetch<unknown>(HOMESERVER, path, {
    method: 'POST',
    accessToken: account.accessToken,
    body: JSON.stringify(body),
  });

const roomPath = (roomId: string, action: string) =>
  `/rooms/${encodeURIComponent(roomId)}/${action}`;

/** An owner, and a viewer with 25 rooms of their own. */
const seedAccounts = async (label: string) => {
  const owner = await register(`owner_${label}`);
  const viewer = await register(`viewer_${label}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, viewer.accessToken, { name: `Team room ${index + 1}` })
    )
  );
  return { owner, viewer };
};

/** A room only invited people may join, which `member` is in, with a message from the owner. */
const inviteOnlyRoom = async (owner: Account, member: Account, name: string) => {
  const roomId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
    name,
    topic: TOPIC,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await sendRoomMessage(HOMESERVER, owner.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The north face readings are in the shared sheet; the east face is next.',
  });
  return roomId;
};

/** A room anyone may join, with a topic and a message from the owner. */
const publicRoom = async (owner: Account, name: string) => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: owner.accessToken,
    body: JSON.stringify({ name, topic: TOPIC, preset: 'public_chat' }),
  });
  await sendRoomMessage(HOMESERVER, owner.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Open evening on Thursday; bring a sketchbook.',
  });
  return roomId;
};

/** From now on only invited people may join the room. */
const closeRoom = (owner: Account, roomId: string) =>
  sendStateEvent(HOMESERVER, owner.accessToken, roomId, 'm.room.join_rules', '', {
    join_rule: 'invite',
  });

const signIn = async (browser: Browser, viewer: Account, options: BrowserContextOptions) => {
  // The service worker would take requests out of the page's routes (WebKit).
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => {
    // WebKit reports requests a reload or navigation cuts off ("Fetch API cannot load ... due
    // to access control checks."), also when the app handles the failure; those are not the app's.
    if (!/due to access control checks\.$/.test(error.message)) {
      problems.push(`page error: ${error.message}`);
    }
  });
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  return { page, problems };
};

/** Saves the page in light and dark, with `name` in the file names. */
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

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, to: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, to);

/**
 * A room left on another device just as the app starts: the start's check of the joined rooms
 * no longer lists it, and its leave reaches this device by sync a moment later. The page the room's
 * link opens still names it, from the state the device kept, and offers to forget it. The check
 * asks /sync about the rooms the answer misses with a filter of its own, written out in the
 * request; only the client's sync, by its stored filter, is held back, so the check must find the
 * leave in its own answer.
 */
const checkLeftAtStart = async (
  browser: Browser,
  label: string,
  options: BrowserContextOptions
) => {
  const { owner, viewer } = await seedAccounts(label);
  const roomId = await inviteOnlyRoom(owner, viewer, LEFT_AT_START);
  const { page, problems } = await signIn(browser, viewer, options);
  await expect(page.getByText(LEFT_AT_START).first()).toBeVisible();

  let release = () => undefined as void;
  let held: Promise<void> | undefined;
  await page.route(
    (url) => url.pathname.endsWith('/v3/joined_rooms'),
    async (route) => {
      if (!held) {
        held = new Promise((resolve) => {
          release = resolve;
        });
        await post(viewer, roomPath(roomId, 'leave'));
      }
      await route.fulfill({ response: await route.fetch() });
      // The answer arrives well before the leave does through sync.
      setTimeout(() => release(), 2_000);
    }
  );
  await page.route(
    (url) => url.pathname.endsWith('/v3/sync') && !url.searchParams.get('filter')?.startsWith('{'),
    async (route) => {
      try {
        // A long poll may take its full 30 seconds.
        const response = await route.fetch({ timeout: 0 });
        if (held) await held;
        await route.fulfill({ response });
      } catch {
        // The page closed while the long poll waited.
        await route.abort().catch(() => undefined);
      }
    }
  );
  await page.goto('/home/');
  await expect.poll(() => held !== undefined, { timeout: 30_000 }).toBe(true);
  // Long enough for the leave and the batches after it to arrive.
  await page.waitForTimeout(4_000);
  await openPath(page, `/home/${encodeURIComponent(roomId)}/`);
  const main = page.locator('main');
  await expect(main.getByRole('button', { name: 'Forget Room' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(main.getByText(LEFT_AT_START, { exact: true }).first()).toBeVisible();
  await expect(main.getByText('Empty room')).toHaveCount(0);
  await shots(page, `${label}-left-at-start`);
  expect(problems).toEqual([]);
  await page.context().close();
};

/**
 * The room closes to invited people after its page or card showed Join: the server refuses the
 * join, and the page and the card say so, with the server's words, and keep Join for another try.
 */
const checkRefusedJoin = async (
  browser: Browser,
  label: string,
  options: BrowserContextOptions
) => {
  const touch = !!options.hasTouch;
  const { owner, viewer } = await seedAccounts(label);
  const space = await createPrivateSpace(HOMESERVER, owner.accessToken, {
    name: 'Field notes',
    topic: 'Everything the field team shares',
    invite: [viewer.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, space);
  const lobbyRoom = await publicRoom(owner, LOBBY_ROOM);
  await addRoomToSpace(HOMESERVER, owner.accessToken, space, lobbyRoom);
  const linked = await publicRoom(owner, LINKED);
  const { page, problems } = await signIn(browser, viewer, options);
  const main = page.locator('main');
  const press = async (name: string, scope = main) => {
    const button = scope.getByRole('button', { name, exact: true });
    if (touch) await button.tap();
    else await button.click();
  };

  // The page a link to the room opens.
  await openPath(page, `/home/${encodeURIComponent(linked)}/`);
  await expect(main.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
  await closeRoom(owner, linked);
  await press('Join');
  const pageAlert = main.getByRole('alert');
  await expect(pageAlert).toContainText(REFUSED);
  await expect(pageAlert).toContainText('M_FORBIDDEN');
  await expect(main.getByRole('button', { name: 'Join', exact: true })).toBeEnabled();
  await shots(page, `${label}-page-refused`);

  // A card in the space's lobby.
  await openPath(page, `/${encodeURIComponent(space)}/lobby/`);
  const card = main.locator(`[data-lobby-entry="${lobbyRoom}"]`);
  await expect(card.getByRole('button', { name: 'Join', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await closeRoom(owner, lobbyRoom);
  await press('Join', card);
  const cardAlert = card.getByRole('alert');
  await expect(cardAlert).toContainText(REFUSED);
  await expect(cardAlert).toContainText('M_FORBIDDEN');
  await expect(card.getByRole('button', { name: 'Join', exact: true })).toBeEnabled();
  // The alert stays inside the card, under the room's name.
  const [cardBox, alertBox] = await Promise.all([card.boundingBox(), cardAlert.boundingBox()]);
  expect(alertBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
  expect(alertBox!.x + alertBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5);
  expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 0.5);
  await card.scrollIntoViewIfNeeded();
  await shots(page, `${label}-lobby-refused`);
  expect(problems).toEqual([]);
  await page.context().close();
};

/**
 * The person was banned from one room before signing in on this device, which never learns of
 * that room, and from another while signed in, which this device keeps as banned. Each room's
 * page says so, names who banned them and gives the reason, and offers no Join.
 */
const checkBanned = async (browser: Browser, label: string, options: BrowserContextOptions) => {
  const { owner, viewer } = await seedAccounts(label);
  const ban = (roomId: string) =>
    post(owner, roomPath(roomId, 'ban'), { user_id: viewer.userId, reason: BAN_REASON });
  const before = await publicRoom(owner, BANNED_BEFORE);
  await joinRoom(HOMESERVER, viewer.accessToken, before);
  await ban(before);
  const live = await publicRoom(owner, BANNED_LIVE);
  await joinRoom(HOMESERVER, viewer.accessToken, live);
  const { page, problems } = await signIn(browser, viewer, options);
  const main = page.locator('main');
  await openPath(page, `/home/${encodeURIComponent(live)}/`);
  await expect(main.getByText('Open evening on Thursday; bring a sketchbook.')).toBeVisible();
  await ban(live);
  for (const [roomId, name] of [
    [before, BANNED_BEFORE],
    [live, BANNED_LIVE],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    await openPath(page, `/home/${encodeURIComponent(roomId)}/`);
    // eslint-disable-next-line no-await-in-loop
    await expect(main.getByText('You are banned from this room.')).toBeVisible({
      timeout: 30_000,
    });
    // eslint-disable-next-line no-await-in-loop
    await expect(main.getByText(name, { exact: true }).first()).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    await expect(main.getByText(`Reason: ${BAN_REASON}`)).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    await expect(main.getByText(new RegExp(`^Banned by: .*${owner.username}`))).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    await expect(main.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);
    // eslint-disable-next-line no-await-in-loop
    await shots(page, `${label}-banned-${roomId === before ? 'before' : 'live'}`);
  }
  expect(problems).toEqual([]);
  await page.context().close();
};

/**
 * A phone shows the room's page alone. Its back button returns to the page it was opened from;
 * opened from outside the app, it leads to the list the page sits in (Home, or the space).
 */
const checkPhoneBack = async (browser: Browser, label: string) => {
  const { owner, viewer } = await seedAccounts(label);
  const linked = await publicRoom(owner, LINKED);
  const space = await createPrivateSpace(HOMESERVER, owner.accessToken, {
    name: 'Field notes',
    topic: 'Everything the field team shares',
    invite: [viewer.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, space);
  const spaceRoom = await publicRoom(owner, LOBBY_ROOM);
  await addRoomToSpace(HOMESERVER, owner.accessToken, space, spaceRoom);
  const { page, problems } = await signIn(browser, viewer, PHONE);
  const main = page.locator('main');
  const join = main.getByRole('button', { name: 'Join', exact: true });
  const back = main.getByRole('button', { name: 'Back', exact: true });
  // The path without its trailing slash, which a space's path does not carry.
  const path = () => decodeURIComponent(new URL(page.url()).pathname).replace(/\/$/, '');

  // Opened from the Home list: back returns to it.
  await page.goto('/home/');
  await expect(page.getByText('Team room 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await openPath(page, `/home/${encodeURIComponent(linked)}/`);
  await expect(join).toBeVisible();
  await expect(back).toBeVisible();
  const header = await back.boundingBox();
  // In the page's header, at its start.
  expect(header!.x).toBeLessThan(40);
  expect(header!.y).toBeLessThan(80);
  await shots(page, `${label}-back`);
  await back.tap();
  await expect.poll(path).toBe('/home');
  await expect(join).toHaveCount(0);

  // Opened from outside the app: back leads to the Home list.
  await page.goto(`/home/${encodeURIComponent(linked)}/`);
  await expect(join).toBeVisible({ timeout: 30_000 });
  await back.tap();
  await expect.poll(path).toBe('/home');
  await expect(page.getByText('Team room 1', { exact: true })).toBeVisible();

  // A room of a space, opened from outside the app: back leads to the space's list.
  await page.goto(`/${encodeURIComponent(space)}/${encodeURIComponent(spaceRoom)}/`);
  await expect(join).toBeVisible({ timeout: 30_000 });
  await back.tap();
  await expect.poll(path).toBe(`/${space}`);
  // The space's own page: its list out in the drawer over the lobby, whose cards offer Join.
  await expect(page.getByTestId('resizable-page-nav')).toBeVisible();
  await expect(main.locator('[data-lobby-entry]').first()).toBeAttached();
  expect(problems).toEqual([]);
  await page.context().close();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  test.setTimeout(240_000);
});

test('a room left elsewhere as the app starts keeps its name on its page (Chromium)', async ({
  browser,
}) => {
  await checkLeftAtStart(browser, 'left-chromium-desktop', DESKTOP);
});

test('a room left elsewhere as the app starts keeps its name on its page (WebKit phone)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    await checkLeftAtStart(browser, 'left-webkit-phone', PHONE);
  } finally {
    await browser.close();
  }
});

for (const [device, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`a refused join says why on the room's page and its lobby card (Chromium ${device})`, async ({
    browser,
  }) => {
    await checkRefusedJoin(browser, `refused-chromium-${device}`, options);
  });

  test(`a refused join says why on the room's page and its lobby card (WebKit ${device})`, async () => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    const browser = await launchWebKit();
    try {
      await checkRefusedJoin(browser, `refused-webkit-${device}`, options);
    } finally {
      await browser.close();
    }
  });
}

test('a banned person reads who banned them and why on the room page (Chromium desktop)', async ({
  browser,
}) => {
  await checkBanned(browser, 'banned-chromium-desktop', DESKTOP);
});

test('a banned person reads who banned them and why on the room page (WebKit phone)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    await checkBanned(browser, 'banned-webkit-phone', PHONE);
  } finally {
    await browser.close();
  }
});

test("a phone's room page leads back (Chromium)", async ({ browser }) => {
  await checkPhoneBack(browser, 'back-chromium-phone');
});

test("a phone's room page leads back (WebKit)", async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    await checkPhoneBack(browser, 'back-webkit-phone');
  } finally {
    await browser.close();
  }
});
