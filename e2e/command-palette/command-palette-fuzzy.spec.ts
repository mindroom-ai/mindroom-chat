import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';

// What the command palette finds for text typed the way people type into a fuzzy finder:
// initials, an abbreviation, a typo, a name without its accent. A row shows the letters that
// matched, a person's name lists no setting, and on All the row named by the text is first. Each
// test signs in a new account, so a theme one of them picks reaches no other.
const PASSWORD = 'command-palette-fuzzy-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.use({ viewport: { width: 1280, height: 800 } });

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const rows = (page: Page) => palette(page).getByRole('option');
const row = (page: Page, id: string) =>
  palette(page).locator(`[role="option"][data-item-id="${id}"]`);
/** The marked letters of a row, one entry per mark. */
const marks = (page: Page, id: string) => row(page, id).locator('mark[data-match]');

const register = (name: string) => registerDisposableUser(`cpf_${name}_${RUN}`, PASSWORD);

const signIn = async (page: Page, user: DisposableUser) => {
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
};

const typeText = (page: Page, text: string) => palette(page).getByRole('combobox').fill(text);

/** Types `text` and waits until the row `id` is the first row and the highlighted one. */
const expectFirst = async (page: Page, text: string, id: string) => {
  await typeText(page, text);
  await expect(rows(page).first()).toHaveAttribute('data-item-id', id);
  await expect(row(page, id)).toHaveAttribute('aria-selected', 'true');
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('initials, an abbreviation, a typo and text without accents find their rows', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await register('find');
  const cafe = await createPrivateRoom(HOMESERVER, user.accessToken, { name: 'Café Français' });
  const platform = await createPrivateRoom(HOMESERVER, user.accessToken, {
    name: 'Engineering Platform',
    topic: 'Build system',
  });
  await signIn(page, user);
  await pressPaletteShortcut(page);

  // Initials, and an abbreviation that leaves letters of the last word out.
  await expectFirst(page, 'cr', 'create-room');
  await expectFirst(page, 'crm', 'create-room');
  await expect(marks(page, 'create-room')).toHaveText(['C', 'R', 'm']);
  await expect(row(page, 'create-room')).toContainText('Create Room');

  // A typo in a setting's name, which the exact search of settings did not take.
  await expectFirst(page, 'markdwon', 'setting:markdown');
  await expect(marks(page, 'setting:markdown')).toHaveText(['Markdown']);

  // A name typed without its accent, and the starts of two words.
  await expectFirst(page, 'cafe', `room:${cafe}`);
  await expect(marks(page, `room:${cafe}`)).toHaveText(['Café']);
  await expectFirst(page, 'engplat', `room:${platform}`);
  await expect(marks(page, `room:${platform}`)).toHaveText(['Eng', 'Plat']);

  // Words in any order over the name and the topic; the topic's match is marked in its line.
  await expectFirst(page, 'build eng', `room:${platform}`);
  await expect(marks(page, `room:${platform}`)).toHaveText(['Eng', 'Build']);

  // Enter opens the row found.
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(platform)));
});

test("a person's name lists no setting, and a short word takes no wrong letter", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, await register('names'));
  await pressPaletteShortcut(page);
  await palette(page).getByRole('tab', { name: 'Actions', exact: true }).click();
  // The tab lists its actions before anything is typed.
  await expect(row(page, 'open-settings')).toBeVisible();

  for (const name of ['john', 'lisa', 'emma']) {
    await typeText(page, name);
    await expect(rows(page)).toHaveCount(0);
  }
  // The same search does find a setting by its name.
  await typeText(page, 'membership');
  await expect(row(page, 'setting:hideMembershipEvents')).toBeVisible();
  // "hime" is no typo of Home: it is the starts of "Hide Membership".
  await expectFirst(page, 'hime', 'setting:hideMembershipEvents');
  await expect(marks(page, 'setting:hideMembershipEvents')).toHaveText(['Hi', 'Me']);
  await expect(row(page, 'go-home')).toHaveCount(0);
});

test('on All the row named by the text is first, whatever its section', async ({ page }) => {
  test.setTimeout(120_000);
  const user = await register('all');
  const room = await createPrivateRoom(HOMESERVER, user.accessToken, {
    name: 'Dark Mode Feedback',
  });
  await signIn(page, user);
  await pressPaletteShortcut(page);

  // The room holds the word; the theme is named by it, so its section goes first.
  await expectFirst(page, 'dark', 'theme:dark-theme');
  await expect(row(page, `room:${room}`)).toBeVisible();
  // A longer text names the room.
  await expectFirst(page, 'dark mode', `room:${room}`);

  // The three rows of actions, settings and choices are the best of them together: a setting
  // named by the text keeps its row, and a word many rows hold lists the actions first.
  await expectFirst(page, 'archived', 'setting:archivedRooms');
  await typeText(page, 'room');
  await expect(row(page, 'create-room')).toBeVisible();
  await expect(row(page, 'setting:archivedRooms')).toHaveCount(0);
  await palette(page).getByRole('tab', { name: 'Actions', exact: true }).click();
  await expect(row(page, 'setting:archivedRooms')).toBeVisible();

  await palette(page).getByRole('tab', { name: 'All', exact: true }).click();
  await expectFirst(page, 'dark', 'theme:dark-theme');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveClass(/(^|\s)dark-theme(\s|$)/);
});
