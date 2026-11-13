import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The composer's suggestion menus (mentions, emoji, commands) show which row Enter picks: they
// are listboxes, the row Enter or Tab would take is the selected option and is highlighted, and
// while the caret stays in the composer the composer names that row as its active descendant.
// Once the arrow keys move into the rows, the selection follows focus. Desktop and phone,
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit, against the
// disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'autocomplete-active-row-spec-password';
const RUN = Date.now().toString(36);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = async (localpart: string, displayName: string) => {
  const username = `aar_${localpart}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { ...session, username };
};

const selected = (listbox: Locator) =>
  listbox
    .getByRole('option')
    .evaluateAll((options) => options.map((option) => option.getAttribute('aria-selected')));

/** The first row is selected, named by the composer and highlighted against the second. */
const firstRowIsActive = async (page: Page, kind: string) => {
  const listbox = page.getByRole('listbox');
  await expect(listbox, `${kind}: a listbox`).toBeVisible({ timeout: 20_000 });
  const options = listbox.getByRole('option');
  expect(await options.count(), `${kind}: options`).toBeGreaterThan(1);
  const states = await selected(listbox);
  expect(states[0], `${kind}: first selected`).toBe('true');
  expect(states.slice(1).every((state) => state === 'false'), `${kind}: only the first`).toBe(true);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  const firstId = await options.first().getAttribute('id');
  expect(firstId, `${kind}: option id`).toBeTruthy();
  await expect(composer, `${kind}: active descendant`).toHaveAttribute(
    'aria-activedescendant',
    firstId!
  );
  const background = (option: Locator) =>
    option.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await background(options.first()), `${kind}: highlighted`).not.toBe(
    await background(options.nth(1))
  );
};

const clearComposer = async (page: Page) => {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  for (let index = 0; index < 8; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Backspace');
  }
};

const activeRowShows = async (page: Page, name: string, keyboard: boolean) => {
  const reader = await register(`${name}_reader`, 'Robin Reader');
  const first = await register(`${name}_wren`, 'Wren Writer');
  const second = await register(`${name}_wynn`, 'Wynn Walker');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Harbor desk ${name} ${RUN}`,
    invite: [first.userId, second.userId],
  });
  await joinRoom(HOMESERVER, first.accessToken, roomId);
  await joinRoom(HOMESERVER, second.accessToken, roomId);

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await composer.click();

  await page.keyboard.type('@W');
  await firstRowIsActive(page, 'mentions');
  if (keyboard) {
    // The arrow keys go into the rows; the selection follows focus.
    const listbox = page.getByRole('listbox');
    const selectedRow = async () => (await selected(listbox)).indexOf('true');
    const selectedRows = async () => (await selected(listbox)).filter((s) => s === 'true').length;
    await page.keyboard.press('ArrowDown');
    await expect.poll(selectedRow).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect.poll(selectedRow).toBe(1);
    expect(await selectedRows()).toBe(1);
    await expect(listbox.getByRole('option').nth(1)).toBeFocused();
    await composer.click();
  }
  await clearComposer(page);

  await page.keyboard.type(':smi');
  await firstRowIsActive(page, 'emoji');
  await clearComposer(page);

  await page.keyboard.type('/');
  await firstRowIsActive(page, 'commands');
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'the suggestion menus show and name the row Enter picks';

for (const phone of [false, true]) {
  const device = phone ? 'phone' : 'desktop';
  const viewport = phone ? PHONE : DESKTOP;
  test(`${TITLE} (Chromium, ${device})`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport, hasTouch: phone, baseURL });
    try {
      await activeRowShows(await context.newPage(), `c${device[0]}`, !phone);
    } finally {
      await context.close();
    }
  });

  test(`${TITLE} (WebKit, ${device})`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    let own: Browser | undefined;
    try {
      own = await launchWebKit();
      const context = await own.newContext({ viewport, hasTouch: phone, baseURL });
      await activeRowShows(await context.newPage(), `w${device[0]}`, !phone);
    } finally {
      await own?.close();
    }
  });
}
