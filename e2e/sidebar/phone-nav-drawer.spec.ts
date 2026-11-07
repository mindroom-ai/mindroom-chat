import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { cornersOf, pageCardRadius } from '../helpers/cardCorners';

// On a phone a top bar stays above every page: a menu button, a search field that opens the
// command palette and names its shortcut, and the account. The menu button slides a drawer in from
// the start edge over the page, with the icon rail and the section's room list side by side; a
// room picked there closes it, a space picked there keeps it out with that space's list, and the
// scrim, Escape, the menu button and a sideways swipe put it away. A room's back chevron and edge
// swipe still return to the list, which the drawer then holds out. The drawer rounds only its
// corner over the page, as the page's card does where it floats, and no line rules the top bar off
// from the page. 390 by 844 (and 744 by 1133 for the corner and the bar) with touch, in
// Chromium with real touches and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit. Set PHONE_NAV_SHOTS=<directory> to save screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'phone-nav-drawer-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.PHONE_NAV_SHOTS;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ENGINES = ['chromium', 'webkit'] as const;
type Engine = (typeof ENGINES)[number];

// A list long enough to scroll, as a real account's is.
const OTHER_ROOMS = Array.from(
  { length: 24 },
  (_, index) => `Neighborhood Group ${String(index + 1).padStart(2, '0')}`
);

type Seed = {
  username: string;
  garden: string;
  gardenRoot: string;
  harbor: string;
  space: string;
  bus: string;
};

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const text = (body: string) => ({ msgtype: 'm.text', body });

const seed = async (engine: Engine, test = 'main'): Promise<Seed> => {
  const username = `drawer_${engine}_${test}_${RUN}`;
  const reader = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const token = reader.access_token;
  const create = (name: string, invite?: string[]) =>
    createPrivateRoom(HOMESERVER, token, { name, topic: `${name} notes`, invite });
  // The rooms have an agent, as MindRoom rooms do, so they open in Compact.
  const agent = await registerAgentAccount(HOMESERVER, `drw${engine[0]}`);
  const say = (roomId: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, token, roomId, content, 'phone-nav-drawer');

  await Promise.all(OTHER_ROOMS.map((name) => create(name)));
  const garden = await create('Garden Club', [agent.userId]);
  const gardenRoot = await say(
    garden,
    text('Seed order for spring: tomatoes, beans and two kinds of squash. Anything else by Friday?')
  );
  await say(garden, {
    ...text('Add marigolds for the border, please; the old packets failed.'),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: gardenRoot,
      is_falling_back: true,
      'm.in_reply_to': { event_id: gardenRoot },
    },
  });
  const harbor = await create('Harbor Plans', [agent.userId]);
  await say(harbor, text('Crane schedule for the north pier next week: who still needs a slot?'));
  const space = await createPrivateSpace(HOMESERVER, token, { name: 'Field Trips', topic: '' });
  const bus = await create('Bus Schedule');
  await addRoomToSpace(HOMESERVER, token, space, bus);
  return { username, garden, gardenRoot, harbor, space, bus };
};

type Place = { path: string; room: string | null; thread: string | null };

/** The page's place: its path, the room it shows, and the thread open in it. */
const place = (page: Page): Place => {
  const url = new URL(page.url());
  // The last ID: a room in a space follows the space's.
  const room = url.pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .filter((segment) => segment.startsWith('!'))
    .pop();
  return { path: url.pathname, room: room ?? null, thread: url.searchParams.get('threadId') };
};

const inRoom = (room: string): Partial<Place> => ({ room, thread: null });

const expectAt = (page: Page, expected: Partial<Place>, step: string) =>
  expect.poll(() => place(page), { message: step, timeout: 20_000 }).toMatchObject(expected);

