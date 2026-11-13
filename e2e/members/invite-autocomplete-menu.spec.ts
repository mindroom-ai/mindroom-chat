import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, joinRoom, matrixFetch } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// The people suggestions under the invite dialog's search field: the floating layer lets the
// pointer through to the dialog, a row is 56 px until its text wraps and keeps its avatar beside
// the first line, a long Matrix ID wraps inside a 320 px menu, the menu mirrors right to left, and
// a list opened while the dialog slides in moves with it.
// Checked with classic scrollbars in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set INVITE_MENU_SHOTS=<directory> to also save screenshots of the
// open menu in the light and dark themes, on a phone and on a desktop.
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.INVITE_MENU_SHOTS;
const PASSWORD = 'invite-autocomplete-menu-spec-password';
/** Every suggested account's Matrix ID holds it, so one search lists them all. */
const QUERY = 'team';
/**
 * The dialog keeps 16 px from each viewport edge, has a 1 px rim and pads its form by 16 px, so
 * the search field and the menu under it are 320 px wide.
 */
const PHONE = { width: 386, height: 720 };
const DESKTOP = { width: 1180, height: 760 };
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

/**
 * A reader with a room to invite into, and eight people who share another room with the reader
 * (the user directory lists those): six with short names or one that wraps, and a helper whose
 * Matrix ID is 60 characters long.
 */
