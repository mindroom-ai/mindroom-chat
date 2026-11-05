import { expect, test, webkit, type Locator, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { matrixFetch } from '../helpers/matrix';

// Dialogs and menus around a room, used from the keyboard, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit:
// - a prompt opened from the room header's menu (Invite, Leave Room) gives focus back to the
//   menu's button when it closes, instead of to the start of the page;
// - the arrow keys move between the entries of the room header's menu.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'dialog-keyboard-paths-spec-password';
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
// The project's Chrome user agent would reach WebKit pages too; Safari's keeps them Safari.
const SAFARI_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const LONG_NAME = 'Sam Taylor with a considerably longer display name than usual';

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

const register = async (prefix: string, displayName: string): Promise<Account> => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const username = `${prefix}_${run}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

/** A room the viewer shares with a person whose name is too long for the members list. */
const seed = async () => {
  const viewer = await register('dkp_viewer', 'Jordan Viewer');
  const member = await register('dkp_member', LONG_NAME);
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: viewer.accessToken,
    body: JSON.stringify({ preset: 'public_chat', name: 'Project Team', topic: 'Weekly goals' }),
  });
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    accessToken: member.accessToken,
    body: '{}',
  });
  return { viewer, member, roomId };
};

const openRoom = async (page: Page, viewer: Account, roomId: string, language = 'en') => {
  await page.goto('/');
  await page.evaluate((lang) => localStorage.setItem('i18nextLng', lang), language);
  await page.goto(buildLoginPath(HOMESERVER));
  await page.locator('input[name="usernameInput"]').fill(viewer.username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/(home|inbox|direct)\//, { timeout: 60_000 });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 30_000 });
};

const isFocused = (locator: Locator) =>
  locator.evaluate((element) => element === document.activeElement);

test.beforeAll(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const DESKTOP = { width: 1280, height: 800 };

/** Opens an entry of the room header's menu from the keyboard; returns the dialog it opens. */
const openFromMenu = async (page: Page, entry: string): Promise<Locator> => {
  await page.getByRole('button', { name: 'More Options', exact: true }).focus();
  await page.keyboard.press('Enter');
  const item = page.getByRole('button', { name: entry, exact: true });
  await item.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('[role=dialog], [role=alertdialog]').first();
  await expect(dialog).toBeVisible();
  return dialog;
};

const focusReturnsToMenuButton = async (page: Page) => {
  const { viewer, roomId } = await seed();
  await openRoom(page, viewer, roomId);
  const menuButton = page.getByRole('button', { name: 'More Options', exact: true });
  for (const entry of ['Invite', 'Leave Room']) {
    const dialog = await openFromMenu(page, entry);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => isFocused(menuButton), { message: `after ${entry}` }).toBe(true);
  }
};

const menuArrowKeys = async (page: Page) => {
  const { viewer, roomId } = await seed();
  await openRoom(page, viewer, roomId);
  await page.getByRole('button', { name: 'More Options', exact: true }).focus();
  await page.keyboard.press('Enter');
  const first = page.getByRole('button', { name: 'Mark as Read', exact: true });
  const second = page.getByRole('button', { name: 'Notifications', exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
};

const CHECKS: Array<[string, (page: Page) => Promise<void>]> = [
  ['prompts from the header menu give focus back to its button', focusReturnsToMenuButton],
  ['the arrow keys move through the header menu', menuArrowKeys],
];

for (const [title, check] of CHECKS) {
  test(`${title} (Chromium)`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(DESKTOP);
    await check(page);
  });

  test(`${title} (WebKit)`, async ({ baseURL }) => {
    test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to run WebKit');
    test.slow();
    const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
    try {
      const page = await browser.newPage({
        viewport: DESKTOP,
        baseURL,
        userAgent: SAFARI_USER_AGENT,
      });
      await check(page);
    } finally {
      await browser.close();
    }
  });
}
