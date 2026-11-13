import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { joinRoom, loginToMatrix, matrixFetch } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import { launchWebKit } from '../helpers/webkit';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Activity leads to the invites: the bell counts them, the Activity list shows each one with Join
// and Decline and ends with All invites, which opens the invite list at its own address. The
// command palette's Go to Activity (also found as "inbox") and the Inbox's old addresses land on
// Activity, and the empty invite list leads back to it. Each test registers an account with 2
// pending invites on the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh), then declines both invites. Classic scrollbars show; the phone flow also
// runs in WebKit (the iPhone engine) when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit.
// Set ACTIVITY_INVITES_SHOTS=<directory> to also save screenshots.
const PASSWORD = 'activity-invites-spec-password';
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.ACTIVITY_INVITES_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const INVITED_ROOMS = ['Design Review', 'Launch Checklist'];

// Headless Chromium hides scrollbars; desktop browsers with classic scrollbars show them, and
// they take width from the columns. The other launch options repeat playwright.config.ts.
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

type Account = { username: string; userId: string; accessToken: string };

const register = async (name: string, displayname: string): Promise<Account> => {
  // A random suffix: the specs of one run share the homeserver.
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `aci_${name}_${suffix}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname }),
  });
  return { username, ...session };
};

type Seeded = { viewer: Account; invitedRoomIds: string[] };

/** Alice shares a room with Sam, so Sam is known to her, and Sam invites her to 2 more rooms. */
const seed = async (): Promise<Seeded> => {
  const viewer = await register('viewer', 'Alice');
  const peer = await register('peer', 'Sam Rivera');
  const shared = await createRoom(HOMESERVER, peer.accessToken, {
    name: 'Harbor Plans',
    invite: [viewer.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, shared);
  const invitedRoomIds = await Promise.all(
    INVITED_ROOMS.map((name) =>
      createRoom(HOMESERVER, peer.accessToken, { name, invite: [viewer.userId] })
    )
  );
  return { viewer, invitedRoomIds };
};

/** Declines every invite from outside the app, as another of the account's sessions would. */
const declineInvites = async ({ viewer, invitedRoomIds }: Seeded) => {
  await Promise.all(
    invitedRoomIds.map((roomId) =>
      matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/leave`, {
        method: 'POST',
        accessToken: viewer.accessToken,
        body: JSON.stringify({}),
      })
    )
  );
};

const signIn = (page: Page, viewer: Account) =>
  loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const railBell = (page: Page) => rail(page).getByRole('button', { name: /^Activity/ });
const topBarBell = (page: Page) =>
  page.locator('[data-phone-top-bar]').getByRole('button', { name: /^Activity/ });
const activityNav = (page: Page) => page.getByRole('navigation', { name: 'Activity', exact: true });
const inviteRows = (scope: Locator) => scope.locator('[data-activity-row="invite"]');
const inviteCards = (page: Page) => page.locator('[data-invite-room-id]');
const openActivityLink = (page: Page) =>
  page.getByRole('link', { name: 'Open Activity', exact: true });

/** The bell names how many rows are unread: here the 2 invites, or none. */
const bellName = (count: number) => (count > 0 ? `Activity, ${count} unread` : 'Activity');