const seed = async (engine: string): Promise<Seed> => {
  // Short, so that a short name's Matrix ID fits on one line whatever its letters' widths.
  const run = `${engine.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  const username = `invite_menu_${run}`;
  const reader = await register(username, 'Robin Reader');
  const server = reader.userId.slice(reader.userId.indexOf(':') + 1);
  // `@`, the localpart, `:` and the server name.
  const longLocalpart = `${QUERY}_helper_agent_${run}_research_assistant_workspace`.slice(
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

/** Searches the directory for this run's accounts only, whatever else the homeserver holds. */
const scopeDirectory = (page: Page, run: string) =>
  page.route('**/user_directory/search', (route) =>
    route.continue({
      postData: JSON.stringify({
        ...(route.request().postDataJSON() as Record<string, unknown>),
        search_term: run,
      }),
    })
  );

/** Writes the stored theme, which the app reads when it starts, and starts it again. */
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

/** Opens the invite dialog from the room's entry in the room list. */
const openInvite = async (page: Page, seeded: Seed) => {
  const entry = page.locator('a[href^="/home/"]').filter({ hasText: seeded.roomName }).first();
  await expect(entry).toBeVisible({ timeout: 60_000 });
  await entry.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Invite', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Invite', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
};

/** Types the search and waits for all eight suggestions. */
const search = async (dialog: Locator) => {
  const field = dialog.getByRole('combobox');
  await field.fill(QUERY);
  const menu = dialog.page().getByRole('listbox', { name: 'Invite user suggestions' });
  await expect(menu.getByRole('option')).toHaveCount(8, { timeout: 30_000 });
  await expect(menu.locator('header')).toHaveText('8 matching users');
  // Away from the rows, which a resting pointer would fill.
  await dialog.page().mouse.move(1, 1);
  return { field, menu };
};

const box = async (locator: Locator): Promise<Box> => {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('The element has no box');
  return bounds;
};

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A suggestion row's parts: the avatar first, then the name over the Matrix ID. */
const rowParts = (row: Locator) => {
  const identity = row.locator(':scope > :last-child');
  return {
    avatar: row.locator(':scope > :first-child'),
    identity,
    name: identity.locator(':scope > :first-child'),
    id: identity.locator(':scope > :last-child'),
  };
};

/** How many lines an element's text takes. */
const lines = (locator: Locator) =>
  locator.evaluate((element) => {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    return Math.round(element.getBoundingClientRect().height / lineHeight);
  });

/** How far an element's content reaches past its box, sideways. */
const sidewaysOverflow = (locator: Locator) =>
  locator.evaluate((element) => element.scrollWidth - element.clientWidth);

const option = (menu: Locator, name: string) =>
  menu.getByRole('option', { name: new RegExp(`^${name}, @`) });

const checkRows = async (menu: Locator, seeded: Seed) => {
  expect(Math.round((await box(menu)).width)).toBe(320);

  // A name and a Matrix ID of one line each: 56 px, avatar at the top beside them.
  const plain = option(menu, 'Eli Brandt');
  await plain.scrollIntoViewIfNeeded();
  const plainParts = rowParts(plain);
  expect(await lines(plainParts.name)).toBe(1);
  expect(await lines(plainParts.id)).toBe(1);
  const plainRow = await box(plain);
  expect(Math.round(plainRow.height)).toBe(56);
  expect(Math.round((await box(plainParts.avatar)).y - plainRow.y)).toBe(8);

  // A name that wraps makes the row taller; the avatar stays beside its first line.
  const wrapped = option(menu, WRAPPING_NAME);
  await wrapped.scrollIntoViewIfNeeded();
  const wrappedParts = rowParts(wrapped);
  const wrappedRow = await box(wrapped);
  expect(await lines(wrappedParts.name)).toBeGreaterThan(1);
  expect(wrappedRow.height).toBeGreaterThan(56);
  expect(Math.round((await box(wrappedParts.avatar)).y - wrappedRow.y)).toBe(8);
  await expect(wrappedParts.name).toHaveText(WRAPPING_NAME);

  // The 60-character Matrix ID wraps whole inside the row instead of widening it.
  expect(seeded.longId).toHaveLength(LONG_ID_LENGTH);
  const helper = option(menu, 'Helper agent');
  await helper.scrollIntoViewIfNeeded();
  const helperParts = rowParts(helper);
  await expect(helperParts.id).toHaveText(seeded.longId);
  expect(await lines(helperParts.id)).toBeGreaterThan(1);
  for (const part of [helper, helperParts.identity, helperParts.id]) {
    expect(await sidewaysOverflow(part)).toBeLessThanOrEqual(0);
  }
  const helperRow = await box(helper);
  const helperId = await box(helperParts.id);
  expect(helperId.x).toBeGreaterThanOrEqual(helperRow.x);
  expect(helperId.x + helperId.width).toBeLessThanOrEqual(helperRow.x + helperRow.width);

  // The suggestion Enter would pick is filled; the others stay clear.
  const fill = (row: Locator) =>
    row.evaluate((element) => getComputedStyle(element).backgroundColor);
  const rows = menu.getByRole('option');
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  expect(await fill(rows.first())).not.toBe('rgba(0, 0, 0, 0)');
  expect(await fill(rows.nth(1))).toBe('rgba(0, 0, 0, 0)');
  await menu.evaluate((element) => {
    element.querySelector('[data-y-scrollbar-width]')?.scrollTo({ top: 0 });
  });
};

/** Clicks reach the field and the dialog's own controls through the floating layer. */
const checkClickThrough = async (dialog: Locator, field: Locator, menu: Locator) => {
  // Playwright clicks only when the target, not something over it, is under the pointer.
  await field.click({ position: { x: 12, y: 12 } });
  await expect(field).toBeFocused();
  await expect(menu).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  expect(overlaps(await box(close), await box(menu))).toBe(false);
  await close.click();
  await expect(dialog).toBeHidden();
};

/** Right to left, the header's text starts 12 px from its right edge and the avatar leads. */
const checkMirrored = async (menu: Locator, rightToLeft: boolean) => {
  const header = menu.locator('header');
  const headerBox = await box(header);
  const count = await box(header.getByText('8 matching users'));
  const startGap = rightToLeft
    ? headerBox.x + headerBox.width - (count.x + count.width)
    : count.x - headerBox.x;
  expect(Math.round(startGap)).toBe(12);
  const row = option(menu, 'Alice Adams');
  const parts = rowParts(row);
  const rowBox = await box(row);
  const avatar = await box(parts.avatar);
  const identity = await box(parts.identity);
  if (rightToLeft) {
    expect(avatar.x).toBeGreaterThan(identity.x);
    return rowBox.x + rowBox.width - (avatar.x + avatar.width);
  }
  expect(avatar.x).toBeLessThan(identity.x);
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

  await checkSlide(page, seeded, engine);

  for (const theme of THEMES) {
    await switchTheme(page, theme);
    await page.setViewportSize(PHONE);
    let dialog = await openInvite(page, seeded);
    let { field, menu } = await search(dialog);
    await checkRows(menu, seeded);
    await shoot(page, `${engine}-${theme}-phone`);
    await checkClickThrough(dialog, field, menu);

    await page.setViewportSize(DESKTOP);
    dialog = await openInvite(page, seeded);
    ({ field, menu } = await search(dialog));
    await shoot(page, `${engine}-${theme}-desktop`);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }

  await page.setViewportSize(PHONE);
  const inset: number[] = [];
  for (const rightToLeft of [false, true]) {
    await page.evaluate(
      (dir) => document.documentElement.setAttribute('dir', dir),
      rightToLeft ? 'rtl' : 'ltr'
    );
    const dialog = await openInvite(page, seeded);
    const { menu } = await search(dialog);
    inset.push(await checkMirrored(menu, rightToLeft));
    if (rightToLeft) await shoot(page, `${engine}-dark-theme-phone-rtl`);
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  // The avatar sits as far from the row's start edge either way.
  expect(inset[1]).toBeCloseTo(inset[0] ?? Number.NaN, 0);
};

type SlideSample = { field: number; list: number | undefined };

/**
 * Opens the invite dialog and types into its search field on the first frame it shows, while the
 * dialog still slides in. After each frame it records the bottom of the field and the top of the
 * list, for as long as the list shows in the first 600 ms; then it closes the dialog.
 */
const slideSamples = async (page: Page, seeded: Seed) => {
  const entry = page.locator('a[href^="/home/"]').filter({ hasText: seeded.roomName }).first();
  await expect(entry).toBeVisible({ timeout: 60_000 });
  await entry.click({ button: 'right' });
  const invite = page.getByRole('menuitem', { name: 'Invite', exact: true }).first();
  await expect(invite).toBeVisible();
  await page.evaluate(() => {
    const samples: SlideSample[] = [];
    Object.assign(window, { slideSamples: samples });
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    let typedAt: number | undefined;
    const tick = (now: number) => {
      const field = document.querySelector<HTMLInputElement>('[role="dialog"] [role="combobox"]');
      if (field && typedAt === undefined) {
        typedAt = now;
        field.focus();
        setValue?.call(field, 't');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // After the frame's own callbacks, the list's included.
      setTimeout(() => {
        if (!field) return;
        const list = document.querySelector(
          '[role="listbox"][aria-label="Invite user suggestions"]'
        );
        samples.push({
          field: field.getBoundingClientRect().bottom,
          list: list?.getBoundingClientRect().top,
        });
      }, 0);
      if (typedAt === undefined || now - typedAt < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await invite.click();
  const dialog = page.getByRole('dialog', { name: 'Invite', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveValue('t');
  await page.waitForTimeout(1_000);
  const samples = await page.evaluate(
    () => (window as unknown as { slideSamples: SlideSample[] }).slideSamples
  );
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  return samples.filter(
    (sample): sample is { field: number; list: number } => sample.list !== undefined
  );
};

/**
 * The list keeps one distance from the field while the dialog slides in: it moves with the
 * dialog instead of staying where it opened and snapping into place when the slide ends.
 */
const checkSlide = async (page: Page, seeded: Seed, engine: string) => {
  await page.setViewportSize(PHONE);
  let shown: Array<{ field: number; list: number }> = [];
  // The check needs a list that opened with at least 2 px of the slide left. A loaded machine
  // may draw the dialog's first frames late, so it tries up to four openings.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    shown = await slideSamples(page, seeded);
    const fields = shown.map((sample) => sample.field);
    console.log(`${engine} slide ${attempt}: ${JSON.stringify(shown)}`);
    if (shown.length > 1 && Math.max(...fields) - Math.min(...fields) > 2) break;
  }
  const fields = shown.map((sample) => sample.field);
  expect(
    Math.max(...fields) - Math.min(...fields),
    `${engine}: the list opened while the field still slid`
  ).toBeGreaterThan(2);
  // A sample reads the field a moment after the list last measured it, so the distance may
  // differ by part of a frame's motion. A list left behind by the slide is 2 to 5 px off.
  const gaps = shown.map((sample) => sample.list - sample.field);
  expect(
    Math.max(...gaps) - Math.min(...gaps),
    `${engine}: the list keeps its distance from the field (${gaps.join(', ')})`
  ).toBeLessThan(1.5);
};

test('the invite suggestions float over the dialog and keep long identities whole (Chromium)', async ({
  page,
}) => {
  await exercise(page, 'chromium');
});

test('the invite suggestions float over the dialog and keep long identities whole (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: PHONE, baseURL });
    await exercise(await context.newPage(), 'webkit');
  } finally {
    await browser.close();
  }
});
