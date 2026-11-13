import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Dialogs and menus around a room, used from the keyboard and in a right-to-left language, in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit:
// - a prompt opened from the room header's menu (Invite, Leave Room) gives focus back to the
//   menu's button when it closes, instead of to the start of the page;
// - the arrow keys move between the entries of the room header's menu;
// - the Leave Room confirmation takes focus as it opens, so a screen reader announces it;
// - a long Latin name in a right-to-left list loses its end to the ellipsis, not its start.
const PASSWORD = 'dialog-keyboard-paths-spec-password';
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const LONG_NAME = 'Sam Taylor with a considerably longer display name than usual';

type Account = { username: string; userId: string; accessToken: string };

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
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const DESKTOP = { width: 1280, height: 800 };

/** Opens an entry of the room header's menu from the keyboard; returns the dialog it opens. */
const openFromMenu = async (page: Page, entry: string): Promise<Locator> => {
  await page.getByRole('button', { name: 'More Options', exact: true }).focus();
  await page.keyboard.press('Enter');
  const item = page.getByRole('menuitem', { name: entry, exact: true });
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
  const first = page.getByRole('menuitem', { name: 'Mark as Read', exact: true });
  const second = page.getByRole('menuitem', { name: 'Notifications', exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
};

const leavePromptTakesFocus = async (page: Page) => {
  const { viewer, roomId } = await seed();
  await openRoom(page, viewer, roomId);
  // With the pointer, as most people open it: the menu entry that had focus is gone then.
  await page.getByRole('button', { name: 'More Options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Leave Room', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  // Nothing destructive has focus: Enter right away does not leave the room.
  await expect(page.getByRole('button', { name: 'Leave', exact: true })).not.toBeFocused();
};

const longLatinNameKeepsItsStart = async (page: Page) => {
  const { viewer, member, roomId } = await seed();
  await openRoom(page, viewer, roomId, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const name = page
    .locator(`button[data-user-id="${member.userId}"]`)
    .getByText(LONG_NAME, { exact: true });
  await expect(name).toHaveText(LONG_NAME, { timeout: 30_000 });

  // Where the name's first letters sit, against the box that clips the name.
  const { firstLeft, firstRight, boxLeft, boxRight, clipped } = await name.evaluate((element) => {
    const text = element.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const first = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      firstLeft: first.left,
      firstRight: first.right,
      boxLeft: box.left,
      boxRight: box.right,
      clipped: element.scrollWidth > element.clientWidth,
    };
  });
  expect(clipped).toBe(true);
  expect(firstLeft).toBeGreaterThanOrEqual(boxLeft - 1);
  expect(firstRight).toBeLessThanOrEqual(boxRight + 1);
};

const CHECKS: Array<[string, (page: Page) => Promise<void>]> = [
  ['prompts from the header menu give focus back to its button', focusReturnsToMenuButton],
  ['the arrow keys move through the header menu', menuArrowKeys],
  ['the Leave Room confirmation takes focus as it opens', leavePromptTakesFocus],
  ['a long Latin name in a right-to-left members list keeps its start', longLatinNameKeepsItsStart],
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
    const browser = await launchWebKit();
    try {
      const page = await browser.newPage({ viewport: DESKTOP, baseURL });
      await check(page);
    } finally {
      await browser.close();
    }
  });
}
