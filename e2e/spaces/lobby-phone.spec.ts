import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
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
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A space's lobby on a phone (390 by 844, touch): a tap anywhere on a room's card opens the room,
// with no separate Open Room button; a room the person is not in keeps its Join button, which a
// tap anywhere on its card presses. The room's back chevron then returns to the lobby, where the
// person came from, while rooms opened from the list, the command palette or a link still go back
// to the list. Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit;
// English and Arabic. Set LOBBY_PHONE_SHOTS=<directory> for screenshots.
const PASSWORD = 'lobby-phone-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.LOBBY_PHONE_SHOTS;
const SPACE_NAME = 'Field Notes';
const LONG_ROOM = 'Quarterly planning for the customer onboarding experience redesign';
const JOINED = ['Harbor Plans', 'Garden Club', LONG_ROOM, 'Team room 1', 'Team room 2'];
const PUBLIC_ROOM = 'Open Studio';
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const register = async (name: string) => {
  const username = `lbp_${name}_${RUN}`;
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

type Seed = { username: string; space: string; rooms: Record<string, string> };
const seeds = new Map<string, Promise<Seed>>();

/** One account per engine: an owner's space with five rooms the viewer is in and one it is not. */
const seed = async (engine: string): Promise<Seed> => {
  const owner = await register(`owner_${engine}`);
  const viewer = await register(`viewer_${engine}`);
  const space = await createPrivateSpace(HOMESERVER, owner.accessToken, {
    name: SPACE_NAME,
    topic: '',
    invite: [viewer.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, space);
  const rooms: Record<string, string> = {};
  for (const name of JOINED) {
    const roomId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
      name,
      topic: 'Weekly notes and decisions about the next release and who takes which part',
      invite: [viewer.userId],
    });
    await addRoomToSpace(HOMESERVER, owner.accessToken, space, roomId);
    await joinRoom(HOMESERVER, viewer.accessToken, roomId);
    await sendRoomMessage(HOMESERVER, owner.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'The draft is ready for another look before Friday.',
    });
    rooms[name] = roomId;
  }
  const open = await createPrivateRoom(HOMESERVER, owner.accessToken, {
    name: PUBLIC_ROOM,
    topic: 'Anyone may drop in',
  });
  await sendStateEvent(HOMESERVER, owner.accessToken, open, 'm.room.join_rules', '', {
    join_rule: 'public',
  });
  await addRoomToSpace(HOMESERVER, owner.accessToken, space, open);
  rooms[PUBLIC_ROOM] = open;
  await setAccountData(HOMESERVER, viewer.accessToken, viewer.userId, 'io.mindroom.spaces', {
    sidebar: [space],
  });
  return { username: viewer.username, space, rooms };
};

const signIn = async (browser: Browser, engine: string, options = PHONE, language?: string) => {
  // Each language has accounts of its own: a tap in one run joins the room that the next taps.
  const key = language ? `${engine}_${language}` : engine;
  if (!seeds.has(key)) seeds.set(key, seed(key));
  const seeded = await seeds.get(key)!;
  const context = await browser.newContext(options);
  // A missing control fails its step quickly instead of the whole test's timeout.
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  if (language) {
    await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  }
  await page.goto('/home/');
  await expect(page.locator(`[data-id="${seeded.space}"]`).first()).toBeVisible({
    timeout: 30_000,
  });
  return { context, page, seeded };
};

const escaped = (value: string) => encodeURIComponent(value).replace(/[!$.]/g, '\\$&');
const spaceListPath = (space: string) => new RegExp(`/${escaped(space)}/?$`);
const lobbyPath = (space: string) => new RegExp(`/${escaped(space)}/lobby/?$`);
const roomPath = (room: string) => new RegExp(`/${escaped(room)}/?$`);

const card = (page: Page, name: string) =>
  page.locator('main [data-lobby-entry]').filter({ hasText: name });
const back = (page: Page) => page.getByRole('button', { name: /^(Back|رجوع)$/ });

/** Opens the space's list from the rail, then its lobby from the list's Lobby row. */
const openLobby = async (page: Page, space: string) => {
  await page.locator(`[data-id="${space}"]`).first().tap();
  await expect(page).toHaveURL(spaceListPath(space));
  await page.getByTestId('resizable-page-nav').locator('a[href*="/lobby"]').tap();
  await expect(page).toHaveURL(lobbyPath(space));
  await expect(card(page, 'Harbor Plans')).toBeVisible({ timeout: 30_000 });
};

