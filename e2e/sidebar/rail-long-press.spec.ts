import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { addRoomToSpace } from '../helpers/matrix';
import {
  PASSWORD,
  PHONE,
  RUN,
  SCHEMES,
  createOtherRooms,
  register,
  setLook,
  withRetry,
} from '../helpers/designChoices';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { touch, type Step } from '../helpers/touch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  CHROMIUM_WITH_SCROLLBARS,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// On a phone (390 by 844, touch) the space rail works as the sidebar's room rows do: a finger
// resting on a space, or on Home or Direct Messages, opens that button's menu beside it (iOS
// fires no contextmenu for a long press), and the button looks pressed while its menu is open; a
// drag of a space starts only when the finger moves on after the long press, a short tap opens
// the space, and a finger that moves at once opens nothing. Three spaces and 24 rooms; light and
// dark; Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. The
// spec sends the touch events itself (`e2e/helpers/touch.ts`). Set RAIL_LONG_PRESS_SHOTS to save
// the screenshots.
const SHOTS = process.env.RAIL_LONG_PRESS_SHOTS;
/** Longer than the 500 ms long press. */
const HOLD_MS = 700;
/** The entries of a space's menu for its creator, who may invite. */
const ENTRIES = ['Mark as Read', 'Invite', 'Copy Link', 'Space Settings'];

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

const seed = async (engine: string) => {
  const id = `${engine}_${RUN}_${randomUUID().slice(0, 6)}`;
  const tester = await register(`rlp_${id}`, 'Robin Tester');
  await createOtherRooms(tester);
  for (const name of ['Field Team', 'Grove', 'Meadow']) {
    // eslint-disable-next-line no-await-in-loop
    const space = await withRetry(() =>
      createRoom(HOMESERVER, tester.token, { name, space: true })
    );
    // eslint-disable-next-line no-await-in-loop
    const roomId = await withRetry(() =>
      createRoom(HOMESERVER, tester.token, { name: `${name} notes` })
    );
    // eslint-disable-next-line no-await-in-loop
    await withRetry(() => addRoomToSpace(HOMESERVER, tester.token, space, roomId));
  }
  return { tester };
};

const rail = (page: Page) => page.getByRole('group', { name: 'Spaces', exact: true });

/** The space IDs of the rail's tabs, top to bottom. */
const railOrder = (page: Page) =>
  rail(page)
    .locator('button[data-id]')
    .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-id') ?? ''));

const tab = (page: Page, spaceId: string) => rail(page).locator(`button[data-id="${spaceId}"]`);

/** The open space menu: the menu that offers Space Settings. */
const spaceMenu = (page: Page) => page.getByRole('menu').filter({ hasText: 'Space Settings' });

const menuEntries = (menu: Locator) =>
  menu.evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .filter((row) => row.closest('[role="menu"]') === element)
      .map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim())
  );

const save = async (page: Page, name: string) => {
  const body = await page.screenshot();
  await test.info().attach(name, { body, contentType: 'image/png' });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  }
};

const expectNoMenu = async (page: Page, where: string) => {
  await page.waitForTimeout(300);
  await expect(spaceMenu(page), `${where}: no menu`).toHaveCount(0);
};

/** A rail button with a menu: what a long press on it opens, and the entries it offers. */
type RailButton = { name: string; button: Locator; menu: Locator; entries: string[] };

const spaceButton = (page: Page, spaceId: string): RailButton => ({
  name: 'space',
  button: tab(page, spaceId),
  menu: spaceMenu(page),
  entries: ENTRIES,
});

/** Home and Direct Messages: their menus mark their rooms as read. */
const sectionButton = (page: Page, label: string): RailButton => ({
  name: label.toLowerCase().replace(/\s+/g, '-'),
  button: page.getByRole('button', { name: label, exact: true }),
  menu: page.getByRole('menu').filter({ hasText: 'Mark as Read' }),
  entries: ['Mark as Read'],
});

/**
 * How a rail button looks engaged (hovered, focused, or pressed with its menu open): its slide
 * toward the content and its entry's indicator.
 */
const look = (button: Locator) =>
  button.evaluate((element) => ({
    slide: getComputedStyle(element).translate,
    indicator: getComputedStyle(element.parentElement ?? element, '::before').transform,
  }));

/**
 * A long press opens the button's menu beside it, and the button looks pressed while the menu is
 * open; the lift opens nothing, and nothing moves.
 */
const checkLongPress = async (page: Page, target: RailButton, tag: string) => {
  const { button, menu, entries } = target;
  const where = `${tag} ${target.name}`;
  const before = await railOrder(page);
  const url = page.url();
  const rest = await look(button);
  const press = await touch(button, [
    { type: 'start' },
    { type: 'wait', ms: 200 },
    { type: 'move', dx: 2, dy: 3 },
    { type: 'wait', ms: HOLD_MS },
    { type: 'end' },
  ]);
  console.log(`${where} long press: ${JSON.stringify(press)}`);
  await page.waitForTimeout(300);
  await save(page, `${tag}-${target.name}-long-press`);
  await expect(menu, `${where}: a long press opens the menu`).toBeVisible();
  expect(await menuEntries(menu), `${where}: the menu's entries`).toEqual(entries);
  expect(press.liftAllowed, `${where}: the lift after the menu opens does not click`).toBe(false);
  expect(page.url(), `${where}: the long press opens nothing`).toBe(url);
  expect(await railOrder(page), `${where}: nothing moved`).toEqual(before);
  // Beside the button, from its top.
  const at = (await button.boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.x, `${where}: the menu opens beside the button`).toBeGreaterThanOrEqual(
    at.x + at.width - 2
  );
  expect(box.x - (at.x + at.width), `${where}: the menu meets the button`).toBeLessThan(32);
  expect(Math.abs(box.y - at.y), `${where}: the menu starts at the button's top`).toBeLessThan(24);
  // Pressed while its menu is open: slid toward the content, with the indicator raised.
  const open = await look(button);
  expect(open.slide, `${where}: the button looks pressed (slide)`).not.toBe(rest.slide);
  expect(open.indicator, `${where}: the button looks pressed (indicator)`).not.toBe(rest.indicator);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => look(button), `${where}: the button rests again`).toEqual(rest);
};

