import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// On a phone (390 by 844, touch) the composer row is "More actions", "Record voice message", the
// text box and "Send message"; "More actions" opens a menu with Attach files, Formatting and
// Emoji, each of which works from there, and Escape gives focus back to "More actions". Every
// control of the row and of the menu takes at least 44 px to a finger. A desktop (1280 by 800)
// keeps its five buttons and no menu. Checked in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit. Set PHONE_COMPOSER_SHOTS=<directory> to save the composer
// in light and dark, closed and with the menu open.
const PASSWORD = 'phone-composer-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.PHONE_COMPOSER_SHOTS;
const TARGET = 44;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const MESSAGES = [
  'Which checks still block the launch on Thursday?',
  'The load test passed at 2,100 requests per second, well above the target we set last week.',
  'Security review signs off on Thursday once the token rotation lands.',
  'The API page needs one more pass before the docs ship; two examples still use the old field.',
] as const;
const PHONE_ROW = ['More actions', 'Record voice message', 'Send message'];
const DESKTOP_ROW = ['Attach files', 'Record voice message', 'Formatting', 'Emoji', 'Send message'];
const MENU = ['Attach files', 'Formatting', 'Emoji'];

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`pcm_${name}_${RUN}`, PASSWORD);

/** 25 other rooms, and one room with a short conversation. */
const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, { name: 'Launch planning' });
  for (const body of MESSAGES) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, { msgtype: 'm.text', body });
  }
  return { reader, roomId };
};

type World = Awaited<ReturnType<typeof seed>>;

