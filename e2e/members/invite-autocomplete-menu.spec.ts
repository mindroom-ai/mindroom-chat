import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { standInVisualViewport } from '../helpers/keyboardViewport';
import { createPrivateRoom, joinRoom, matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// The Instant Directory Sheet inside InviteUserPrompt: opens directly onto browsable directory
// rows without a floating listbox, filters between People and Agents, wraps 60-character Matrix
// IDs onto multiple lines with zero sideways overflow, mirrors cleanly in RTL, and stays bounded
// inside Safari's visual viewport when the virtual keyboard shrinks the screen.
// Checked with classic scrollbars in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set INVITE_MENU_SHOTS=<directory> to save screenshots.
const SHOTS = process.env.INVITE_MENU_SHOTS;
const PASSWORD = 'invite-autocomplete-menu-spec-password';
/** Every suggested account's Matrix ID holds it, so one search lists them all. */
const QUERY = 'team';
const PHONE = { width: 386, height: 720 };
const DESKTOP = { width: 1180, height: 760 };
const KEYBOARD_HEIGHT = 380;
const LONG_ID_LENGTH = 60;
const WRAPPING_NAME =
  'Alexandria Catherine Montgomery-Wellington of the Northern Research Collaborative';
const PEOPLE = [
  ['alice', 'Alice Adams'],
  ['bea', 'Bea Novak'],
  ['carlos', 'Carlos Mendes'],
  ['dana', 'Dana Okafor'],
  ['eli', 'Eli Brandt'],
  ['alexandria', WRAPPING_NAME],
] as const;
const THEMES = ['light-theme', 'dark-theme'] as const;

type Seed = { run: string; username: string; roomName: string; longId: string };
type Box = { x: number; y: number; width: number; height: number };

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

const register = async (username: string, displayName: string) => {
  const account = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch<unknown>(
    HOMESERVER,
    `/profile/${encodeURIComponent(account.user_id)}/displayname`,
    {
      method: 'PUT',
      accessToken: account.access_token,
      body: JSON.stringify({ displayname: displayName }),
    }
  );
  return { userId: account.user_id, accessToken: account.access_token };
};

const seed = async (engine: string): Promise<Seed> => {
  const run = `${engine.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  const username = `invite_menu_${run}`;
  const reader = await register(username, 'Robin Reader');
  const server = reader.userId.slice(reader.userId.indexOf(':') + 1);
  // Seed a MindRoom agent with a 60-character MXID so both wrapping and People/Agents filter pills are exercised.
  const longLocalpart = `mindroom_${QUERY}_helper_${run}_research_assistant_workspace`.slice(
    0,
    LONG_ID_LENGTH - server.length - 2
  );
  const people = await Promise.all([
    ...PEOPLE.map(([localpart, name]) => register(`${QUERY}_${localpart}_${run}`, name)),
    register(`${QUERY}_farah_${run}`, 'Farah Haddad'),
    register(longLocalpart, 'Helper agent'),
  ]);
  const shared = await createPrivateRoom(HOMESERVER, reader.accessToken, {
    name: 'Team directory',
    topic: '',
    invite: people.map((person) => person.userId),
  });
  await Promise.all(people.map((person) => joinRoom(HOMESERVER, person.accessToken, shared)));
  const roomName = 'Design studio';
  await createPrivateRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    topic: 'Shared projects',
  });
  return { run, username, roomName, longId: `@${longLocalpart}:${server}` };
};

const scopeDirectory = (page: Page, run: string) =>
  page.route('**/user_directory/search', (route) =>
    route.continue({
      postData: JSON.stringify({
        ...(route.request().postDataJSON() as Record<string, unknown>),
        search_term: run,
      }),
    })
  );

const switchTheme = async (page: Page, themeId: string) => {
  await page.evaluate((id) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
    );
  }, themeId);
  await page.reload();
};

const openInvite = async (page: Page, seeded: Seed) => {
  const entry = page.locator('a[href^="/home/"]').filter({ hasText: seeded.roomName }).first();
  await expect(entry).toBeVisible({ timeout: 60_000 });
  await entry.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Invite', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`Invite to .*${seeded.roomName}`) });
  await expect(dialog).toBeVisible();
  return dialog;
};

const checkBrowseAndFilters = async (dialog: Locator) => {
  // Browsable directory rows appear immediately before typing in the search field.
  const rows = dialog.locator('li');
  await expect(rows).toHaveCount(8, { timeout: 30_000 });
  await expect(dialog.page().getByRole('listbox')).toHaveCount(0);

  // Filter pills switch between All (8), People (7), and Agents (1).
  await dialog.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Helper agent');

  await dialog.getByRole('button', { name: 'People', exact: true }).click();
  await expect(rows).toHaveCount(7);
  await expect(dialog).not.toContainText('Helper agent');

  await dialog.getByRole('button', { name: 'All', exact: true }).click();
  await expect(rows).toHaveCount(8);
};

const search = async (dialog: Locator) => {
  const field = dialog.getByRole('searchbox');
  await field.fill(QUERY);
  const rows = dialog.locator('li');
  await expect(rows).toHaveCount(8, { timeout: 30_000 });
  await expect(dialog.page().getByRole('listbox')).toHaveCount(0);
  await dialog.page().mouse.move(1, 1);
  return { field, rows };
};

const box = async (locator: Locator): Promise<Box> => {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('The element has no box');
  return bounds;
};

const lines = (locator: Locator) =>
  locator.evaluate((element) => {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    return Math.round(element.getBoundingClientRect().height / lineHeight);
  });

const sidewaysOverflow = (locator: Locator) =>
  locator.evaluate((element) => element.scrollWidth - element.clientWidth);

const rowByName = (dialog: Locator, name: string) =>
  dialog.locator('li').filter({ hasText: name }).first();

const checkRows = async (dialog: Locator, seeded: Seed) => {
  const dialogBox = await box(dialog);

  const plain = rowByName(dialog, 'Eli Brandt');
  await plain.scrollIntoViewIfNeeded();
  const plainBox = await box(plain);
  expect(plainBox.x).toBeGreaterThanOrEqual(dialogBox.x);
  expect(plainBox.x + plainBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);

  const longNameRow = rowByName(dialog, WRAPPING_NAME);
  await longNameRow.scrollIntoViewIfNeeded();
  const longNameBox = await box(longNameRow);
  expect(longNameBox.x + longNameBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);

  // The 60-character Matrix ID wraps onto multiple lines with full visible text and zero sideways overflow.
  expect(seeded.longId).toHaveLength(LONG_ID_LENGTH);
  const helper = rowByName(dialog, 'Helper agent');
  await helper.scrollIntoViewIfNeeded();
  const helperId = helper.getByText(seeded.longId, { exact: true });
  await expect(helperId).toBeVisible();
  expect(await lines(helperId)).toBeGreaterThan(1);
  expect(await sidewaysOverflow(helper)).toBeLessThanOrEqual(0);
  expect(await sidewaysOverflow(helperId)).toBeLessThanOrEqual(0);
  const helperBox = await box(helper);
  expect(helperBox.x + helperBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
};

const checkMirrored = async (dialog: Locator, rightToLeft: boolean) => {
  const row = rowByName(dialog, 'Alice Adams');
  const avatar = await box(row.locator(':scope > :first-child'));
  const action = await box(row.getByRole('button'));
  const rowBox = await box(row);
  if (rightToLeft) {
    expect(avatar.x).toBeGreaterThan(action.x);
    return rowBox.x + rowBox.width - (avatar.x + avatar.width);
  }
  expect(avatar.x).toBeLessThan(action.x);
  return avatar.x - rowBox.x;
};

const checkPhoneKeyboardViewport = async (page: Page, seeded: Seed) => {
  await page.setViewportSize(PHONE);
  const dialog = await openInvite(page, seeded);
  await expect(dialog.locator('li')).toHaveCount(8, { timeout: 30_000 });

  await page.evaluate((visible) => {
    window.__setKeyboardViewport?.(visible, 0, 'resize');
  }, KEYBOARD_HEIGHT);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
    )
    .toBe(`${KEYBOARD_HEIGHT}px`);

  // Dialog and footer note toggle stay inside the shrunk visual viewport above the keyboard.
  const dialogBox = await box(dialog);
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(KEYBOARD_HEIGHT + 1);

  const noteToggle = dialog.getByRole('button', { name: /\+ Add invite note/ });
  const noteBox = await box(noteToggle);
  expect(noteBox.y).toBeGreaterThanOrEqual(0);
  expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(KEYBOARD_HEIGHT + 1);

  // The directory list scrolls so the last row remains reachable above the footer.
  const lastRow = dialog.locator('li').last();
  await lastRow.scrollIntoViewIfNeeded();
  const lastRowBox = await box(lastRow);
  expect(lastRowBox.y + lastRowBox.height).toBeLessThanOrEqual(noteBox.y + 1);

  await page.evaluate((fullHeight) => {
    window.__setKeyboardViewport?.(fullHeight, 0, 'resize');
  }, PHONE.height);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeHidden();
};

const shoot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.mouse.move(1, 1);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, scale: 'css' });
};

const exercise = async (page: Page, engine: string) => {
  test.setTimeout(300_000);
  const seeded = await seed(engine);
  await scopeDirectory(page, seeded.run);
  await page.setViewportSize(PHONE);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });

  for (const theme of THEMES) {
    await switchTheme(page, theme);
    await page.setViewportSize(PHONE);
    let dialog = await openInvite(page, seeded);
    await checkBrowseAndFilters(dialog);
    await search(dialog);
    await checkRows(dialog, seeded);
    await shoot(page, `${engine}-${theme}-phone`);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.setViewportSize(DESKTOP);
    dialog = await openInvite(page, seeded);
    await search(dialog);
    await shoot(page, `${engine}-${theme}-desktop`);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await checkPhoneKeyboardViewport(page, seeded);

  await page.setViewportSize(PHONE);
  const inset: number[] = [];
  for (const rightToLeft of [false, true]) {
    await page.evaluate(
      (dir) => document.documentElement.setAttribute('dir', dir),
      rightToLeft ? 'rtl' : 'ltr'
    );
    const dialog = await openInvite(page, seeded);
    await search(dialog);
    inset.push(await checkMirrored(dialog, rightToLeft));
    if (rightToLeft) await shoot(page, `${engine}-dark-theme-phone-rtl`);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  expect(inset[1]).toBeCloseTo(inset[0] ?? Number.NaN, 0);
};

test('the invite directory sheet renders inline rows and mirrors cleanly (Chromium)', async ({
  context,
}) => {
  await standInVisualViewport(context);
  await exercise(await context.newPage(), 'chromium');
});

test('the invite directory sheet renders inline rows and mirrors cleanly (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: PHONE, baseURL });
    await standInVisualViewport(context);
    await exercise(await context.newPage(), 'webkit');
  } finally {
    await browser.close();
  }
});
