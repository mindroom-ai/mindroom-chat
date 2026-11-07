import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { cornersOf, pageCardRadius } from '../helpers/cardCorners';

// On a phone a room's members slide in from the end edge as a sheet, the way the navigation drawer
// comes from the start edge: below the top bar, at the drawer's height, as wide as the drawer, over
// a dimmed room. The scrim, Escape, a swipe toward the end edge, the menu button and a room picked
// in the search put it away; closed after a keyboard opened it, it gives the focus back to the
// room's More Options; while it is out a swipe from the start edge does not leave the room. It
// rounds only its corner over the page, as the drawer does, with the page card's radius. 390 by 844
// (and 744 by 1133 for the corner) with touch, in Chromium with real touches and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// PHONE_MEMBERS_SHOTS=<directory> to save screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'phone-members-sheet-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.PHONE_MEMBERS_SHOTS;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ENGINES = ['chromium', 'webkit'] as const;
type Engine = (typeof ENGINES)[number];

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

const seed = async (engine: Engine, test = 'main', guests = 0) => {
  const username = `members_${engine}_${test}_${RUN}`;
  const reader = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  // An agent in the room, as MindRoom rooms have.
  const agent = await registerAgentAccount(HOMESERVER, `mbs${engine[0]}`);
  // People who join the first room, so its member list runs to the sheet's foot.
  const people = await Promise.all(
    Array.from({ length: guests }, (_, index) =>
      matrixFetch<{ user_id: string; access_token: string }>(HOMESERVER, '/register', {
        method: 'POST',
        body: JSON.stringify({
          username: `guest_${String(index + 1).padStart(2, '0')}_${engine}_${test}_${RUN}`,
          password: PASSWORD,
          auth: { type: 'm.login.dummy' },
        }),
      })
    )
  );
  const invited = people.map(({ user_id }) => user_id);
  const create = (name: string) =>
    createPrivateRoom(HOMESERVER, reader.access_token, {
      name,
      topic: `${name} notes`,
      invite: [agent.userId, ...invited],
    });
  const room = await create('Garden Club');
  await Promise.all(people.map(({ access_token }) => joinRoom(HOMESERVER, access_token, room)));
  const other = await create('Harbor Plans');
  await createPrivateSpace(HOMESERVER, reader.access_token, { name: 'Field Trips', topic: '' });
  return { username, room, other };
};

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
const menuButton = (page: Page) => page.locator('#phone-nav-menu-button');
const banner = (page: Page) => page.getByRole('banner');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Members', exact: true });

/** Waits until the element has stopped moving. */
const settled = (page: Page, selector: string) =>
  expect
    .poll(() =>
      page.evaluate(
        (css) => document.querySelector(css)?.getAnimations({ subtree: true }).length ?? 0,
        selector
      )
    )
    .toBe(0);

/** The sheet has moved out (on the frame after it mounted) and stopped moving. */
const expectSheetOut = async (page: Page, step: string) => {
  await expect(page.getByTestId('phone-members-sheet'), step).toHaveAttribute('data-open');
  await settled(page, '[data-testid="phone-members-sheet"]');
};

const openMembers = async (page: Page) => {
  await banner(page).getByRole('button', { name: 'More Options', exact: true }).tap();
  await page
    .getByRole('menu')
    .filter({ hasText: 'Leave Room' })
    .getByRole('menuitem', { name: 'Show Members', exact: true })
    .tap();
  await expectSheetOut(page, 'Show Members slides the sheet in');
};

const expectSheetAway = (page: Page, step: string) =>
  expect(page.getByTestId('phone-members-sheet'), step).toHaveCount(0);

/**
 * A sideways swipe at the screen's height of 600 px from `from` by `step` px a move. Chromium gets
 * real touches; Playwright drives WebKit's touches only through its taps, so WebKit gets the events
 * the app's gestures listen to, on the element under the finger.
 */
