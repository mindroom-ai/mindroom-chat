import { expect, test, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Room and space names as the navigation shows them, with names people really give: several
// rooms that differ only at their end, and long English names in an Arabic interface. A space
// with 7 rooms, an invite and an unread room with a thread that names the reader, on a phone (390
// by 844, touch) and a desktop.
const PASSWORD = 'space-names-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPACE_NAME = 'Engineering Operations and Infrastructure Planning Group';
const LONG_ROOM = 'Quarterly planning for the customer onboarding experience redesign';
const SIMILAR = ['Engineering room 1', 'Engineering room 2', 'Engineering room 3'];
const INVITE_NAME = 'Invitation to the launch party planning committee for next spring';
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({
  launchOptions: {
    // Classic scrollbars, as desktop browsers show them. The other options repeat
    // playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = async (name: string) => {
  const username = `spn_${name}_${RUN}`;
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

type Seed = { username: string; space: string };
let seeded: Promise<Seed> | undefined;

const seed = async (): Promise<Seed> => {
  const owner = await register('owner');
  const peer = await register('peer');
  const space = await createPrivateSpace(HOMESERVER, owner.accessToken, {
    name: SPACE_NAME,
    topic: '',
  });
  for (const name of [...SIMILAR, LONG_ROOM]) {
    const roomId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
      name,
      topic: 'Weekly notes and decisions',
      invite: [peer.userId],
    });
    await addRoomToSpace(HOMESERVER, owner.accessToken, space, roomId);
    await joinRoom(HOMESERVER, peer.accessToken, roomId);
    if (name === LONG_ROOM) {
      await sendRoomMessage(HOMESERVER, peer.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'The draft is ready for another look.',
      });
      // A thread that names the owner, so Activity lists it with the room's name.
      const rootId = await sendRoomMessage(HOMESERVER, peer.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'Open questions on the redesign',
      });
      await sendRoomMessage(HOMESERVER, peer.accessToken, roomId, {
        msgtype: 'm.text',
        body: `${owner.userId} can you review the second section?`,
        'm.mentions': { user_ids: [owner.userId] },
        'm.relates_to': { rel_type: 'm.thread', event_id: rootId, is_falling_back: true },
      });
    }
  }
  await createPrivateRoom(HOMESERVER, peer.accessToken, {
    name: INVITE_NAME,
    topic: '',
    invite: [owner.userId],
  });
  await setAccountData(HOMESERVER, owner.accessToken, owner.userId, 'io.mindroom.spaces', {
    sidebar: [space],
  });
  return { username: owner.username, space };
};

const signIn = async (page: Page, language?: string) => {
  seeded ??= seed();
  const { username } = await seeded;
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  if (language) {
    await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  }
};

/** The direction a name's own line reads in: an English name truncates at its end only in ltr. */
const direction = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).direction);

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('long English names keep their start in a right-to-left interface', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  await signIn(page, 'ar');
  const { space } = await seeded!;

  await page.goto(`/${encodeURIComponent(space)}/lobby/`);
  const nav = page.getByTestId('resizable-page-nav');
  await expect(nav.getByText(SPACE_NAME, { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await direction(nav.getByText(SPACE_NAME, { exact: true }))).toBe('ltr');
  const card = page.locator('main').getByText(LONG_ROOM, { exact: true });
  await expect(card).toBeVisible();
  expect(await direction(card)).toBe('ltr');
  expect(await direction(page.locator('main').getByText('Weekly notes and decisions').first())).toBe(
    'ltr'
  );

  await page.goto('/activity/invites/');
  const invite = page.locator('main').getByText(INVITE_NAME, { exact: true });
  await expect(invite).toBeVisible({ timeout: 30_000 });
  expect(await direction(invite)).toBe('ltr');

  await page.goto('/activity/');
  // The thread's row names its room, which keeps its start.
  const activityRoom = page
    .locator('[data-activity-list="page"] [data-activity-row]')
    .getByText(LONG_ROOM, { exact: true });
  await expect(activityRoom).toBeVisible({ timeout: 30_000 });
  expect(await direction(activityRoom)).toBe('ltr');

  await pressPaletteShortcut(page);
  // The palette's accessible name is in Arabic too.
  const palette = page.getByRole('dialog').filter({ has: page.getByRole('combobox') });
  await palette.getByRole('combobox').fill('quarterly');
  const row = palette.locator('[role="option"][data-kind="room"]').getByText(LONG_ROOM);
  await expect(row).toBeVisible();
  expect(await direction(row)).toBe('ltr');
  await context.close();
});

test('the Lobby row is marked as the page shown while the lobby is open', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  await signIn(page);
  const { space } = await seeded!;
  await page.goto(`/${encodeURIComponent(space)}/lobby/`);
  const lobby = page.getByTestId('resizable-page-nav').getByRole('link', { name: 'Lobby' });
  await expect(lobby).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
  await page.getByTestId('resizable-page-nav').getByRole('link', { name: SIMILAR[0] }).click();
  await expect(lobby).not.toHaveAttribute('aria-current', 'page');
  await context.close();
});

test('on a phone the lobby shows rooms that differ only at their end in full', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await signIn(page);
  const { space } = await seeded!;
  await page.goto(`/${encodeURIComponent(space)}/lobby/`);
  for (const name of [...SIMILAR, LONG_ROOM]) {
    const card = page.locator('main').getByText(name, { exact: true });
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Nothing of the name is cut off: it wraps instead of ending in an ellipsis.
    const cut = await card.evaluate(
      (element) =>
        element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1
    );
    expect(cut, name).toBe(false);
  }
  await context.close();
});