/** A finger that holds the second space and then moves it onto the first's top puts it first. */
const checkDrag = async (page: Page, tag: string) => {
  const before = await railOrder(page);
  const [first, second] = before as [string, string];
  const url = page.url();
  const from = (await tab(page, second).boundingBox())!;
  const onto = (await tab(page, first).boundingBox())!;
  const rise = from.y + from.height / 2 - (onto.y + onto.height * 0.15);
  const steps: Step[] = Array.from({ length: 12 }, (_, index) => ({
    type: 'move',
    dx: 0,
    dy: -Math.round((rise * (index + 1)) / 12),
  }));
  await touch(tab(page, second), [
    { type: 'start' },
    { type: 'wait', ms: HOLD_MS },
    ...steps,
    { type: 'wait', ms: 150 },
    { type: 'end' },
  ]);
  await expect
    .poll(() => railOrder(page), { message: `${tag}: press and move reorders` })
    .toEqual([second, first, ...before.slice(2)]);
  await expectNoMenu(page, `${tag} after a drag`);
  expect(page.url(), `${tag}: the drop opens no space`).toBe(url);
};

/** A finger that moves at once, or after a short rest, opens nothing and moves nothing. */
const checkSwipe = async (page: Page, spaceId: string, tag: string) => {
  const before = await railOrder(page);
  const url = page.url();
  const swiping: Step[] = Array.from({ length: 8 }, (_, index) => ({
    type: 'move',
    dx: 0,
    dy: -6 * (index + 1),
  }));
  for (const rest of [0, 250]) {
    // eslint-disable-next-line no-await-in-loop
    await touch(tab(page, spaceId), [
      { type: 'start' },
      { type: 'wait', ms: rest },
      ...swiping,
      { type: 'wait', ms: HOLD_MS },
      { type: 'end' },
    ]);
    // eslint-disable-next-line no-await-in-loop
    await expectNoMenu(page, `${tag} after a swipe (rest ${rest} ms)`);
  }
  expect(await railOrder(page), `${tag}: a swipe moves nothing`).toEqual(before);
  expect(page.url(), `${tag}: a swipe opens no space`).toBe(url);
};

/** A short tap opens the space's list. */
const checkTap = async (page: Page, spaceId: string, tag: string) => {
  await tab(page, spaceId).tap();
  await expect(page, `${tag}: a tap opens the space`).toHaveURL(
    new RegExp(encodeURIComponent(spaceId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  await expectNoMenu(page, `${tag} after a tap`);
};

/**
 * A phone page. Chromium on macOS now and then starts a touch context without its touch emulation
 * (a pointer that hovers); such a context is replaced, twice at most.
 */
const phonePage = async (owner: Browser) => {
  for (let attempt = 1; ; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const context = await owner.newContext(PHONE);
    // eslint-disable-next-line no-await-in-loop
    const page = await context.newPage();
    const touchScreen = () =>
      page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
    // eslint-disable-next-line no-await-in-loop
    if (attempt === 3 || (await touchScreen())) return { context, page, touchScreen };
    console.log(`context ${attempt} started without touch emulation; replacing it`);
    // eslint-disable-next-line no-await-in-loop
    await context.close();
  }
};

const checkScheme = async (page: Page, tag: string) => {
  await page.goto('/home/');
  await expect.poll(async () => (await railOrder(page)).length, { timeout: 60_000 }).toBe(3);
  const [first, , third] = (await railOrder(page)) as [string, string, string];
  await checkLongPress(page, spaceButton(page, first), tag);
  await checkLongPress(page, sectionButton(page, 'Home'), tag);
  await checkLongPress(page, sectionButton(page, 'Direct Messages'), tag);
  await checkDrag(page, tag);
  await checkSwipe(page, third, tag);
  await checkTap(page, third, tag);
};

const run = async (browser: Browser, engine: 'chromium' | 'webkit') => {
  const data = await seed(engine);
  const owner = engine === 'webkit' ? await launchWebKit() : browser;
  const { context, page, touchScreen } = await phonePage(owner);
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: data.tester.username,
      password: PASSWORD,
    });
    await expect.poll(touchScreen).toBe(true);
    for (const scheme of SCHEMES) {
      // eslint-disable-next-line no-await-in-loop
      await setLook(page, scheme);
      // eslint-disable-next-line no-await-in-loop
      await checkScheme(page, `phone-${engine}-${scheme}-rail`);
    }
  } finally {
    await context.close();
    if (owner !== browser) await owner.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a long press opens a space menu in the rail on a phone (Chromium)', async ({ browser }) => {
  test.setTimeout(300_000);
  await run(browser, 'chromium');
});

test('a long press opens a space menu in the rail on a phone (WebKit)', async ({ browser }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await run(browser, 'webkit');
});
