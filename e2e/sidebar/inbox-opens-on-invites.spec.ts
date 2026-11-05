import {
  expect,
  test,
  webkit,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { joinRoom, loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';

// The Inbox opens on Invites, its first entry, also with no invite waiting: from the rail, from
// the command palette's Go Inbox and at the bare /inbox address. Notifications follows it in the
// Inbox navigation and keeps its own address, and the empty Invites page leads on to it. Each
// test registers an account with 2 pending invites and 3 notifications on the disposable
// homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh), then declines both invites.
// Classic scrollbars show; the phone flow also runs in WebKit (the iPhone engine) when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit. Set INBOX_INVITES_SHOTS=<directory> to
// also save the L29 screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'inbox-opens-on-invites-spec-password';
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.INBOX_INVITES_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const INVITED_ROOMS = ['Design Review', 'Launch Checklist'];
const NOTIFYING_MESSAGES = [
  'The crane schedule is ready.',
  'Can you check berth four before Friday?',
  'Lunch moves to noon.',
];

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

const register = async (name: string, displayname: string): Promise<Account> => {
  // A random suffix: the specs of one run share the homeserver.
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `ioi_${name}_${suffix}`;
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

/**
 * Alice shares a room with Sam, where Sam's 3 messages notify her (a room of two notifies every
 * message; one also mentions her), and Sam invites her to 2 more rooms.
 */
const seed = async (): Promise<Seeded> => {
  const viewer = await register('viewer', 'Alice');
  const peer = await register('peer', 'Sam Rivera');
  const shared = await createRoom(HOMESERVER, peer.accessToken, {
    name: 'Harbor Plans',
    invite: [viewer.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, shared);
  for (const body of NOTIFYING_MESSAGES) {
    const mention = body.startsWith('Can you');
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, peer.accessToken, shared, {
      msgtype: 'm.text',
      body: mention ? `${viewer.userId} ${body}` : body,
      ...(mention ? { 'm.mentions': { user_ids: [viewer.userId] } } : {}),
    });
  }
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
const railInbox = (page: Page) => rail(page).getByRole('button', { name: 'Inbox', exact: true });
/** The rail entry around the Inbox button, which holds its count of pending invites. */
const railInboxEntry = (page: Page) => railInbox(page).locator('xpath=..');
const inboxNav = (page: Page) => page.getByRole('navigation', { name: 'Inbox', exact: true });
const invitesLink = (page: Page) => inboxNav(page).getByRole('link', { name: /^Invites/ });
const notificationsLink = (page: Page) =>
  inboxNav(page).getByRole('link', { name: /^Notifications/ });
const inviteCards = (page: Page) => page.locator('[data-invite-room-id]');
const openNotificationsLink = (page: Page) =>
  page.getByRole('link', { name: 'Open Notifications', exact: true });

const top = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox();
  expect(box, 'a visible element').not.toBeNull();
  return box?.y ?? 0;
};

/**
 * The Inbox navigation lists Invites first, with `count` pending (none: no number), then
 * Notifications.
 */
const expectInvitesFirst = async (page: Page, count: number) => {
  const links = inboxNav(page).getByRole('link');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveText(
    count > 0 ? new RegExp(`^Invites\\s*${count}$`) : /^Invites$/
  );
  await expect(links.nth(1)).toHaveText(/^Notifications$/);
  expect(await top(invitesLink(page))).toBeLessThan(await top(notificationsLink(page)));
};

/** The Invites page is open at its own address with `count` cards. */
const expectInvitesPage = async (page: Page, count: number) => {
  await expect(page).toHaveURL(/\/inbox\/invites\/$/);
  await expect(page.getByRole('heading', { name: 'Invites', level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(inviteCards(page)).toHaveCount(count, { timeout: 30_000 });
};

/** The Notifications page is open at its own address and lists Sam's 3 messages. */
const expectNotificationsPage = async (page: Page) => {
  await expect(page).toHaveURL(/\/inbox\/notifications\/$/);
  await expect(page.getByRole('heading', { name: 'Notification Messages', level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  for (const message of NOTIFYING_MESSAGES) {
    // eslint-disable-next-line no-await-in-loop
    await expect(page.getByRole('main').getByText(message)).toBeVisible({ timeout: 30_000 });
  }
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
 * On a phone the rail opens Invites; Back leads to the Inbox list, Invites first, where
 * Notifications opens. The bare address keeps that list, and the empty Invites page leads on to
 * Notifications.
 */
const checkPhone = async (page: Page, seeded: Seeded, engine: string) => {
  await signIn(page, seeded.viewer);
  await expect(railInboxEntry(page)).toContainText('2', { timeout: 30_000 });
  await railInbox(page).tap();
  await expectInvitesPage(page, 2);
  await expectNoSidewaysScroll(page);
  // The page fills the screen: the rail and the Inbox list wait behind Back.
  await expect(rail(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page).toHaveURL(/\/inbox\/$/);
  await expectInvitesFirst(page, 2);
  await expect(rail(page)).toBeVisible();
  if (SHOTS && engine === 'chromium') {
    await settleForShot(page);
    await page.screenshot({ path: `${SHOTS}/L29-inbox-invites-phone.png` });
  }

  await notificationsLink(page).tap();
  await expectNotificationsPage(page);
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page).toHaveURL(/\/inbox\/$/);
  await invitesLink(page).tap();
  await expectInvitesPage(page, 2);

  // Deep links: Notifications keeps its address; the bare address is the phone's Inbox list.
  await page.goto('/inbox/notifications/');
  await expectNotificationsPage(page);
  await page.goto('/inbox/');
  await expectInvitesFirst(page, 2);
  await expect(page).toHaveURL(/\/inbox\/$/);

  // With both invites declined, the rail still opens Invites, which leads on to Notifications.
  await declineInvites(seeded);
  await expect(railInboxEntry(page)).not.toContainText(/\d/, { timeout: 30_000 });
  await expectInvitesFirst(page, 0);
  await railInbox(page).tap();
  await expectInvitesPage(page, 0);
  await expect(page.getByText('No Invites', { exact: true })).toBeVisible();
  const link = openNotificationsLink(page);
  await expect(link).toBeInViewport({ ratio: 1 });
  await expectNoSidewaysScroll(page);
  await link.tap();
  await expectNotificationsPage(page);
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('the Inbox opens on Invites, with Notifications one entry below', async ({ page }) => {
  test.setTimeout(240_000);
  const seeded = await seed();
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, seeded.viewer);

  // The rail counts the pending invites and opens the Inbox on them, Invites marked open.
  await expect(railInboxEntry(page)).toContainText('2', { timeout: 30_000 });
  await railInbox(page).click();
  await expectInvitesPage(page, 2);
  await expectInvitesFirst(page, 2);
  await expect(invitesLink(page)).toHaveAttribute('aria-current', 'page');
  await expect(notificationsLink(page)).not.toHaveAttribute('aria-current', 'page');
  await expectNoSidewaysScroll(page);
  if (SHOTS) {
    await settleForShot(page);
    await page.screenshot({ path: `${SHOTS}/L29-inbox-invites-desktop.png` });
  }

  // Notifications is one click away and marked open there.
  await notificationsLink(page).click();
  await expectNotificationsPage(page);
  await expect(notificationsLink(page)).toHaveAttribute('aria-current', 'page');
  await expectInvitesFirst(page, 2);

  // The command palette's Go Inbox lands on Invites too.
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill('inbox');
  await palette.locator('[role="option"][data-item-id="go-inbox"]').click();
  await expectInvitesPage(page, 2);

  // Addresses: the bare Inbox opens Invites, with and without the slash; Notifications keeps
  // its own.
  await page.goto('/inbox/notifications/');
  await expectNotificationsPage(page);
  await page.goto('/inbox/');
  await expectInvitesPage(page, 2);
  await expect(invitesLink(page)).toHaveAttribute('aria-current', 'page');
  await openPath(page, '/inbox');
  await expectInvitesPage(page, 2);

  // With both invites declined, the Inbox still opens on Invites, which leads on to Notifications.
  await openPath(page, '/home/');
  await declineInvites(seeded);
  await expect(railInboxEntry(page)).not.toContainText(/\d/, { timeout: 30_000 });
  await railInbox(page).click();
  await expectInvitesPage(page, 0);
  await expectInvitesFirst(page, 0);
  await expect(page.getByText('No Invites', { exact: true })).toBeVisible();
  await expect(openNotificationsLink(page)).toBeInViewport({ ratio: 1 });
  await openNotificationsLink(page).click();
  await expectNotificationsPage(page);
});

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the Inbox opens on Invites, and Back shows its list, Invites first (Chromium)', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await checkPhone(page, await seed(), 'chromium');
  });
});

test('the Inbox opens on Invites on a phone (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const seeded = await seed();
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
  try {
    const context = await browser.newContext({ ...PHONE, baseURL });
    await checkPhone(await context.newPage(), seeded, 'webkit');
  } finally {
    await browser.close();
  }
});
