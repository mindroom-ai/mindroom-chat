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
// inside Safari's visual viewport when the virtual keyboard shrinks the screen: on a phone held
// upright and on one held sideways, which is as wide as a tablet. Where that leaves too little
// height to keep the search and the footer in place around the rows, they scroll together. The
// moderator checkbox sits above the first row at every height, never in the footer.
// Checked with classic scrollbars in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set INVITE_MENU_SHOTS=<directory> to save screenshots.
const SHOTS = process.env.INVITE_MENU_SHOTS;
const PASSWORD = 'invite-autocomplete-menu-spec-password';
/** Every suggested account's Matrix ID holds it, so one search lists them all. */
const QUERY = 'team';
const PHONE = { width: 386, height: 720 };
const LANDSCAPE_PHONE = { width: 844, height: 390 };
const DESKTOP = { width: 1180, height: 760 };
/** What the keyboard leaves of an upright phone with the note open, and of one held sideways. */
const SHORT_PORTRAIT_HEIGHT = 280;
const SHORT_LANDSCAPE_HEIGHT = 240;
/** How far Safari pans the visual viewport down the page in the sideways check. */
const LANDSCAPE_OFFSET_TOP = 60;
const LONG_ID_LENGTH = 60;
/** In no directory, so its row has the ID for a name. */
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

// An ID no directory lists is its row's only name: it wraps whole on a phone, like a listed ID.
const checkUnlistedId = async (dialog: Locator) => {
  await dialog.getByRole('searchbox').fill(UNLISTED_ID);
  const row = dialog.locator('li').filter({ hasText: 'External Matrix ID' });
  await expect(row).toHaveCount(1);
  const name = row.getByText(UNLISTED_ID, { exact: true });
  await expect(name).toBeVisible();
  expect(await lines(name)).toBeGreaterThan(1);
  expect(await sidewaysOverflow(name)).toBeLessThanOrEqual(0);
  expect(await sidewaysOverflow(row)).toBeLessThanOrEqual(0);
  const dialogBox = await box(dialog);
  const rowBox = await box(row);
  expect(rowBox.x).toBeGreaterThanOrEqual(dialogBox.x);
  expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
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

/** Shrinks the visual viewport to `height` at `offsetTop`, as a keyboard does; undefined ends it. */
const setKeyboardViewport = async (
  page: Page,
  height: number | undefined,
  offsetTop = 0
): Promise<void> => {
  const fullHeight = page.viewportSize()?.height ?? PHONE.height;
  await page.evaluate(
    ([visible, top]) => {
      window.__setKeyboardViewport?.(visible, top, 'resize');
    },
    [height ?? fullHeight, offsetTop] as const
  );
  const appHeight = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'));
  await expect.poll(appHeight).toBe(height === undefined ? '' : `${height}px`);
};

type Viewport = { top: number; height: number };

const expectInside = (bounds: Box, viewport: Viewport) => {
  expect(bounds.y).toBeGreaterThanOrEqual(viewport.top - 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.top + viewport.height + 1);
};

/**
 * Where it is, without the test scrolling to it, the element lies inside the visual viewport and
 * nothing lies over its middle. It may get there a moment after the viewport changed. Only a
 * scroll the user could make counts: a script can also scroll a box that hides its overflow.
 */
const expectInSight = async (locator: Locator, viewport: Viewport) => {
  await expect
    .poll(async () => {
      const bounds = await box(locator);
      return (
        bounds.y >= viewport.top - 1 &&
        bounds.y + bounds.height <= viewport.top + viewport.height + 1
      );
    })
    .toBe(true);
  const reached = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    let scrolledHiddenOverflow = false;
    for (
      let ancestor = element.parentElement;
      ancestor && ancestor !== document.body;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor.scrollTop !== 0 && !/auto|scroll/.test(getComputedStyle(ancestor).overflowY)) {
        scrolledHiddenOverflow = true;
      }
    }
    return {
      uncovered: top !== null && (element.contains(top) || top.contains(element)),
      scrolledHiddenOverflow,
    };
  });
  expect(reached).toEqual({ uncovered: true, scrolledHiddenOverflow: false });
};

