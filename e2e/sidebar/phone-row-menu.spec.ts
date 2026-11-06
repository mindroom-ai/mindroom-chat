import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { addRoomToSpace, matrixFetch, setDirectAccountData } from '../helpers/matrix';
import {
  HOMESERVER,
  LAUNCH,
  PASSWORD,
  PHONE,
  RUN,
  SCHEMES,
  createOtherRooms,
  homeserverIsUp,
  join,
  register,
  say,
  setLook,
  withRetry,
} from '../helpers/designChoices';
import { launchWebKit } from '../helpers/webkit';

// On a phone (390 by 844, touch) a finger resting on a sidebar room row opens the row's room
// menu, below or above the row, as the row's More Options button does on a desktop: that button
// shows only on hover or focus, and iOS fires no contextmenu for a long press. A drag of Home and
// space rows starts only when the finger moves on after the long press, a short tap opens the
// room, and a finger that scrolls the list opens nothing. Home (27 rooms), a space and the direct
// messages; light and dark; Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, WebKit. Playwright has no long press, so the spec sends the touch events itself, as real
// TouchEvents where the engine can build them. Set PHONE_ROW_MENU_SHOTS=<directory> to save the
// screenshots.
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.PHONE_ROW_MENU_SHOTS;
/** Longer than the 500 ms long press. */
const HOLD_MS = 700;

test.use({ launchOptions: LAUNCH });

/** The entries of the room menu of a room the tester created. */
const ENTRIES = [
  'Mark as Read',
  'Notifications',
  'Invite',
  'Copy Link',
  'Room Settings',
  'Message Search',
  'Jump to Time',
  'Archive Room',
  'Leave Room',
];

const seed = async (engine: string) => {
  const id = `${engine}_${RUN}_${randomUUID().slice(0, 6)}`;
  const tester = await register(`prm_${id}`, 'Robin Tester');
  const helper = await register(`prm_helper_${id}`, 'Sam Rivera');
  await createOtherRooms(tester);
  for (const name of ['Planning Desk', 'Budget Review']) {
    // eslint-disable-next-line no-await-in-loop
    const roomId = await withRetry(() => createRoom(HOMESERVER, tester.token, { name }));
    // eslint-disable-next-line no-await-in-loop
    await say(tester, roomId, `${name}: notes from Thursday are in the shared folder.`);
  }
  const space = await withRetry(() =>
    createRoom(HOMESERVER, tester.token, { name: 'Field Team', space: true })
  );
  for (const name of ['Site Visits', 'Equipment Log', 'Safety Checks']) {
    // eslint-disable-next-line no-await-in-loop
    const roomId = await withRetry(() => createRoom(HOMESERVER, tester.token, { name }));
    // eslint-disable-next-line no-await-in-loop
    await withRetry(() => addRoomToSpace(HOMESERVER, tester.token, space, roomId));
  }
  const direct = await withRetry(async () => {
    const created = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: helper.token,
      body: JSON.stringify({ preset: 'private_chat', is_direct: true, invite: [tester.userId] }),
    });
    return created.room_id;
  });
  await join(tester, direct);
  await withRetry(() =>
    setDirectAccountData(HOMESERVER, tester.token, tester.userId, helper.userId, direct)
  );
  await say(helper, direct, 'Can you look at the draft contract before the call tomorrow?');
  return { tester, space, direct };
};

type Step =
  | { type: 'start' | 'end' }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait'; ms: number }
  | { type: 'scroll'; by: number };

/**
 * One finger on the middle of `target`, driven through `steps`; `scroll` scrolls the nearest
 * scrolling ancestor, as the browser would under a moving finger. Answers whether the lift's
 * default was prevented and whether the engine built real TouchEvents.
 */
