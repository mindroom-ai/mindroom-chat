import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { addRoomToSpace } from '../helpers/matrix';
import {
  HOMESERVER,
  LAUNCH,
  PASSWORD,
  PHONE,
  RUN,
  SCHEMES,
  createOtherRooms,
  homeserverIsUp,
  register,
  setLook,
  withRetry,
} from '../helpers/designChoices';
import { launchWebKit } from '../helpers/webkit';
import { touch, type Step } from '../helpers/touch';

// On a phone (390 by 844, touch) the space rail works as the sidebar's room rows do: a finger
// resting on a space opens the space's menu beside it (iOS fires no contextmenu for a long
// press), a drag starts only when the finger moves on after the long press, a short tap opens the
// space, and a finger that moves at once opens nothing. Three spaces and 24 rooms; light and
// dark; Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. The
// spec sends the touch events itself (`e2e/helpers/touch.ts`). Set RAIL_LONG_PRESS_SHOTS to save
// the screenshots.
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.RAIL_LONG_PRESS_SHOTS;
/** Longer than the 500 ms long press. */
const HOLD_MS = 700;
/** The entries of a space's menu for its creator, who may invite. */
const ENTRIES = ['Mark as Read', 'Invite', 'Copy Link', 'Space Settings'];

test.use({ launchOptions: LAUNCH });

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

/** A long press opens the space's menu beside its tab; the lift opens nothing, nothing moves. */
const checkLongPress = async (page: Page, spaceId: string, tag: string) => {
  const before = await railOrder(page);
  const url = page.url();
  const press = await touch(tab(page, spaceId), [
    { type: 'start' },
    { type: 'wait', ms: 200 },
    { type: 'move', dx: 2, dy: 3 },
    { type: 'wait', ms: HOLD_MS },
    { type: 'end' },
  ]);
  console.log(`${tag} long press: ${JSON.stringify(press)}`);
  await page.waitForTimeout(300);
  await save(page, `${tag}-long-press`);
  const menu = spaceMenu(page);
  await expect(menu, `${tag}: a long press opens the space menu`).toBeVisible();
  expect(await menuEntries(menu), `${tag}: the space menu's entries`).toEqual(ENTRIES);
  expect(press.liftAllowed, `${tag}: the lift after the menu opens does not click`).toBe(false);
  expect(page.url(), `${tag}: the long press opens no space`).toBe(url);
  expect(await railOrder(page), `${tag}: nothing moved`).toEqual(before);
  // Beside the tab, from its top.
  const at = (await tab(page, spaceId).boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.x, `${tag}: the menu opens beside the tab`).toBeGreaterThanOrEqual(
    at.x + at.width - 2
  );
  expect(box.x - (at.x + at.width), `${tag}: the menu meets the tab`).toBeLessThan(32);
  expect(Math.abs(box.y - at.y), `${tag}: the menu starts at the tab's top`).toBeLessThan(24);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
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
  await checkLongPress(page, first, tag);
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
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a long press opens a space menu in the rail on a phone (Chromium)', async ({ browser }) => {
  test.setTimeout(300_000);
  await run(browser, 'chromium');
});

test('a long press opens a space menu in the rail on a phone (WebKit)', async ({ browser }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await run(browser, 'webkit');
});