/** Scrolled to, the element is in sight. */
const expectReachable = async (locator: Locator, viewport: Viewport) => {
  await locator.scrollIntoViewIfNeeded();
  await expectInSight(locator, viewport);
};

/** What scrolls together with the rows: on a tall viewport nothing, on a short one all but the title. */
const scrollsWithRows = (dialog: Locator) =>
  dialog
    .locator('li')
    .first()
    .evaluate((row) => {
      let scroller = row.parentElement;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      return {
        search: Boolean(scroller?.querySelector('input[type="search"]')),
        footer: Boolean(scroller?.querySelector('button[aria-expanded]')),
        title: Boolean(scroller?.querySelector('h2')),
      };
    });

/** Puts what scrolls the rows back at its top, where it is when the sheet opens. */
const scrollSheetToTop = (dialog: Locator) =>
  dialog
    .locator('li')
    .first()
    .evaluate((row) => {
      let scroller = row.parentElement;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      if (!scroller) throw new Error('Nothing scrolls the rows');
      scroller.scrollTop = 0;
    });

const sheetParts = (dialog: Locator) => ({
  done: dialog.getByRole('button', { name: 'Done', exact: true }),
  search: dialog.getByRole('searchbox'),
  rows: dialog.locator('li'),
  note: dialog.getByPlaceholder('Add a note to your invite...'),
  noteToggle: dialog.locator('button[aria-expanded]'),
  moderator: dialog.getByText(/^Give invited agents .+ rights$/),
  moderatorCheckbox: dialog.getByRole('checkbox'),
});

/**
 * The moderator checkbox, on by default, comes before the first row on the screen and in the
 * page, and the footer does not hold it: nobody reaches an Invite button without passing it.
 */