const touch = async (target: Locator, steps: Step[]) => {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to touch');
  return target.evaluate(
    async (element, { x, y, plan }) => {
      let real = true;
      const fire = (type: string, dx: number, dy: number, lifted: boolean) => {
        const point = { clientX: x + dx, clientY: y + dy };
        let event: Event;
        try {
          const finger = new Touch({
            identifier: 1,
            target: element,
            ...point,
            pageX: point.clientX + window.scrollX,
            pageY: point.clientY + window.scrollY,
            screenX: point.clientX,
            screenY: point.clientY,
          });
          event = new TouchEvent(type, {
            touches: lifted ? [] : [finger],
            targetTouches: lifted ? [] : [finger],
            changedTouches: [finger],
            bubbles: true,
            cancelable: true,
            composed: true,
          });
        } catch {
          // An engine that cannot build a Touch gets an event that carries the same fields, and
          // the point itself, where a drag library looks when the event is no TouchEvent.
          real = false;
          event = new Event(type, { bubbles: true, cancelable: true, composed: true });
          const finger = { identifier: 1, target: element, ...point };
          const list = lifted ? [] : [finger];
          Object.defineProperties(event, {
            touches: { value: list },
            targetTouches: { value: list },
            changedTouches: { value: [finger] },
            clientX: { value: point.clientX },
            clientY: { value: point.clientY },
          });
        }
        return element.dispatchEvent(event);
      };
      let liftAllowed = true;
      let at = { dx: 0, dy: 0 };
      for (const step of plan) {
        if (step.type === 'wait') {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => {
            setTimeout(resolve, step.ms);
          });
        } else if (step.type === 'scroll') {
          let scroller: Element | null = element;
          while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
            scroller = scroller.parentElement;
          }
          scroller?.scrollBy(0, step.by);
        } else if (step.type === 'move') {
          at = { dx: step.dx, dy: step.dy };
          fire('touchmove', at.dx, at.dy, false);
          // One move per frame, as a finger reports them.
          // eslint-disable-next-line no-await-in-loop
          await new Promise(requestAnimationFrame);
        } else if (step.type === 'start') {
          fire('touchstart', 0, 0, false);
        } else {
          liftAllowed = fire('touchend', at.dx, at.dy, true);
        }
      }
      return { liftAllowed, real };
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2, plan: steps }
  );
};

/** The room menu while it is open: the menu that ends with Leave Room. */
const roomMenu = (page: Page) => page.getByRole('menu').filter({ hasText: 'Leave Room' });

/** The names of the open room menu's own entries, top to bottom. */
const menuEntries = (menu: Locator) =>
  menu.evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .filter((row) => row.closest('[role="menu"]') === element)
      .map((row) => {
        const copy = row.cloneNode(true) as Element;
        copy.querySelectorAll('[aria-hidden="true"], svg').forEach((hidden) => hidden.remove());
        return (
          row.getAttribute('aria-label') ?? (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
        );
      })
  );

const list = (page: Page, name: string) => page.getByRole('navigation', { name, exact: true });

/** The room IDs of a list's rows, top to bottom. */
const rowOrder = (nav: Locator) =>
  nav
    .locator('[data-room-id]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-room-id') ?? ''));

const link = (nav: Locator, roomId: string) =>
  nav.locator(`[data-room-id="${roomId}"] a, a[href*="${encodeURIComponent(roomId)}"]`).first();

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
  await expect(roomMenu(page), `${where}: no menu`).toHaveCount(0);
};

/**
 * A long press on the row opens its room menu next to the row, with every entry; the lift does
 * not open the room, and nothing moved.
 */
const checkLongPress = async (page: Page, nav: Locator, roomId: string, tag: string) => {
  const before = await rowOrder(nav);
  const url = page.url();
  const target = link(nav, roomId);
  const press = await touch(target, [
    { type: 'start' },
    { type: 'wait', ms: 200 },
    // A resting finger jitters a little.
    { type: 'move', dx: 3, dy: -2 },
    { type: 'wait', ms: HOLD_MS },
    { type: 'end' },
  ]);
  console.log(`${tag} long press: ${JSON.stringify(press)}`);
  await page.waitForTimeout(300);
  await save(page, `${tag}-long-press`);
  const menu = roomMenu(page);
  await expect(menu, `${tag}: a long press opens the room menu`).toBeVisible();
  expect(await menuEntries(menu), `${tag}: the room menu's entries`).toEqual(ENTRIES);
  expect(press.liftAllowed, `${tag}: the lift after the menu opens does not click`).toBe(false);
  expect(page.url(), `${tag}: the long press opens no room`).toBe(url);
  if (before.length > 0) expect(await rowOrder(nav), `${tag}: nothing moved`).toEqual(before);
  // The menu sits right below or above the row, from the row's start.
  const row = (await target.evaluate((element) => {
    const box = element.closest('[data-room-id]') ?? element.parentElement ?? element;
    const { left, top, bottom } = box.getBoundingClientRect();
    return { left, top, bottom };
  })) as { left: number; top: number; bottom: number };
  const box = (await menu.boundingBox())!;
  const gap = Math.min(Math.abs(box.y - row.bottom), Math.abs(box.y + box.height - row.top));
  expect(gap, `${tag}: the menu meets the row (row ${JSON.stringify(row)})`).toBeLessThan(16);
  expect(Math.abs(box.x - row.left), `${tag}: the menu starts at the row's start`).toBeLessThan(24);
  // The menu stays open after the lift, and Escape closes it.
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
};

