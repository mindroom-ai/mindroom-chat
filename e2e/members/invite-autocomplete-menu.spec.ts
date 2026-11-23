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

// Option A Instant Directory Sheet E2E coverage: browse, filter (People/Agents), search,
// wrapping 60-character and unlisted Matrix IDs, desktop & phone framing, mobile keyboard
// visual viewport bounds, one-tap invite + retry + note + moderator grant, and RTL mirroring.
const SHOTS = process.env.INVITE_MENU_SHOTS;
const PASSWORD = 'invite-autocomplete-menu-spec-password';
const QUERY = 'team';
const PHONE = { width: 386, height: 720 };
const DESKTOP = { width: 1180, height: 760 };
const KEYBOARD_HEIGHT = 360;
const KEYBOARD_OFFSET_TOP = 40;
const LONG_ID_LENGTH = 60;
const UNLISTED_ID = `@${'visiting.researcher.'.repeat(3)}guest:another-homeserver.example.org`;
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

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

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

const checkBrowseAndFilters = async (dialog: Locator) => {
  const rows = dialog.locator('li');
  await expect(rows).toHaveCount(8, { timeout: 30_000 });
  await expect(dialog.page().getByRole('listbox')).toHaveCount(0);

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

const checkRows = async (dialog: Locator, seeded: Seed) => {
  const dialogBox = await box(dialog);

  for (const name of ['Eli Brandt', WRAPPING_NAME]) {
    const row = rowByName(dialog, name);
    await row.scrollIntoViewIfNeeded();
    const rowBox = await box(row);
    expect(rowBox.x).toBeGreaterThanOrEqual(dialogBox.x);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
  }

  expect(seeded.longId).toHaveLength(LONG_ID_LENGTH);
  const helper = rowByName(dialog, 'Helper agent');
  await helper.scrollIntoViewIfNeeded();
  const helperId = helper.getByText(seeded.longId, { exact: true });
  await expect(helperId).toBeVisible();
  expect(await lines(helperId)).toBeGreaterThan(1);
  expect(await sidewaysOverflow(helper)).toBeLessThanOrEqual(0);
  expect(await sidewaysOverflow(helperId)).toBeLessThanOrEqual(0);
};

const checkUnlistedId = async (dialog: Locator) => {
  await dialog.getByRole('searchbox').fill(UNLISTED_ID);
  const row = dialog.locator('li').filter({ hasText: 'External Matrix ID' });
  await expect(row).toHaveCount(1);
  const name = row.getByText(UNLISTED_ID, { exact: true });
  await expect(name).toBeVisible();
  expect(await lines(name)).toBeGreaterThan(1);
  expect(await sidewaysOverflow(row)).toBeLessThanOrEqual(0);
  const dialogBox = await box(dialog);
  const rowBox = await box(row);
  expect(rowBox.x).toBeGreaterThanOrEqual(dialogBox.x);
  expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
};

const checkDesktopFraming = async (dialog: Locator) => {
  const bounds = await box(dialog);
  expect(bounds.height).toBeGreaterThan(300);
  expect(bounds.height).toBeLessThanOrEqual(640 + 1);
  expect(Math.abs(bounds.y + bounds.height / 2 - DESKTOP.height / 2)).toBeLessThan(2);
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  const modBox = await box(dialog.getByText(/^Give invited agents .+ rights$/));
  const firstActionBox = await box(dialog.locator('li').first().getByRole('button'));
  expect(modBox.y + modBox.height).toBeLessThanOrEqual(firstActionBox.y);
};

const checkPhoneKeyboardViewport = async (page: Page, seeded: Seed) => {
  await page.setViewportSize(PHONE);
  const dialog = await openInvite(page, seeded);
  await expect(dialog.locator('li')).toHaveCount(8, { timeout: 30_000 });

  await dialog.getByRole('button', { name: '+ Add invite note' }).click();
  const noteInput = dialog.getByLabel('Optional invite message');
  await noteInput.focus();

  await page.evaluate(([visible, top]) => window.__setKeyboardViewport?.(visible, top, 'resize'), [
    KEYBOARD_HEIGHT,
    KEYBOARD_OFFSET_TOP,
  ] as const);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
    )
    .toBe(`${KEYBOARD_HEIGHT}px`);

  const bounds = await box(dialog);
  expect(bounds.y).toBeGreaterThanOrEqual(KEYBOARD_OFFSET_TOP - 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(KEYBOARD_OFFSET_TOP + KEYBOARD_HEIGHT + 1);
  // Focused invite note must scroll back into view when the keyboard shrinks the body.
  await expect
    .poll(async () => {
      const noteBounds = await box(noteInput);
      return (
        noteBounds.y >= bounds.y - 1 &&
        noteBounds.y + noteBounds.height <= bounds.y + bounds.height + 1
      );
    })
    .toBe(true);

  await page.evaluate(
    (fullHeight) => window.__setKeyboardViewport?.(fullHeight, 0, 'resize'),
    PHONE.height
  );
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeHidden();
};

const checkInviteRetryNoteAndGrant = async (page: Page, seeded: Seed) => {
  await page.setViewportSize(DESKTOP);
  const dialog = await openInvite(page, seeded);
  await expect(dialog.locator('li')).toHaveCount(8, { timeout: 30_000 });

  // Add an invite note, simulate one transient invite failure, then Retry and succeed.
  await dialog.locator('button[aria-expanded]').click();
  const noteField = dialog.getByPlaceholder('Add a note to your invite...');
  await noteField.fill('Welcome to the studio');

  let failOnce = true;
  await page.route('**/invite', (route) => {
    if (failOnce) {
      failOnce = false;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ errcode: 'M_UNKNOWN', error: 'Temporary failure' }),
      });
    }
    return route.continue();
  });

  const aliceBtn = rowByName(dialog, 'Alice Adams').getByRole('button');
  await aliceBtn.click();
  await expect(aliceBtn).toContainText('Retry', { timeout: 15_000 });
  await aliceBtn.click();
  await expect(aliceBtn).toContainText('Invited', { timeout: 15_000 });

  // Invite agent with moderator checkbox enabled; verify invite succeeds.
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  const helperBtn = rowByName(dialog, 'Helper agent').getByRole('button');
  await helperBtn.click();
  await expect(helperBtn).toContainText('Invited', { timeout: 15_000 });

  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeHidden();
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
    await checkUnlistedId(dialog);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.setViewportSize(DESKTOP);
    dialog = await openInvite(page, seeded);
    await search(dialog);
    await checkDesktopFraming(dialog);
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
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  expect(inset[1]).toBeCloseTo(inset[0] ?? Number.NaN, 0);

  await page.evaluate(() => document.documentElement.setAttribute('dir', 'ltr'));
  await checkInviteRetryNoteAndGrant(page, seeded);
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