const checkModeratorAboveRows = async (dialog: Locator) => {
  const parts = sheetParts(dialog);
  await expect(parts.moderatorCheckbox).toBeChecked();
  const label = await box(parts.moderator);
  const firstAction = await box(parts.rows.first().getByRole('button'));
  expect(label.y + label.height).toBeLessThanOrEqual(firstAction.y);
  const placement = await parts.moderatorCheckbox.evaluate((checkbox) => {
    const sheet = checkbox.closest('[role="dialog"]');
    const firstRow = sheet?.querySelector('li');
    const noteToggle = sheet?.querySelector('button[aria-expanded]');
    return {
      beforeFirstRow: Boolean(
        firstRow && checkbox.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
      inFooter: Boolean(noteToggle?.parentElement?.contains(checkbox)),
    };
  });
  expect(placement).toEqual({ beforeFirstRow: true, inFooter: false });
};

const checkEveryPartReachable = async (dialog: Locator, viewport: Viewport) => {
  const parts = sheetParts(dialog);
  expectInside(await box(dialog), viewport);
  // The title bar stays in place; everything below it scrolls as one.
  expect(await scrollsWithRows(dialog)).toEqual({ search: true, footer: true, title: false });
  expectInside(await box(parts.done), viewport);
  await checkModeratorAboveRows(dialog);
  // At the top of what scrolls, as the sheet opens, the checkbox is in sight already: nothing
  // here scrolls to it.
  await scrollSheetToTop(dialog);
  await expectInSight(parts.moderator, viewport);
  await expectReachable(parts.rows.first().getByRole('button'), viewport);
  await expectReachable(parts.rows.last().getByRole('button'), viewport);
  await expectReachable(parts.note, viewport);
  await expectReachable(parts.moderator, viewport);
  await expectReachable(parts.noteToggle, viewport);
  await expectReachable(parts.search, viewport);
  expectInside(await box(dialog), viewport);
};

// A phone held upright: the sheet fills the screen, and with the keyboard up only the visual
// viewport is left of it.
const checkPhoneKeyboardViewport = async (page: Page, seeded: Seed) => {
  await page.setViewportSize(PHONE);
  const dialog = await openInvite(page, seeded);
  const parts = sheetParts(dialog);
  await expect(parts.rows).toHaveCount(8, { timeout: 30_000 });

  // Tall enough: the search and the footer stay in place and only the rows scroll.
  expect(await scrollsWithRows(dialog)).toEqual({ search: false, footer: false, title: false });
  expectInside(await box(parts.noteToggle), { top: 0, height: PHONE.height });
  // The moderator checkbox stays in place above the rows, with the search and the filters.
  await expectInSight(parts.moderator, { top: 0, height: PHONE.height });
  await checkModeratorAboveRows(dialog);

  await parts.noteToggle.click();
  await parts.note.focus();
  await setKeyboardViewport(page, SHORT_PORTRAIT_HEIGHT);

  const viewport = { top: 0, height: SHORT_PORTRAIT_HEIGHT };
  // The focused note field is where the user types: the sheet itself keeps it above the
  // keyboard, at the foot of what now scrolls as one, before anything here scrolls to it.
  await expect(parts.note).toBeFocused();
  await expectInSight(parts.note, viewport);
  await checkEveryPartReachable(dialog, viewport);
  await shoot(page, 'phone-keyboard-short');

  await setKeyboardViewport(page, undefined);
  expect(await scrollsWithRows(dialog)).toEqual({ search: false, footer: false, title: false });
  await parts.done.click();
  await expect(dialog).toBeHidden();
};

// A phone held sideways is as wide as a tablet, so the sheet is a centered dialog there; it still
// has to follow the visual viewport, also where Safari pans it down the page.
const checkLandscapePhoneViewport = async (page: Page, seeded: Seed) => {
  await page.setViewportSize(LANDSCAPE_PHONE);
  const dialog = await openInvite(page, seeded);
  const parts = sheetParts(dialog);
  await expect(parts.rows).toHaveCount(8, { timeout: 30_000 });
  await parts.noteToggle.click();

  // Without a keyboard the screen is already short.
  await checkEveryPartReachable(dialog, { top: 0, height: LANDSCAPE_PHONE.height });

  // The keyboard takes the foot of the screen, where the focused note field was.
  await parts.note.focus();
  await expectInSight(parts.note, { top: 0, height: LANDSCAPE_PHONE.height });
  await setKeyboardViewport(page, SHORT_LANDSCAPE_HEIGHT);
  await expect(parts.note).toBeFocused();
  await expectInSight(parts.note, { top: 0, height: SHORT_LANDSCAPE_HEIGHT });
  await checkEveryPartReachable(dialog, { top: 0, height: SHORT_LANDSCAPE_HEIGHT });
  await shoot(page, 'landscape-keyboard-short');

  await parts.search.focus();
  await setKeyboardViewport(page, SHORT_LANDSCAPE_HEIGHT, LANDSCAPE_OFFSET_TOP);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--app-viewport-offset-top')
      )
    )
    .toBe(`${LANDSCAPE_OFFSET_TOP}px`);
  await checkEveryPartReachable(dialog, {
    top: LANDSCAPE_OFFSET_TOP,
    height: SHORT_LANDSCAPE_HEIGHT,
  });

  await setKeyboardViewport(page, undefined);
  await parts.done.click();
  await expect(dialog).toBeHidden();
};

// No keyboard, so --app-height is unset: the dialog is as tall as its rows need, centered, and
// its footer stays in place.
const checkDesktopFraming = async (page: Page, dialog: Locator) => {
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
  ).toBe('');
  const bounds = await box(dialog);
  expect(bounds.height).toBeGreaterThan(300);
  expect(bounds.height).toBeLessThanOrEqual(640 + 1);
  expect(Math.abs(bounds.y + bounds.height / 2 - DESKTOP.height / 2)).toBeLessThan(2);
  expect(await scrollsWithRows(dialog)).toEqual({ search: false, footer: false, title: false });
  expectInside(await box(sheetParts(dialog).noteToggle), { top: 0, height: DESKTOP.height });
  await checkModeratorAboveRows(dialog);
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
    await shoot(page, `${engine}-${theme}-phone-unlisted`);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.setViewportSize(DESKTOP);
    dialog = await openInvite(page, seeded);
    await search(dialog);
    await checkDesktopFraming(page, dialog);
    await shoot(page, `${engine}-${theme}-desktop`);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await checkPhoneKeyboardViewport(page, seeded);
  await checkLandscapePhoneViewport(page, seeded);

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
