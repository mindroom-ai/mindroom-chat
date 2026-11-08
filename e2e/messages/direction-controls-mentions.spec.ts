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
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendReaction,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C) change the
// order text shows in without showing themselves. A location's description and a reaction's key
// show each control as its code point, as message text does. A mention pill names a member as
// their messages do: a name that holds controls shows without them, with the user ID after it.
// A user ID or room alias that a link names and the room does not know shows its controls as code
// points. Against the disposable homeserver of a slot, on a phone (390 by 844, touch) and a
// desktop (1280 by 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit. Set DIRECTION_MENTIONS_SHOTS=<directory> to save each view.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'direction-mentions-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DIRECTION_MENTIONS_SHOTS;
const ROOM_NAME = 'Audit Desk';
const FILLER_ROOMS = 24;
const HISTORY = 24;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

// The controls a sender can put in text. The app isolates a user ID it shows after a name between
// U+2066 and U+2069 itself, so scopes that name a member hold those two.
const CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const SENT_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e]/;

const MEMBER_NAME = 'Quinn \u202erelyat\u202c';
const LOCATION = 'Meet at gate \u202eB4 tsae\u202c by the lifts';
const LOCATION_SHOWN = 'Meet at gate <U+202E>B4 tsae<U+202C> by the lifts';
const UNKNOWN_USER = '@ops\u202enimda:example.org';
const UNKNOWN_USER_SHOWN = '@ops<U+202E>nimda:example.org';
const UNKNOWN_ALIAS = '#desk\u202eksed:example.org';
const UNKNOWN_ALIAS_SHOWN = '#desk<U+202E>ksed:example.org';
const KEY = 'ok\u202eyrev\u202c';
const KEY_SHOWN = 'ok<U+202E>yrev<U+202C>';

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

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `bidi_${name}_${RUN}`;
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

const matrixTo = (id: string) => `https://matrix.to/#/${encodeURIComponent(id)}`;

type World = {
  reader: Account;
  member: Account;
  roomId: string;
  locationId: string;
  mentionId: string;
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const member = await registerAndLogin(`member_${engine}`);
  // The member joins under the name, so their membership carries it.
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(member.userId)}/displayname`, {
    method: 'PUT',
    accessToken: member.accessToken,
    body: JSON.stringify({ displayname: MEMBER_NAME }),
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Ledger room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromMember = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromMember ? member : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromMember
        ? `Entry ${index}: the ledger balances for this week and the receipts are filed.`
        : `Entry ${index}: anything missing from the receipts this week?`,
    });
  }
  const locationId = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.location',
    body: LOCATION,
    geo_uri: 'geo:52.3702,4.8952',
  });
  const mentionId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Quinn, check with ops and the desk before the audit.',
    format: 'org.matrix.custom.html',
    formatted_body:
      `<a href="${matrixTo(member.userId)}">Quinn</a>, check with ` +
      `<a href="${matrixTo(UNKNOWN_USER)}">ops</a> and the ` +
      `<a href="${matrixTo(UNKNOWN_ALIAS)}">desk</a> before the audit.`,
    'm.mentions': { user_ids: [member.userId] },
  });
  await sendReaction(HOMESERVER, member.accessToken, roomId, mentionId, KEY);
  return { reader, member, roomId, locationId, mentionId };
};

const row = (page: Page, eventId: string): Locator =>
  page.locator(`[data-message-id="${eventId}"]`).first();

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The scope shows `shown` and holds none of the `controls`. */
const expectShown = async (scope: Locator, shown: string, controls = CONTROL) => {
  await expect(scope).toContainText(shown, { timeout: 30_000 });
  expect(await scope.textContent()).not.toMatch(controls);
};

const check = async (page: Page, world: World, label: string) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });

  // The location's description, and the member's name on their messages (the location follows
  // one of theirs, so its own row shows none).
  const location = row(page, world.locationId);
  await expectShown(location.getByText(/^Meet at gate/), LOCATION_SHOWN);
  const memberShown = `Quinn relyat (\u2066${world.member.userId}\u2069)`;
  const sender = page.locator(`[data-message-id] [data-user-id="${world.member.userId}"]`).last();
  await expect(sender).toHaveText(memberShown, { timeout: 30_000 });

  // The mention pills: the member as their messages name them, the unknown user and room as their
  // IDs.
  const mention = row(page, world.mentionId);
  await mention.scrollIntoViewIfNeeded();
  const memberPill = mention.locator(`a[data-mention-id="${world.member.userId}"]`);
  await expect(memberPill).toHaveText(`@${memberShown}`, { timeout: 30_000 });
  expect(await memberPill.textContent()).not.toMatch(SENT_CONTROL);
  await expectShown(mention.locator('a[data-mention-id^="@ops"]'), UNKNOWN_USER_SHOWN);
  await expectShown(mention.locator('a[data-mention-id^="#desk"]'), UNKNOWN_ALIAS_SHOWN);

  // The reaction's key on its chip.
  await expectShown(mention.locator('button').filter({ hasText: KEY_SHOWN }), KEY_SHOWN);
  await shot(page, `${label}-room`);

  // View Reactions names the key the same way. The menu opens on the row's contextmenu event: a
  // real right click in WebKit first selects the word under the pointer.
  const text = mention.getByText(/check with/).first();
  const box = await text.boundingBox();
  await text.dispatchEvent('contextmenu', {
    button: 2,
    clientX: (box?.x ?? 0) + 8,
    clientY: (box?.y ?? 0) + 8,
  });
  await page.getByRole('menuitem', { name: 'View Reactions' }).click({ timeout: 30_000 });
  const heading = page.getByText(/^Reacted with /);
  await expectShown(heading, `Reacted with :${KEY_SHOWN}:`);
  await expectShown(page.getByRole('tablist'), KEY_SHOWN);
  await shot(page, `${label}-reactions`);
  await page.keyboard.press('Escape');
  await expect(heading).toBeHidden();
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
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('locations, mention pills and reactions show direction controls as code points (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('locations, mention pills and reactions show direction controls as code points (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