/** A finger that holds the second row and then moves it onto the first moves the room up. */
const checkDrag = async (page: Page, nav: Locator, tag: string) => {
  const before = await rowOrder(nav);
  const [first, second] = before as [string, string];
  const url = page.url();
  const target = link(nav, second);
  const from = (await target.boundingBox())!;
  const onto = (await link(nav, first).boundingBox())!;
  const rise = from.y + from.height / 2 - (onto.y + onto.height * 0.1);
  const steps: Step[] = Array.from({ length: 12 }, (_, index) => ({
    type: 'move',
    dx: 0,
    dy: -Math.round((rise * (index + 1)) / 12),
  }));
  await touch(target, [
    { type: 'start' },
    { type: 'wait', ms: HOLD_MS },
    ...steps,
    { type: 'wait', ms: 150 },
    { type: 'end' },
  ]);
  await expect
    .poll(() => rowOrder(nav), { message: `${tag}: press and move reorders` })
    .toEqual([second, first, ...before.slice(2)]);
  await expectNoMenu(page, `${tag} after a drag`);
  expect(page.url(), `${tag}: the drop opens no room`).toBe(url);
};

/** A short tap opens the room, without a menu. */
const checkTap = async (page: Page, nav: Locator, roomId: string, tag: string) => {
  await link(nav, roomId).tap();
  await expect(page, `${tag}: a tap opens the room`).toHaveURL(
    new RegExp(encodeURIComponent(roomId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  await expectNoMenu(page, `${tag} after a tap`);
};

/** A finger that scrolls the list, at once or after a short rest, opens no menu and moves nothing. */
const checkScroll = async (page: Page, nav: Locator, roomId: string, tag: string) => {
  const before = await rowOrder(nav);
  const url = page.url();
  const scrolling: Step[] = Array.from({ length: 8 }, (_, index) => [
    { type: 'move', dx: 0, dy: -6 * (index + 1) } as Step,
    { type: 'scroll', by: 6 } as Step,
  ]).flat();
  for (const rest of [0, 250]) {
    // eslint-disable-next-line no-await-in-loop
    await touch(link(nav, roomId), [
      { type: 'start' },
      { type: 'wait', ms: rest },
      ...scrolling,
      { type: 'wait', ms: HOLD_MS },
      { type: 'end' },
      { type: 'scroll', by: -48 },
    ]);
    // eslint-disable-next-line no-await-in-loop
    await expectNoMenu(page, `${tag} after a scroll (rest ${rest} ms)`);
  }
  expect(await rowOrder(nav), `${tag}: a scroll moves nothing`).toEqual(before);
  expect(page.url(), `${tag}: a scroll opens no room`).toBe(url);
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
    const lists = [
      { key: 'home', route: '/home/', name: 'Home', sortable: true },
      {
        key: 'space',
        route: `/${encodeURIComponent(data.space)}/`,
        name: 'Field Team',
        sortable: true,
      },
      { key: 'direct', route: '/direct/', name: 'Direct Messages', sortable: false },
    ];
    for (const scheme of SCHEMES) {
      // eslint-disable-next-line no-await-in-loop
      await setLook(page, scheme);
      for (const { key, route, name, sortable } of lists) {
        const tag = `phone-${engine}-${scheme}-${key}`;
        // eslint-disable-next-line no-await-in-loop
        await page.goto(route);
        const nav = list(page, name);
        // eslint-disable-next-line no-await-in-loop
        await expect(nav.locator('a[href]').first()).toBeVisible({ timeout: 60_000 });
        if (sortable) {
          // eslint-disable-next-line no-await-in-loop
          await expect
            .poll(async () => (await rowOrder(nav)).length, { timeout: 60_000 })
            .toBeGreaterThan(2);
        }
        const rows = sortable ? await rowOrder(nav) : [data.direct];
        const [, , third] = rows;
        // eslint-disable-next-line no-await-in-loop
        await checkLongPress(page, nav, rows[0]!, tag);
        if (sortable) {
          // eslint-disable-next-line no-await-in-loop
          await checkDrag(page, nav, tag);
          // eslint-disable-next-line no-await-in-loop
          await checkScroll(page, nav, third!, tag);
          // eslint-disable-next-line no-await-in-loop
          await checkTap(page, nav, third!, tag);
        }
      }
    }
  } finally {
    await context.close();
    if (owner !== browser) await owner.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a long press opens a sidebar row menu on a phone (Chromium)', async ({ browser }) => {
  test.setTimeout(420_000);
  await run(browser, 'chromium');
});

test('a long press opens a sidebar row menu on a phone (WebKit)', async ({ browser }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  await run(browser, 'webkit');
});
