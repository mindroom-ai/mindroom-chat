import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
  setAccountData,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A click on a card of a room the person is not in does what the card's button does, never
// nothing and never an error: in a space's lobby (a room the person left while signed in, one
// left before, one never joined, one they were removed from, an invite, a room that takes join
// requests, and a subspace) and in the server's room directory. The space holds 28 rooms; desktop
// (1280 by 800, classic scrollbars) and phone (390 by 844, touch), Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. Set LOBBY_CARD_SHOTS=<directory>
// for screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'lobby-card-click-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.LOBBY_CARD_SHOTS;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const TOPIC = 'Weekly notes and decisions about the next release and who takes which part';
const JOINED = [
  'Announcements',
  'Release planning',
  'Customer onboarding experience redesign',
  'Design reviews',
  'Infrastructure on call',
  'Hiring loop',
  'Quarterly goals',
  'Support escalations',
  'Documentation',
  'Mobile app',
  'Web app',
  'Data pipeline',
  'Security reviews',
  'Billing and invoices',
  'Office logistics',
  'Book club',
  'Running group',
  'Lunch plans',
  'Random',
  'Team room 1',
];
const LEFT_LIVE = 'Garden Club';
const LEFT_BEFORE = 'Harbor Plans';
const NEVER = 'Open Studio';
const KICKED = 'Old Front Desk';
const INVITED = 'Launch party planning for the spring offsite in the mountains';
const KNOCK = 'Review Board';
const SUBSPACE = 'Design Guild';

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
  const username = `lcc_${name}_${RUN}`;
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

type Seed = {
  viewer: Account;
  space: string;
  rooms: Record<string, string>;
  directoryRoom: { id: string; name: string };
};

/** A space of 28 rooms: 20 the viewer is in, the rest each a different way of not being in. */
const seed = async (label: string): Promise<Seed> => {
  const owner = await register(`owner_${label}`);
  const viewer = await register(`viewer_${label}`);
  const space = await createPrivateSpace(HOMESERVER, owner.accessToken, {
    name: 'Field Notes',
    topic: 'Everything the field team shares',
    invite: [viewer.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, space);
  const rooms: Record<string, string> = {};
  const add = async (name: string, joinRule?: Record<string, unknown>, parent = space) => {
    const roomId = await createPrivateRoom(HOMESERVER, owner.accessToken, { name, topic: TOPIC });
    if (joinRule) {
      await sendStateEvent(
        HOMESERVER,
        owner.accessToken,
        roomId,
        'm.room.join_rules',
        '',
        joinRule
      );
    }
    await addRoomToSpace(HOMESERVER, owner.accessToken, parent, roomId);
    rooms[name] = roomId;
    return roomId;
  };
  const publicRule = { join_rule: 'public' };
  for (const name of JOINED) {
    const roomId = await add(name, publicRule);
    await joinRoom(HOMESERVER, viewer.accessToken, roomId);
  }
  await sendRoomMessage(HOMESERVER, owner.accessToken, rooms.Announcements!, {
    msgtype: 'm.text',
    body: 'The draft is ready for another look before Friday.',
  });
  // Left while signed in: the client keeps the room, with the membership "leave".
  await joinRoom(HOMESERVER, viewer.accessToken, await add(LEFT_LIVE, publicRule));
  // Left before signing in, from a room open to the space's members.
  const harbor = await add(LEFT_BEFORE, {
    join_rule: 'restricted',
    allow: [{ type: 'm.room_membership', room_id: space }],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, harbor);
  await post(viewer, roomPath(harbor, 'leave'));
  await add(NEVER, publicRule);
  const kicked = await add(KICKED, publicRule);
  await joinRoom(HOMESERVER, viewer.accessToken, kicked);
  await post(owner, roomPath(kicked, 'kick'), { user_id: viewer.userId, reason: 'Tidying up' });
  const invited = await add(INVITED);
  await post(owner, roomPath(invited, 'invite'), { user_id: viewer.userId });
  await add(KNOCK, { join_rule: 'knock' });
  const guild = await createPrivateSpace(HOMESERVER, owner.accessToken, {
    name: SUBSPACE,
    topic: 'Colors, type and layout',
  });
  await sendStateEvent(HOMESERVER, owner.accessToken, guild, 'm.room.join_rules', '', publicRule);
  await addRoomToSpace(HOMESERVER, owner.accessToken, space, guild);
  rooms[SUBSPACE] = guild;
  await add('Color studies', publicRule, guild);
  // A public room in the server's directory, for Explore.
  const directoryName = label.includes('webkit')
    ? 'Weekend Painting Club'
    : 'Weekend Sketching Club';
  const directoryId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
    name: directoryName,
    topic: 'Bring a pencil and a friend',
  });
  await sendStateEvent(
    HOMESERVER,
    owner.accessToken,
    directoryId,
    'm.room.join_rules',
    '',
    publicRule
  );
  await matrixFetch<unknown>(
    HOMESERVER,
    `/directory/list/room/${encodeURIComponent(directoryId)}`,
    {
      method: 'PUT',
      accessToken: owner.accessToken,
      body: JSON.stringify({ visibility: 'public' }),
    }
  );
  await setAccountData(HOMESERVER, viewer.accessToken, viewer.userId, 'io.mindroom.spaces', {
    sidebar: [space],
  });
  return { viewer, space, rooms, directoryRoom: { id: directoryId, name: directoryName } };
};

const joinedRooms = async (viewer: Account): Promise<string[]> =>
  (
    await matrixFetch<{ joined_rooms: string[] }>(HOMESERVER, '/joined_rooms', {
      accessToken: viewer.accessToken,
    })
  ).joined_rooms;

const expectJoined = (viewer: Account, roomId: string) =>
  expect
    .poll(async () => (await joinedRooms(viewer)).includes(roomId), { timeout: 30_000 })
    .toBe(true);

type Session = { page: Page; seeded: Seed; problems: string[] };

const signIn = async (browser: Browser, label: string, options: BrowserContextOptions) => {
  const seeded = await seed(label);
  const context = await browser.newContext(options);
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // Errors the page throws, and joins the server refused.
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && /\/(join|knock)\//.test(response.url())) {
      problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.viewer.username,
    password: PASSWORD,
  });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  return { page, seeded, problems } satisfies Session;
};