const shoot = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
  clip?: { x: number; y: number; width: number; height: number }
) => {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), clip });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-${name}.png`, clip });
};

const drawer = (page: Page) => page.locator('#phone-nav-drawer');
const roomList = (page: Page) => drawer(page).getByTestId('resizable-page-nav');
const rail = (page: Page) => drawer(page).getByRole('navigation', { name: 'Main', exact: true });
const menuButton = (page: Page) => page.locator('#phone-nav-menu-button');
const roomBanner = (page: Page) => page.getByRole('banner');

const expectDrawer = async (page: Page, open: boolean, step: string) => {
  await expect(drawer(page), step).toBeVisible({ visible: open });
  await expect(menuButton(page), step).toHaveAttribute('aria-expanded', String(open));
};

const openDrawer = async (page: Page) => {
  await menuButton(page).tap();
  await expectDrawer(page, true, 'the menu button slides the drawer in');
  // Until it has slid in, a finger at its middle may still land on the scrim.
  await expect.poll(() => drawer(page).evaluate((panel) => panel.getAnimations().length)).toBe(0);
};

const pickRoom = async (page: Page, name: string, room: string) => {
  await roomList(page).getByRole('link', { name }).tap();
  await expectAt(page, inRoom(room), `${name} opens from the drawer`);
  await expectDrawer(page, false, `picking ${name} puts the drawer away`);
};

/**
 * A swipe from the screen's left edge toward the middle. Chromium gets real touches (12 moves of
 * 16 ms, as a finger makes them); Playwright drives WebKit's touches only through its taps, so
 * WebKit gets the events the app's gesture listens to, as the iOS app's web view delivers them.
 */
const edgeSwipe = async (page: Page, engine: Engine) => {
  const xs = Array.from({ length: 12 }, (_, step) => 4 + (step + 1) * 24);
  if (engine === 'chromium') {
    const touch = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
      touch.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: 420, id: 1 }],
      });
    await send('touchStart', 4);
    for (const x of xs) {
      await send('touchMove', x);
      await page.waitForTimeout(16);
    }
    await send('touchEnd');
    await touch.detach();
    return;
  }
  await page.evaluate((moves) => {
    const fire = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const touches = type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: 420 }];
      Object.defineProperty(event, 'touches', { value: touches });
      window.dispatchEvent(event);
    };
    fire('touchstart', 4);
    for (const x of moves) fire('touchmove', x);
    fire('touchend', moves[moves.length - 1]!);
  }, xs);
};

/** A swipe across the drawer toward the start edge, as a finger pushes it back. */
const swipeOnDrawer = async (page: Page, engine: Engine) => {
  const xs = Array.from({ length: 8 }, (_, step) => 260 - (step + 1) * 24);
  if (engine === 'chromium') {
    const touch = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
      touch.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: 600, id: 1 }],
      });
    await send('touchStart', 260);
    for (const x of xs) {
      await send('touchMove', x);
      await page.waitForTimeout(16);
    }
    await send('touchEnd');
    await touch.detach();
    return;
  }
  await drawer(page).evaluate((panel, moves) => {
    const fire = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const point = [{ identifier: 1, clientX: x, clientY: 600 }];
      Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : point });
      Object.defineProperty(event, 'changedTouches', { value: point });
      panel.dispatchEvent(event);
    };
    fire('touchstart', 260);
    for (const x of moves) fire('touchmove', x);
    fire('touchend', moves[moves.length - 1]!);
  }, xs);
};

const signIn = async (browser: Browser, { username }: Seed, options = {}) => {
  const context = await browser.newContext({ ...PHONE, ...options });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.goto('/home/');
  await expect(roomList(page).getByRole('link', { name: 'Harbor Plans' })).toBeVisible({
    timeout: 60_000,
  });
  return { context, page };
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

for (const engine of ENGINES) {
  test(`${engine}: the menu button slides the rail and the room list in over the room`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(300_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine);
      const { garden, gardenRoot, harbor, space, bus } = seeded;
      const { context, page } = await signIn(own, seeded);
      try {
        // A section's own page shows its list in the drawer, beside the rail, below the bar.
        await expectDrawer(page, true, 'Home opens with the drawer out');
        await expect(rail(page)).toBeVisible();
        // Settled: it may slide in when the app lands on Home after starting elsewhere.
        await expect.poll(async () => (await drawer(page).boundingBox())?.x).toBe(0);
        const bar = await menuButton(page).boundingBox();
        const panel = await drawer(page).boundingBox();
        expect(panel!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
        expect(panel!.width).toBeLessThanOrEqual(PHONE.viewport.width - 56);
        await shoot(page, testInfo, 'home-drawer');

        // A room picked there fills the page under the bar; its back chevron returns to the list,
        // which the drawer then holds out again.
        await pickRoom(page, 'Garden Club', garden);
        await expect(menuButton(page)).toBeVisible();
        await shoot(page, testInfo, 'room');
        await roomBanner(page).getByRole('button', { name: 'Back', exact: true }).tap();
        await expectAt(page, { path: '/home/', room: null }, 'Back returns to Home');
        await expectDrawer(page, true, 'Home shows its list again');
        await pickRoom(page, 'Garden Club', garden);

        // The browser's back (Android's back button) returns to Home with its list out, and
        // forward to the room with the drawer away.
        await page.goBack();
        await expectAt(page, { path: '/home/', room: null }, 'back returns to Home');
        await expectDrawer(page, true, 'Home shows its list again');
        await page.goForward();
        await expectAt(page, inRoom(garden), 'forward returns to the room');
        await expectDrawer(page, false, 'the room shows without the drawer');

        // The drawer slides out over the room, which stays where it was.
        const marked = await roomBanner(page).evaluate((element) => {
          element.setAttribute('data-spec-mark', 'kept');
          return true;
        });
        expect(marked).toBe(true);
        await openDrawer(page);
        await expect(roomList(page).getByRole('link', { name: 'Garden Club' })).toBeVisible();
        await expect(page.locator('[data-spec-mark="kept"]')).toHaveCount(1);
        await shoot(page, testInfo, 'room-drawer');

        // The scrim, Escape and the menu button put it away again.
        await page.touchscreen.tap(PHONE.viewport.width - 20, 500);
        await expectDrawer(page, false, 'a tap on the scrim puts the drawer away');
        await openDrawer(page);
        await page.keyboard.press('Escape');
        await expectDrawer(page, false, 'Escape puts the drawer away');
        await openDrawer(page);
        await menuButton(page).tap();
        await expectDrawer(page, false, 'the menu button puts the drawer away');
        await openDrawer(page);
        await swipeOnDrawer(page, engine);
        await expectDrawer(page, false, 'a swipe toward the edge puts the drawer away');
        await expect(page.locator('[data-spec-mark="kept"]')).toHaveCount(1);

        // The room already open closes it too, and another one opens there.
        await openDrawer(page);
        await roomList(page).getByRole('link', { name: 'Garden Club' }).tap();
        await expectDrawer(page, false, 'the open room puts the drawer away');
        await openDrawer(page);
        await pickRoom(page, 'Harbor Plans', harbor);

        // A space keeps the drawer out with its own list, its lobby behind it, at the space's own
        // address, where its rooms' back chevrons return.
        await openDrawer(page);
        await rail(page).locator(`button[data-id="${space}"]`).tap();
        await expect(roomList(page).getByRole('link', { name: 'Bus Schedule' })).toBeVisible();
        await expectDrawer(page, true, 'a space keeps the drawer out');
        const spaceRoot = place(page).path;
        expect(spaceRoot).not.toMatch(/lobby/);
        await shoot(page, testInfo, 'space-drawer');
        await pickRoom(page, 'Bus Schedule', bus);

        // A swipe from the left edge of a room goes back as its chevron does, to the space's list
        // with the drawer out; in a thread it leaves the thread for its room.
        await edgeSwipe(page, engine);
        await expectAt(page, { path: spaceRoot }, 'the edge swipe returns to the space');
        await expectDrawer(page, true, 'with its list out');
        await rail(page).getByRole('button', { name: 'Home', exact: true }).tap();
        await pickRoom(page, 'Garden Club', garden);
        await page.locator(`button[data-thread-root-id="${gardenRoot}"]`).first().tap();
        await expectAt(page, { room: garden, thread: gardenRoot }, 'the thread opens');
        await edgeSwipe(page, engine);
        await expectAt(page, inRoom(garden), 'the edge swipe leaves the thread for its room');
        await expectDrawer(page, false, 'and leaves the drawer away');

        // The search field opens the command palette and names its shortcut.
        const search = page.getByRole('button', { name: 'Search', exact: true });
        await expect(search).toContainText(/K$/);
        await search.tap();
        await expect(
          page.getByRole('dialog', { name: 'Command palette', exact: true })
        ).toBeVisible();
      } finally {
        await shoot(page, testInfo, 'last');
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });
}

// A tablet held upright is still narrow enough for the drawer (750 px and below).
const TABLET = { width: 744, height: 1133 };

/**
 * Whatever rules the top bar off from the page: a border or shadow of its own, a pseudo-element,
 * or a line across the screen at its lower edge (a thin element, or a page's top border).
 */
const topBarRules = (page: Page) =>
  page.locator('[data-phone-top-bar]').evaluate((bar) => {
    const found: string[] = [];
    const style = getComputedStyle(bar);
    if (style.borderBottomStyle !== 'none' && parseFloat(style.borderBottomWidth) > 0) {
      found.push(`border-bottom ${style.borderBottomWidth} ${style.borderBottomStyle}`);
    }
    if (style.boxShadow !== 'none') found.push(`box-shadow ${style.boxShadow}`);
    for (const pseudo of ['::before', '::after']) {
      const { content } = getComputedStyle(bar, pseudo);
      if (content !== 'none' && content !== 'normal') found.push(`${pseudo} ${content}`);
    }
    const edge = bar.getBoundingClientRect().bottom;
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const box = element.getBoundingClientRect();
      if (box.width < window.innerWidth * 0.9 || Math.abs(box.top - edge) > 2) continue;
      const own = getComputedStyle(element);
      const thin = box.height > 0 && box.height <= 2;
      const ruled = own.borderTopStyle !== 'none' && parseFloat(own.borderTopWidth) > 0;
      if (thin || ruled) found.push(element.outerHTML.slice(0, 120));
    }
    return found;
  });

for (const engine of ENGINES) {
  test(`${engine}: the drawer rounds its free corner as the page card does, and no line rules the top bar off`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(300_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine, 'corner');
      const { context, page } = await signIn(own, seeded);
      try {
        await pickRoom(page, 'Garden Club', seeded.garden);
        await expect(page.getByText('Seed order for spring').last()).toBeVisible();

        // Pictures first, so the run before the fix records how it looked.
        for (const scheme of ['light', 'dark'] as const) {
          /* eslint-disable no-await-in-loop -- one picture after the other on one page. */
          await page.emulateMedia({ colorScheme: scheme });
          for (const [size, viewport] of [
            ['phone', PHONE.viewport],
            ['tablet', TABLET],
          ] as const) {
            await page.setViewportSize(viewport);
            await expectDrawer(page, false, `the room shows at ${size} size`);
            await page.waitForTimeout(400);
            await shoot(page, testInfo, `corner-${engine}-${size}-${scheme}-closed`);
            await openDrawer(page);
            await shoot(page, testInfo, `corner-${engine}-${size}-${scheme}-open`);
            // The drawer's lower end corner, close up.
            const panel = (await drawer(page).boundingBox())!;
            await shoot(page, testInfo, `corner-${engine}-${size}-${scheme}-zoom`, {
              x: panel.x + panel.width - 120,
              y: panel.y + panel.height - 80,
              width: 160,
              height: 80,
            });
            await page.keyboard.press('Escape');
            await expectDrawer(page, false, 'Escape puts the drawer away');
          }
          /* eslint-enable no-await-in-loop */
        }

        // The page card's corner, where the page floats beside the rail.
        const card = await pageCardRadius(page);

        for (const viewport of [PHONE.viewport, TABLET]) {
          /* eslint-disable no-await-in-loop -- one size after the other on one page. */
          await page.setViewportSize(viewport);
          await expectDrawer(page, false, `the room shows at ${viewport.width} px`);
          expect(await topBarRules(page), 'no line under the top bar').toEqual([]);
          await openDrawer(page);
          // Only the corner over the page is round: the top one meets the bar, the others the
          // screen's edge. What the drawer holds is clipped to it.
          expect(await drawer(page).evaluate(cornersOf)).toEqual([0, 0, card, 0]);
          expect(await drawer(page).evaluate((panel) => getComputedStyle(panel).overflow)).toMatch(
            /^(clip|hidden)$/
          );
          expect(await topBarRules(page), 'no line under the top bar with the drawer out').toEqual(
            []
          );
          await page.keyboard.press('Escape');
          await expectDrawer(page, false, 'Escape puts the drawer away');
          /* eslint-enable no-await-in-loop */
        }

        // Right to left, the drawer comes from the right edge and rounds its bottom-left corner.
        await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
        await openDrawer(page);
        expect(await drawer(page).evaluate(cornersOf)).toEqual([0, 0, 0, card]);
      } finally {
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });
}

for (const engine of ENGINES) {
  test(`${engine}: a fresh load at Home shows the drawer out without sliding it in`, async ({
    browser,
  }) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const { context, page } = await signIn(own, await seed(engine, 'launch'));
      try {
        // Every transform transition the drawer starts, from the first script of the page on.
        await context.addInitScript(() => {
          const runs: string[] = [];
          Object.assign(window, { drawerSlides: runs });
          document.addEventListener(
            'transitionrun',
            (event) => {
              const { target } = event;
              if (target instanceof Element && target.id === 'phone-nav-drawer') {
                runs.push(`${event.propertyName} at ${Math.round(performance.now())} ms`);
              }
            },
            true
          );
        });
        const slides = () =>
          page.evaluate(() => (window as unknown as { drawerSlides: string[] }).drawerSlides);

        await page.reload();
        await expect(roomList(page).getByRole('link', { name: 'Harbor Plans' })).toBeVisible({
          timeout: 60_000,
        });
        await expectDrawer(page, true, 'Home opens with the drawer out');
        await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
        // Long enough for a slide that started late to show itself.
        await page.waitForTimeout(1_000);
        expect(await slides(), 'the drawer is out from the first frame it shows').toEqual([]);

        // Once the app shows, the menu button still slides it.
        await menuButton(page).tap();
        await expectDrawer(page, false, 'the menu button puts the drawer away');
        await expect.poll(slides).toContainEqual(expect.stringMatching(/^transform /));
      } finally {
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });
}

test('chromium: the drawer slides, except with reduced motion, and mirrors right to left', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const seeded = await seed('chromium', 'motion');
  const transitionOf = (page: Page) =>
    drawer(page).evaluate((element) => getComputedStyle(element).transitionDuration);

  const moving = await signIn(browser, seeded);
  try {
    await pickRoom(moving.page, 'Garden Club', seeded.garden);
    expect(await transitionOf(moving.page)).toMatch(/^0\.28s/);
    // Turned sideways, the phone gets the wider layout, and the room stays mounted.
    await roomBanner(moving.page).evaluate((element) =>
      element.setAttribute('data-spec-mark', 'kept')
    );
    await moving.page.setViewportSize({ width: 844, height: 390 });
    await expect(menuButton(moving.page)).toHaveCount(0);
    await expect(moving.page.locator('[data-spec-mark="kept"]')).toHaveCount(1);
    await moving.page.setViewportSize(PHONE.viewport);
    await expect(menuButton(moving.page)).toBeVisible();
    await expect(moving.page.locator('[data-spec-mark="kept"]')).toHaveCount(1);
    // Right to left, the drawer comes in from the right.
    await moving.page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await openDrawer(moving.page);
    await expect
      .poll(async () => {
        const panel = await drawer(moving.page).boundingBox();
        return panel && Math.round(panel.x + panel.width);
      })
      .toBe(PHONE.viewport.width);
  } finally {
    await moving.context.close();
  }

  const still = await signIn(browser, seeded, { reducedMotion: 'reduce' });
  try {
    // The app shortens every transition to next to nothing (src/index.css).
    expect(parseFloat(await transitionOf(still.page))).toBeLessThan(0.01);
  } finally {
    await still.context.close();
  }
});

test('chromium: Escape closes a menu over the drawer and leaves the drawer out', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { context, page } = await signIn(browser, await seed('chromium', 'escape'));
  try {
    await rail(page).getByRole('button', { name: 'Home', exact: true }).click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expectDrawer(page, true, 'the drawer stays out');
  } finally {
    await context.close();
  }
});

test('chromium: a short room link opens the room with the drawer away', async ({ browser }) => {
  test.setTimeout(180_000);
  const seeded = await seed('chromium', 'short');
  const { context, page } = await signIn(browser, seeded);
  try {
    // `/!room/` first matches a space's address, then redirects to the room in Home.
    await page.goto(`/${encodeURIComponent(seeded.garden)}/`);
    await expectAt(page, { room: seeded.garden }, 'the short link opens the room');
    await expect(page).toHaveURL(/\/home\//);
    await expectDrawer(page, false, 'with the drawer away');

    // A room the account has not joined shows its join page at that address, not the drawer.
    const owner = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `drawer_owner_${RUN}`,
        password: PASSWORD,
        auth: { type: 'm.login.dummy' },
      }),
    });
    const { room_id: open } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: owner.access_token,
      body: JSON.stringify({ preset: 'public_chat', name: 'Open Workshop' }),
    });
    await page.goto(`/${encodeURIComponent(open)}/`);
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expectDrawer(page, false, 'the join page shows without the drawer');
  } finally {
    await context.close();
  }
});

test('chromium: Skip to content puts the drawer away and lands in the page', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { context, page } = await signIn(browser, await seed('chromium', 'skip'));
  try {
    await expectDrawer(page, true, 'Home opens with the drawer out');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expectDrawer(page, false, 'the skip link puts the drawer away');
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('main')))
      .toBe(true);
  } finally {
    await context.close();
  }
});