const openRoom = async (page: Page, world: World) => {
  await page.evaluate((to) => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}`);
  await expect(page.getByText(MESSAGES[3], { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
};

const button = (scope: Page | Locator, name: string) =>
  scope.getByRole('button', { name, exact: true });

const textBox = (page: Page) => page.locator('[data-editable-name="RoomInput"]');

/** The bottom of the screen, where the composer is, reaching up to `extra` when it is given. */
const shot = async (page: Page, name: string, extra?: Locator) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const viewport = page.viewportSize();
  if (!viewport) return;
  const box = extra ? await extra.boundingBox() : null;
  const top = Math.max(0, Math.min(viewport.height - 240, (box?.y ?? viewport.height) - 12));
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    clip: { x: 0, y: top, width: viewport.width, height: viewport.height - top },
  });
};

/** The controls beside the text box, left to right, and the width of the text box's column. */
const composerRow = async (page: Page) =>
  textBox(page).evaluate((editable) => {
    // The row is the text box's nearest ancestor that also holds Send; its child holding the text
    // box is the scrolling column the text takes.
    let row: Element | null = editable;
    while (row && !row.querySelector('button[aria-label="Send message"]')) row = row.parentElement;
    if (!row) return { names: [], textWidth: 0 };
    const column = [...row.children].find((child) => child.contains(editable)) ?? editable;
    const text = editable.getBoundingClientRect();
    // Only the row's own controls: on the text box's line, not the model picker above it.
    const buttons = [...row.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
      .map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.top < text.bottom && rect.bottom > text.top)
      .sort((a, b) => a.rect.left - b.rect.left);
    return {
      names: buttons.map(({ candidate }) => candidate.getAttribute('aria-label') ?? ''),
      textWidth: column.getBoundingClientRect().width,
    };
  });

/** Taps 1 px inside the 44 px square around a control's centre, at its four edges. */
const hitArea = async (target: Locator) =>
  target.evaluate((element, size) => {
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const half = Math.max(size, rect.height) / 2 - 1;
    const owner = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest('button, [role^="menuitem"]') === element;
    return {
      top: owner(cx, cy - half),
      bottom: owner(cx, cy + half),
      // Along the row, the reach stops halfway to the next control (4 px gaps).
      start: owner(rect.left + 1, cy),
      end: owner(rect.right - 1, cy),
      height: rect.height,
    };
  }, TARGET);

const expectTall = async (target: Locator, what: string) => {
  const area = await hitArea(target);
  expect
    .soft(area, `${what}: 44 px tall to a finger`)
    .toEqual({ top: true, bottom: true, start: true, end: true, height: area.height });
};

const tap = async (page: Page, target: Locator) => {
  const at = await target.boundingBox();
  if (!at) throw new Error('nothing to tap');
  await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
};

const openMenu = async (page: Page) => {
  const more = button(page, 'More actions');
  await tap(page, more);
  const menu = page.getByRole('menu', { name: 'More actions' });
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  return menu;
};

const checkPhone = async (page: Page, world: World, engine: string) => {
  await openRoom(page, world);
  // Shot before any assertion, so a run without the menu still records how the row looks.
  await shot(page, `phone-${engine}-light`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await shot(page, `phone-${engine}-dark`);
  const row = await composerRow(page);
  console.log(`${engine} phone row: ${JSON.stringify(row)}`);
  expect(row.names, `${engine}: the phone row is More actions, voice, text, Send`).toEqual(
    PHONE_ROW
  );
  // About 140 px with five buttons; the two that move into the menu give back about 72 px.
  expect(row.textWidth, `${engine}: the text box gets the freed width`).toBeGreaterThan(200);
  for (const name of PHONE_ROW) {
    // eslint-disable-next-line no-await-in-loop
    await expectTall(button(page, name), `${engine} ${name}`);
  }

  // The menu: three entries, each 44 px tall; Escape closes it and focus is on More actions.
  const more = button(page, 'More actions');
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  let menu = await openMenu(page);
  await expect(menu.locator('[role^="menuitem"]')).toHaveText(MENU);
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Formatting' })).toHaveAttribute(
    'aria-checked',
    'false'
  );
  for (const name of MENU) {
    // eslint-disable-next-line no-await-in-loop
    await expectTall(menu.locator('[role^="menuitem"]', { hasText: name }), `${engine} ${name}`);
  }
  await shot(page, `phone-${engine}-dark-menu`, menu);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await shot(page, `phone-${engine}-light-menu`, menu);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // A second tap on More actions closes the menu it opened, and it stays closed; so does a tap at
  // the top of the button's 44 px touch area, past the button's own box. The next tap opens it.
  menu = await openMenu(page);
  await tap(page, more);
  await expect(menu).toBeHidden();
  await page.waitForTimeout(500);
  await expect(menu).toBeHidden();
  menu = await openMenu(page);
  const at = await more.boundingBox();
  if (!at) throw new Error('nothing to tap');
  await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2 - (TARGET / 2 - 1));
  await expect(menu).toBeHidden();
  await page.waitForTimeout(500);
  await expect(menu).toBeHidden();

  // Formatting shows the toolbar and, chosen again, hides it.
  menu = await openMenu(page);
  await tap(page, menu.getByRole('menuitemcheckbox', { name: 'Formatting' }));
  await expect(menu).toBeHidden();
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await expect(toolbar).toBeVisible();
  expect((await composerRow(page)).names, `${engine}: the row stays as it was`).toEqual(PHONE_ROW);
  await shot(page, `phone-${engine}-light-formatting`);
  menu = await openMenu(page);
  const formatting = menu.getByRole('menuitemcheckbox', { name: 'Formatting' });
  await expect(formatting).toHaveAttribute('aria-checked', 'true');
  await tap(page, formatting);
  await expect(toolbar).toBeHidden();

  // Emoji opens the emoji board; an emoji lands in the text box.
  menu = await openMenu(page);
  await tap(page, menu.getByRole('menuitem', { name: 'Emoji' }));
  await expect(menu).toBeHidden();
  const emoji = page.locator('button[data-emoji-type="emoji"]').first();
  await expect(emoji).toBeVisible();
  await shot(page, `phone-${engine}-light-emoji`, emoji);
  const character = await emoji.getAttribute('data-emoji-data');
  await tap(page, emoji);
  await expect(textBox(page)).toContainText(character ?? '');
  await page.keyboard.press('Escape');
  await expect(emoji).toBeHidden();

  // Attach files opens the file picker; the picked file is staged above the composer.
  menu = await openMenu(page);
  const chooser = page.waitForEvent('filechooser');
  await tap(page, menu.getByRole('menuitem', { name: 'Attach files' }));
  await (
    await chooser
  ).setFiles({
    name: 'launch-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Launch checklist: load test, security review, API page.\n'),
  });
  await expect(menu).toBeHidden();
  await expect(page.getByText('launch-notes.txt').first()).toBeVisible();
};

const checkDesktop = async (page: Page, world: World, engine: string) => {
  await openRoom(page, world);
  const row = await composerRow(page);
  console.log(`${engine} desktop row: ${JSON.stringify(row)}`);
  expect(row.names, `${engine}: the desktop row keeps its five buttons`).toEqual(DESKTOP_ROW);
  await expect(button(page, 'More actions')).toHaveCount(0);
  await button(page, 'Formatting').click();
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
};

/**
 * A page in a new context. Chromium on macOS now and then starts a touch context without its touch
 * emulation (no touch points, a pointer that hovers); such a context is replaced, twice at most.
 */
const newPage = async (browser: Browser, options: BrowserContextOptions) => {
  const attempts = options.hasTouch ? 3 : 1;
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext(options);
    // eslint-disable-next-line no-await-in-loop
    const page = await context.newPage();
    // eslint-disable-next-line no-await-in-loop
    if (await page.evaluate(() => matchMedia('(hover: none)').matches)) return { context, page };
    console.log(`context ${attempt} started without touch emulation; replacing it`);
    // eslint-disable-next-line no-await-in-loop
    await context.close();
  }
  const context = await browser.newContext(options);
  return { context, page: await context.newPage() };
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  const signIn = async (options: BrowserContextOptions) => {
    const { context, page } = await newPage(browser, { ...options, baseURL });
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    return { context, page };
  };
  const phone = await signIn(PHONE);
  try {
    await checkPhone(phone.page, world, engine);
  } finally {
    await phone.context.close();
  }
  const desktop = await signIn(DESKTOP);
  try {
    await checkDesktop(desktop.page, world, engine);
  } finally {
    await desktop.context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the phone composer keeps voice and Send and moves the rest into a menu (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('the phone composer keeps voice and Send and moves the rest into a menu (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