const entry = (page: Page, roomId: string): Locator =>
  page.locator(`main [data-lobby-entry="${roomId}"]`);

const escaped = (value: string) => encodeURIComponent(value).replace(/[!$.]/g, '\\$&');

const openLobby = async ({ page, seeded }: Session, touch: boolean) => {
  await page.goto(`/${encodeURIComponent(seeded.space)}/lobby/`);
  await expect(entry(page, seeded.rooms[KNOCK]!)).toBeVisible({ timeout: 30_000 });
  // The viewer leaves one room from another device while this one is signed in, so the client
  // keeps that room with the membership "leave".
  const garden = entry(page, seeded.rooms[LEFT_LIVE]!);
  await expect(
    touch
      ? garden.getByRole('button', { name: LEFT_LIVE })
      : garden.getByRole('button', { name: 'Open Room' })
  ).toBeVisible();
  await post(seeded.viewer, roomPath(seeded.rooms[LEFT_LIVE]!, 'leave'));
  await expect(garden.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
};

/** Clicks (or taps) the card's topic, away from its button. */
const pressCard = async (page: Page, card: Locator, touch: boolean) => {
  const topic = card.getByText(TOPIC);
  await topic.scrollIntoViewIfNeeded();
  if (touch) await topic.tap();
  else await topic.click();
};

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const checkLobby = async (browser: Browser, label: string, options: BrowserContextOptions) => {
  const touch = !!options.hasTouch;
  const session = await signIn(browser, label, options);
  const { page, seeded, problems } = session;
  const { rooms, viewer } = seeded;
  await openLobby(session, touch);
  await entry(page, rooms[LEFT_LIVE]!).scrollIntoViewIfNeeded();
  await shot(page, `${label}-before`);

  // Each room the viewer is not in joins from a click on its card, as from its Join button.
  for (const name of [LEFT_LIVE, LEFT_BEFORE, NEVER, KICKED, INVITED]) {
    const roomId = rooms[name]!;
    const card = entry(page, roomId);
    await expect(card.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await pressCard(page, card, touch);
    await expectJoined(viewer, roomId);
    await expect(card.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);
    if (touch) {
      // On a phone the joined card is one button named by the room.
      await expect(card.getByRole('button', { name })).toBeVisible();
    } else {
      await expect(card.getByRole('button', { name: 'Open Room' })).toBeVisible();
    }
    await expect(page).toHaveURL(/\/lobby\/?$/);
  }
  await entry(page, rooms[LEFT_LIVE]!).scrollIntoViewIfNeeded();
  await shot(page, `${label}-after`);

  // A room that takes requests opens the request, as Request to join does.
  const knock = entry(page, rooms[KNOCK]!);
  await pressCard(page, knock, touch);
  const request = page.getByRole('dialog', { name: `Request to join ${KNOCK}` });
  await expect(request).toBeVisible();
  await shot(page, `${label}-request`);
  await request.getByRole('button', { name: 'Cancel' }).click();
  await expect(request).toHaveCount(0);

  // A subspace joins from a click on its name, as its Join chip does.
  const guild = entry(page, rooms[SUBSPACE]!);
  await guild.getByText(SUBSPACE, { exact: true }).scrollIntoViewIfNeeded();
  await expect(guild.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
  if (touch) await guild.getByText(SUBSPACE, { exact: true }).tap();
  else await guild.getByText(SUBSPACE, { exact: true }).click();
  await expectJoined(viewer, rooms[SUBSPACE]!);
  await expect(guild.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);

  // On a phone a joined card then opens its room with the next tap.
  if (touch) {
    await pressCard(page, entry(page, rooms[LEFT_LIVE]!), touch);
    await expect(page).toHaveURL(new RegExp(`/${escaped(rooms[LEFT_LIVE]!)}/?$`));
  }
  expect(problems).toEqual([]);
  await page.context().close();
};

const checkExplore = async (browser: Browser, label: string) => {
  const session = await signIn(browser, label, DESKTOP);
  const { page, seeded, problems } = session;
  const server = seeded.viewer.userId.split(':').slice(1).join(':');
  const { id, name } = seeded.directoryRoom;
  await page.goto(`/explore/${encodeURIComponent(server)}/?term=${encodeURIComponent(name)}`);
  // The search finds this one room, so the page has one card and one Join button.
  const join = page.locator('main').getByRole('button', { name: 'Join', exact: true });
  await expect(join).toHaveCount(1, { timeout: 30_000 });
  await shot(page, `${label}-explore-before`);
  await page.locator('main').getByText(name, { exact: true }).click();
  await expectJoined(seeded.viewer, id);
  await expect(page.locator('main').getByRole('button', { name: 'View' })).toBeVisible();
  await expect(join).toHaveCount(0);
  await shot(page, `${label}-explore-after`);
  expect(problems).toEqual([]);
  await page.context().close();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  test.setTimeout(240_000);
});

test('a desktop lobby card of a room the person is not in joins it, as its button does', async ({
  browser,
}) => {
  await checkLobby(browser, 'chromium-desktop', DESKTOP);
});

test('a phone lobby card of a room the person is not in joins it with a tap', async ({
  browser,
}) => {
  await checkLobby(browser, 'chromium-phone', PHONE);
});

test('an Explore card of a room the person is not in joins it, as its button does', async ({
  browser,
}) => {
  await checkExplore(browser, 'chromium-explore');
});

test.describe('WebKit', () => {
  test.beforeEach(() => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  });
  const inWebKit = async (check: (browser: Browser) => Promise<void>) => {
    const browser = await launchWebKit();
    try {
      await check(browser);
    } finally {
      await browser.close();
    }
  };
  test('desktop lobby cards', () =>
    inWebKit((browser) => checkLobby(browser, 'webkit-desktop', DESKTOP)));
  test('phone lobby cards', () =>
    inWebKit((browser) => checkLobby(browser, 'webkit-phone', PHONE)));
  test('Explore cards', () => inWebKit((browser) => checkExplore(browser, 'webkit-explore')));
});