const swipe = async (page: Page, engine: Engine, from: number, step: number) => {
  const xs = Array.from({ length: 8 }, (_, index) => from + (index + 1) * step);
  if (engine === 'chromium') {
    const touch = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
      touch.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: 600, id: 1 }],
      });
    await send('touchStart', from);
    for (const x of xs) {
      await send('touchMove', x);
      await page.waitForTimeout(16);
    }
    await send('touchEnd');
    await touch.detach();
    return;
  }
  await page.evaluate(
    ({ start, moves }) => {
      const target = document.elementFromPoint(start, 600) ?? window;
      const fire = (type: string, x: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        const point = [{ identifier: 1, clientX: x, clientY: 600 }];
        Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : point });
        Object.defineProperty(event, 'changedTouches', { value: point });
        target.dispatchEvent(event);
      };
      fire('touchstart', start);
      for (const x of moves) fire('touchmove', x);
      fire('touchend', moves[moves.length - 1]!);
    },
    { start: from, moves: xs }
  );
};

const signIn = async (browser: Browser, username: string) => {
  const context = await browser.newContext(PHONE);
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.goto('/home/');
  await expect(drawer(page).getByRole('link', { name: 'Garden Club' })).toBeVisible({
    timeout: 60_000,
  });
  return { context, page };
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

for (const engine of ENGINES) {
  test(`${engine}: a room's members slide in from the end edge at the drawer's height`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const { username, room, other } = await seed(engine);
      const { context, page } = await signIn(own, username);
      try {
        // Where the drawer stands, under the bar, on Home.
        await settled(page, '#phone-nav-drawer');
        const drawerBox = await drawer(page).boundingBox();
        await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
        await expect.poll(() => decodeURIComponent(page.url())).toContain(room);
        await expect(drawer(page)).toBeHidden();

        // The sheet: at the end edge, as high up as the drawer, as wide, over a dimmed room.
        await openMembers(page);
        const box = await sheet(page).boundingBox();
        expect(box!.y).toBeCloseTo(drawerBox!.y, 0);
        expect(box!.y + box!.height).toBeCloseTo(drawerBox!.y + drawerBox!.height, 0);
        expect(box!.width).toBeCloseTo(drawerBox!.width, 0);
        expect(box!.x + box!.width).toBeCloseTo(PHONE.viewport.width, 0);
        await expect(sheet(page).getByText(username)).toBeVisible();
        await expect(menuButton(page), 'the top bar stays above the sheet').toBeVisible();
        await shoot(page, testInfo, 'members-sheet');

        // While it is out, a swipe from the start edge does not leave the room.
        await swipe(page, engine, 4, 24);
        await expect(sheet(page)).toBeVisible();
        expect(decodeURIComponent(page.url())).toContain(room);

        // The scrim, Escape, a swipe toward the end edge and the menu button put it away.
        await page.touchscreen.tap(20, 500);
        await expectSheetAway(page, 'a tap on the scrim puts the sheet away');
        await openMembers(page);
        await page.keyboard.press('Escape');
        await expectSheetAway(page, 'Escape puts the sheet away');
        await openMembers(page);
        await swipe(page, engine, 150, 24);
        await expectSheetAway(page, 'a swipe toward the end edge puts the sheet away');
        await openMembers(page);
        await menuButton(page).tap();
        await expect(drawer(page)).toBeVisible();
        await expectSheetAway(page, 'the drawer coming out puts the sheet away');
        await page.touchscreen.tap(PHONE.viewport.width - 20, 500);
        await expect(drawer(page)).toBeHidden();

        // A room picked in the search opens without the members over it.
        await openMembers(page);
        await page.getByRole('button', { name: 'Search', exact: true }).tap();
        const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
        // Typed as a person types, into the field the palette focused, over the members.
        await expect(palette.getByRole('combobox')).toBeFocused();
        await page.keyboard.type('Harbor Plans');
        await expect(palette.getByRole('combobox')).toHaveValue('Harbor Plans');
        await palette.getByRole('option').filter({ hasText: 'Harbor Plans' }).first().tap();
        await expect.poll(() => decodeURIComponent(page.url())).toContain(other);
        await expectSheetAway(page, 'a navigation puts the sheet away');

        // Also when the search leads to a page of another kind, and back to the room.
        await openMembers(page);
        await page.getByRole('button', { name: 'Search', exact: true }).tap();
        await palette.getByRole('combobox').fill('Field Trips');
        await palette.getByRole('option').filter({ hasText: 'Field Trips' }).first().tap();
        await expect(palette).toBeHidden();
        await page.getByRole('button', { name: 'Search', exact: true }).tap();
        await palette.getByRole('combobox').fill('Harbor Plans');
        await palette.getByRole('option').filter({ hasText: 'Harbor Plans' }).first().tap();
        await expect.poll(() => decodeURIComponent(page.url())).toContain(other);
        await expect(banner(page)).toBeVisible();
        await expectSheetAway(page, 'the members stay with the page they were opened on');

        // Opened from the keyboard and closed with Escape, it gives the focus back.
        if (engine === 'chromium') {
          const more = banner(page).getByRole('button', { name: 'More Options', exact: true });
          await more.focus();
          await page.keyboard.press('Enter');
          await page
            .getByRole('menu')
            .filter({ hasText: 'Leave Room' })
            .getByRole('menuitem', { name: 'Show Members', exact: true })
            .focus();
          await page.keyboard.press('Enter');
          await expectSheetOut(page, 'Enter on Show Members slides the sheet in');
          await page.keyboard.press('Escape');
          await expectSheetAway(page, 'Escape puts the sheet away');
          await expect(more, 'the focus goes back to More Options').toBeFocused();
        }
      } finally {
        await context.close();
      }
    } finally {
      if (own !== browser) await own.close();
    }
  });
}