/** Each pending invite is a row that names who sent it and the room, with Join and Decline. */
const expectInviteRows = async (scope: Locator) => {
  const rows = inviteRows(scope);
  await expect(rows).toHaveCount(INVITED_ROOMS.length, { timeout: 30_000 });
  for (const name of INVITED_ROOMS) {
    const row = rows.filter({ hasText: name });
    // Sam's ID follows his name until the client knows the room's members.
    // eslint-disable-next-line no-await-in-loop
    await expect(row).toContainText(/Sam Rivera( \(\S+\))? invited you/);
    // eslint-disable-next-line no-await-in-loop
    await expect(row.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    await expect(row.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
  }
};

/** The invite list is open at its own address with `count` cards. */
const expectInvitesPage = async (page: Page, count: number) => {
  await expect(page).toHaveURL(/\/activity\/invites\/$/);
  await expect(page.getByRole('heading', { name: 'Invites', level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(inviteCards(page)).toHaveCount(count, { timeout: 30_000 });
};

/** The empty invite list's way back to Activity shows whole, as a button, not underlined. */
const expectOpenActivityButton = async (page: Page) => {
  const link = openActivityLink(page);
  await expect(link).toBeInViewport({ ratio: 1 });
  await expect(link).toHaveCSS('text-decoration-line', 'none');
};

/** Nothing on the page is wider than the window, with the scrollbars taking their width. */
const expectNoSidewaysScroll = async (page: Page) => {
  const pageFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );
  expect(pageFits).toBe(true);
  for (const card of await inviteCards(page).all()) {
    // eslint-disable-next-line no-await-in-loop
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
};

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, path: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

const settleForShot = async (page: Page) => {
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.mouse.move(0, 0);
};

/**
 * On a phone the top bar's bell slides Activity up as a sheet, whose All invites opens the invite
 * list full screen; Back there leads to the Activity list. The Inbox's old address lands there too,
 * and the empty invite list leads back to it.
 */
const checkPhone = async (page: Page, seeded: Seeded, engine: string) => {
  await signIn(page, seeded.viewer);
  await expect(topBarBell(page)).toHaveAccessibleName(bellName(2), { timeout: 30_000 });
  await topBarBell(page).tap();
  const sheet = page.getByRole('dialog', { name: 'Activity', exact: true });
  await expectInviteRows(sheet);
  if (SHOTS && engine === 'chromium') {
    await settleForShot(page);
    await page.screenshot({ path: `${SHOTS}/activity-invites-sheet-phone.png` });
  }
  await sheet.getByRole('button', { name: 'All invites', exact: true }).tap();
  await expect(sheet).toBeHidden();
  await expectInvitesPage(page, 2);
  await expectNoSidewaysScroll(page);
  // The page fills the screen: the rail and the Activity list wait behind Back.
  await expect(rail(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page).toHaveURL(/\/activity\/$/);
  await expectInviteRows(activityNav(page));
  await expect(rail(page)).toBeVisible();

  // The Inbox's old address is the Activity list now.
  await page.goto('/inbox/');
  await expect(page).toHaveURL(/\/activity\/$/);
  await expectInviteRows(activityNav(page));

  // With both invites declined, the list goes, and the empty invite list leads back to Activity.
  await declineInvites(seeded);
  await expect(topBarBell(page)).toHaveAccessibleName(bellName(0), { timeout: 30_000 });
  await expect(inviteRows(activityNav(page))).toHaveCount(0);
  await openPath(page, '/activity/invites/');
  await expectInvitesPage(page, 0);
  await expect(page.getByText('No Invites', { exact: true })).toBeVisible();
  await expectOpenActivityButton(page);
  await expectNoSidewaysScroll(page);
  await openActivityLink(page).tap();
  await expect(page).toHaveURL(/\/activity\/$/);
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('the Activity bell lists the invites and leads to the invite list', async ({ page }) => {
  test.setTimeout(240_000);
  const seeded = await seed();
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, seeded.viewer);

  // The bell counts the pending invites; its popover lists them, then All invites.
  await expect(railBell(page)).toHaveAccessibleName(bellName(2), { timeout: 30_000 });
  await railBell(page).click();
  const popover = page.getByRole('dialog', { name: 'Activity', exact: true });
  await expectInviteRows(popover);
  if (SHOTS) {
    await settleForShot(page);
    await page.screenshot({ path: `${SHOTS}/activity-invites-popover-desktop.png` });
  }
  await popover.getByRole('button', { name: 'All invites', exact: true }).click();
  await expect(popover).toBeHidden();
  await expectInvitesPage(page, 2);
  // The Activity list stays beside the invite list.
  await expectInviteRows(activityNav(page));
  await expectNoSidewaysScroll(page);
  if (SHOTS) {
    await settleForShot(page);
    await page.screenshot({ path: `${SHOTS}/activity-invites-page-desktop.png` });
  }

  // The command palette's Go to Activity, which people who look for the Inbox find too.
  await openPath(page, '/home/');
  await pressPaletteShortcut(page);
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill('inbox');
  await palette.locator('[role="option"][data-item-id="go-activity"]').click();
  await expect(page).toHaveURL(/\/activity\/$/);
  await expectInviteRows(activityNav(page));

  // The Inbox's old addresses, with and without the slash, land on Activity.
  for (const path of ['/inbox/invites/', '/inbox/notifications/', '/inbox/']) {
    // eslint-disable-next-line no-await-in-loop
    await page.goto(path);
    // eslint-disable-next-line no-await-in-loop
    await expect(page).toHaveURL(/\/activity\/$/);
  }
  await openPath(page, '/home/');
  await openPath(page, '/inbox');
  await expect(page).toHaveURL(/\/activity\/$/);

  // With both invites declined, the bell's count goes and the empty invite list leads back to
  // Activity.
  await openPath(page, '/home/');
  await declineInvites(seeded);
  await expect(railBell(page)).toHaveAccessibleName(bellName(0), { timeout: 30_000 });
  await openPath(page, '/activity/invites/');
  await expectInvitesPage(page, 0);
  await expect(inviteRows(activityNav(page))).toHaveCount(0);
  await expect(page.getByText('No Invites', { exact: true })).toBeVisible();
  await expectOpenActivityButton(page);
  await openActivityLink(page).click();
  await expect(page).toHaveURL(/\/activity\/$/);
});

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the top bar bell lists the invites, and Back from the invite list shows Activity (Chromium)', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await checkPhone(page, await seed(), 'chromium');
  });
});

test('the top bar bell lists the invites on a phone (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const seeded = await seed();
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ ...PHONE, baseURL });
    await checkPhone(await context.newPage(), seeded, 'webkit');
  } finally {
    await browser.close();
  }
});