const checkCards = async (browser: Browser, engine: string, language?: string) => {
  const { context, page, seeded } = await signIn(browser, engine, PHONE, language);
  await openLobby(page, seeded.space);
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/lobby-phone-${engine}-${language ?? 'en'}.png` });
  }

  // No Open Room button on any card; a room the person is not in keeps its Join button.
  const harbor = card(page, 'Harbor Plans');
  await expect(harbor.locator('[data-room-id]')).toHaveCount(0);
  await expect(card(page, PUBLIC_ROOM).getByRole('button').first()).toBeVisible();
  // A tap on the card's topic, away from its name, opens the room.
  await harbor.getByText('Weekly notes and decisions', { exact: false }).tap();
  await expect(page).toHaveURL(roomPath(seeded.rooms['Harbor Plans']!));

  // The room's back chevron returns to the lobby.
  await back(page).tap();
  await expect(page).toHaveURL(lobbyPath(seeded.space));

  // A tap on a room the person is not in joins it, as its Join button does, and stays here; the
  // joined card is then one button named by the room.
  const open = card(page, PUBLIC_ROOM);
  await open.getByText('Anyone may drop in').tap();
  await expect(open.getByRole('button', { name: PUBLIC_ROOM })).toBeVisible();
  await expect(open.getByRole('button', { name: /^(Join|انضمام)$/ })).toHaveCount(0);
  await expect(page).toHaveURL(lobbyPath(seeded.space));
  await context.close();
};

const checkKeyboard = async (browser: Browser, engine: string) => {
  const { context, page, seeded } = await signIn(browser, engine);
  await openLobby(page, seeded.space);
  // The card's open control takes focus by Tab and opens the room with Enter.
  const control = card(page, 'Garden Club').getByRole('button', { name: 'Garden Club' });
  await card(page, 'Harbor Plans').getByRole('button', { name: 'Harbor Plans' }).focus();
  for (let step = 0; step < 6; step += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(roomPath(seeded.rooms['Garden Club']!));
  await context.close();
};

const checkBackPaths = async (browser: Browser, engine: string) => {
  const { context, page, seeded } = await signIn(browser, engine);
  const { space, rooms } = seeded;

  // Lobby, room, back to the lobby, back to the list, then the browser's back leaves the list.
  await openLobby(page, space);
  await card(page, LONG_ROOM).tap();
  await expect(page).toHaveURL(roomPath(rooms[LONG_ROOM]!));
  await back(page).tap();
  await expect(page).toHaveURL(lobbyPath(space));
  await back(page).tap();
  await expect(page).toHaveURL(spaceListPath(space));
  await page.goBack();
  await expect(page).toHaveURL(/\/home\/$/);

  // The browser's back from a room opened in the lobby also returns to the lobby.
  await openLobby(page, space);
  await card(page, 'Garden Club').tap();
  await expect(page).toHaveURL(roomPath(rooms['Garden Club']!));
  await page.goBack();
  await expect(page).toHaveURL(lobbyPath(space));

  // A room opened from the list goes back to the list.
  await back(page).tap();
  await expect(page).toHaveURL(spaceListPath(space));
  const list = page.getByTestId('resizable-page-nav');
  await list.getByRole('link', { name: 'Team room 1' }).tap();
  await expect(page).toHaveURL(roomPath(rooms['Team room 1']!));
  await back(page).tap();
  await expect(page).toHaveURL(spaceListPath(space));

  // A room opened from the command palette goes back to the list.
  await pressPaletteShortcut(page);
  await page.getByRole('dialog').getByRole('combobox').fill('Team room 2');
  await page
    .getByRole('dialog')
    .locator('[role="option"][data-kind="room"]')
    .filter({ hasText: 'Team room 2' })
    .tap();
  await expect(page).toHaveURL(roomPath(rooms['Team room 2']!));
  await back(page).tap();
  await expect(page).toHaveURL(spaceListPath(space));

  // A room opened by a link goes back to the list, in place of the room.
  await page.goto('/home/');
  await page.goto(`/${encodeURIComponent(space)}/${encodeURIComponent(rooms['Harbor Plans']!)}/`);
  await expect(back(page)).toBeVisible({ timeout: 30_000 });
  await back(page).tap();
  await expect(page).toHaveURL(spaceListPath(space));
  await page.goBack();
  await expect(page).toHaveURL(/\/home\/$/);
  await context.close();
};

const checkDesktop = async (browser: Browser, engine: string) => {
  const { context, page, seeded } = await signIn(browser, engine, DESKTOP);
  await page.goto(`/${encodeURIComponent(seeded.space)}/lobby/`);
  // Wider screens keep the card's Open Room button.
  await expect(card(page, 'Harbor Plans').locator('[data-room-id]')).toBeVisible({
    timeout: 30_000,
  });
  await context.close();
};

const inWebKit = async (check: (browser: Browser, engine: string) => Promise<void>) => {
  const browser = await launchWebKit();
  try {
    await check(browser, 'webkit');
  } finally {
    await browser.close();
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

test('on a phone a tap on a lobby card opens the room, and back returns to the lobby', async ({
  browser,
}) => {
  await checkCards(browser, 'chromium');
});

test('the lobby cards in Arabic', async ({ browser }) => {
  await checkCards(browser, 'chromium', 'ar');
});

test('a lobby card opens by keyboard', async ({ browser }) => {
  await checkKeyboard(browser, 'chromium');
});

test('back returns where the room was opened from', async ({ browser }) => {
  await checkBackPaths(browser, 'chromium');
});

test('a desktop lobby keeps the Open Room button', async ({ browser }) => {
  await checkDesktop(browser, 'chromium');
});

test.describe('WebKit', () => {
  test.beforeEach(() => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  });
  test('lobby cards on a phone', () => inWebKit((browser) => checkCards(browser, 'webkit')));
  test('lobby cards in Arabic', () => inWebKit((browser) => checkCards(browser, 'webkit', 'ar')));
  test('back paths', () => inWebKit((browser) => checkBackPaths(browser, 'webkit')));
});