// A tablet held upright is still narrow enough for the sheet (750 px and below).
const TABLET = { width: 744, height: 1133 };

for (const engine of ENGINES) {
  test(`${engine}: the members sheet rounds its corner over the page as the page card does`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(300_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const { username, room } = await seed(engine, 'corner', 16);
      const { context, page } = await signIn(own, username);
      try {
        await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
        await expect.poll(() => decodeURIComponent(page.url())).toContain(room);
        await expect(drawer(page)).toBeHidden();

        // Pictures first, so the run before the fix records how it looked.
        for (const scheme of ['light', 'dark'] as const) {
          /* eslint-disable no-await-in-loop -- one picture after the other on one page. */
          await page.emulateMedia({ colorScheme: scheme });
          for (const [size, viewport] of [
            ['phone', PHONE.viewport],
            ['tablet', TABLET],
          ] as const) {
            await page.setViewportSize(viewport);
            await openMembers(page);
            await expect(sheet(page).getByText(username)).toBeVisible();
            await shoot(page, testInfo, `corner-${engine}-${size}-${scheme}-open`);
            // The sheet's lower start corner, close up.
            const panel = (await sheet(page).boundingBox())!;
            await shoot(page, testInfo, `corner-${engine}-${size}-${scheme}-zoom`, {
              x: panel.x - 40,
              y: panel.y + panel.height - 80,
              width: 160,
              height: 80,
            });
            await page.keyboard.press('Escape');
            await expectSheetAway(page, 'Escape puts the sheet away');
          }
          /* eslint-enable no-await-in-loop */
        }

        // The page card's corner, where the page floats beside the rail.
        const card = await pageCardRadius(page);

        for (const viewport of [PHONE.viewport, TABLET]) {
          /* eslint-disable no-await-in-loop -- one size after the other on one page. */
          await page.setViewportSize(viewport);
          await openMembers(page);
          // Only the corner over the page is round: the top one meets the bar, the others the
          // screen's edge. What the sheet holds is clipped to it.
          expect(await sheet(page).evaluate(cornersOf)).toEqual([0, 0, 0, card]);
          expect(await sheet(page).evaluate((panel) => getComputedStyle(panel).overflow)).toMatch(
            /^(clip|hidden)$/
          );
          await page.keyboard.press('Escape');
          await expectSheetAway(page, 'Escape puts the sheet away');
          /* eslint-enable no-await-in-loop */
        }

        // Right to left, the sheet comes from the left edge and rounds its bottom-right corner.
        await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
        await openMembers(page);
        expect(await sheet(page).evaluate(cornersOf)).toEqual([0, 0, card, 0]);
      } finally {
        await context.close();
      }
    } finally {
      if (own !== browser) await own.close();
    }
  });
}
