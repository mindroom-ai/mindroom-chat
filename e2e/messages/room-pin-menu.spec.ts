import {
  expect,
  test,
  webkit,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, sendRoomMessage, sendStateEvent } from '../helpers/matrix';

// The room header's Pinned Messages button opens the pin menu, a dialog named Pinned Messages (the
// button announces a dialog): the room's pinned messages, the newest pin first, each rendered as a
// message, with a Close button; Escape and Close dismiss it. The menu stays inside the window and
// does not scroll sideways, on a desktop (1280 by 800) and a phone (390 by 844, touch), in light
// and dark, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit. The account has 25 rooms; the pinned one holds messages of realistic length, one long
// enough to wrap over several lines.
// Set ROOM_PIN_MENU_SHOTS=<directory> to save each open menu.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'room-pin-menu-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.ROOM_PIN_MENU_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const ROOM_NAME = 'Harbor operations';
const UNPINNED = 'Morning all, the crane inspection moved to Thursday at nine.';
const MESSAGES: { body: string; pinned: boolean }[] = [
  { body: UNPINNED, pinned: false },
  {
    body:
      'Reminder: berth four is closed for dredging until the end of the month, so the two container ' +
      'ships due on Tuesday go to berth six instead. The pilots have the new schedule, and the ' +
      'tug crews got it this morning. If anything in the plan clashes with your shifts, reply in ' +
      'this room before Friday so we can sort it out with the night team as well.',
    pinned: true,
  },
  { body: 'Who has the keys to the east gate this week?', pinned: false },
  {
    body: 'Safety briefing slides are in the shared folder under "Quarter three".',
    pinned: true,
  },
  { body: 'The fuel delivery is confirmed for Wednesday afternoon.', pinned: true },
];
/** The pinned messages as the menu lists them: the newest pin first. */
const PINNED_NEWEST_FIRST = MESSAGES.filter((message) => message.pinned)
  .map((message) => message.body)
  .reverse();

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

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

/** A new account with 24 other rooms and one room whose messages are partly pinned. */
const seed = async (name: string) => {
  const username = `rpm_${name}_${RUN}`;
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
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      createRoom(HOMESERVER, session.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, session.accessToken, { name: ROOM_NAME });
  const pinned: string[] = [];
  for (const { body, pinned: pin } of MESSAGES) {
    // eslint-disable-next-line no-await-in-loop
    const eventId = await sendRoomMessage(HOMESERVER, session.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    if (pin) pinned.push(eventId);
  }
  // Pinned in the order the messages were sent, so the last one is the newest pin.
  await sendStateEvent(HOMESERVER, session.accessToken, roomId, 'm.room.pinned_events', '', {
    pinned,
  });
  return { username, roomId };
};

type MenuBox = { left: number; right: number; top: number; bottom: number; sideways: boolean };

/** The pin menu, found the way assistive technology finds it: the dialog its button announces. */
const pinMenu = (page: Page) => page.getByRole('dialog', { name: 'Pinned Messages', exact: true });

const measureMenu = (page: Page) =>
  pinMenu(page).evaluate((menu): MenuBox => {
    const box = menu.getBoundingClientRect();
    const sideways = [menu, ...menu.querySelectorAll('*')].some(
      (element) =>
        getComputedStyle(element).overflowX !== 'visible' &&
        element.scrollWidth > element.clientWidth + 1
    );
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, sideways };
  });

const checkPinMenu = async (page: Page, engine: string, form: string, testInfo: TestInfo) => {
  const { username, roomId } = await seed(`${engine}_${form}`);
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const pinButton = page.getByRole('button', { name: 'Pinned Messages', exact: true });
  await expect(pinButton).toBeVisible({ timeout: 60_000 });

  for (const scheme of ['light', 'dark'] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await pinButton.click();
    const menu = pinMenu(page);
    // eslint-disable-next-line no-await-in-loop
    await expect(menu.getByText('Pinned Messages', { exact: true })).toBeVisible();
    const expected = PINNED_NEWEST_FIRST;
    for (const body of expected) {
      // eslint-disable-next-line no-await-in-loop
      await expect(menu.getByText(body, { exact: true })).toBeVisible();
    }
    // eslint-disable-next-line no-await-in-loop
    const order = await menu.evaluate(
      (element, bodies) => bodies.map((body) => (element.textContent ?? '').indexOf(body)),
      expected
    );
    expect(order, 'newest pin first').toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position >= 0)).toBe(true);
    await expect(menu.getByText(UNPINNED, { exact: true })).toHaveCount(0);
    await expect(pinButton).toHaveAttribute('aria-expanded', 'true');

    // eslint-disable-next-line no-await-in-loop
    const box = await measureMenu(page);
    // eslint-disable-next-line no-await-in-loop
    const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const where = `${engine}, ${form}, ${scheme}`;
    expect.soft(box.left, `menu starts inside the window (${where})`).toBeGreaterThanOrEqual(0);
    expect
      .soft(box.right, `menu ends inside the window (${where})`)
      .toBeLessThanOrEqual(view.width);
    expect
      .soft(box.bottom, `menu bottom inside the window (${where})`)
      .toBeLessThanOrEqual(view.height);
    expect.soft(box.sideways, `nothing in the menu scrolls sideways (${where})`).toBe(false);
    if (SHOTS) {
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: `${SHOTS}/room-pin-menu-${engine}-${form}-${scheme}.png` });
    }
    // eslint-disable-next-line no-await-in-loop
    await testInfo.attach(`pin-menu-${engine}-${form}-${scheme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    if (scheme === 'light') {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Escape');
    } else {
      // eslint-disable-next-line no-await-in-loop
      await menu.getByRole('button', { name: 'Close', exact: true }).click();
    }
    // eslint-disable-next-line no-await-in-loop
    await expect(menu).toHaveCount(0);
    // eslint-disable-next-line no-await-in-loop
    await expect(pinButton).toHaveAttribute('aria-expanded', 'false');
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);

    test(`the pin menu lists the pinned messages, newest first, and closes (Chromium, ${form})`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await checkPinMenu(page, 'chromium', form, testInfo);
    });

    test(`the pin menu lists the pinned messages, newest first, and closes (WebKit, ${form})`, async ({
      baseURL,
    }, testInfo) => {
      test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(240_000);
      // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
      const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
      try {
        const context = await browser.newContext({ ...options, baseURL });
        await checkPinMenu(await context.newPage(), 'webkit', form, testInfo);
      } finally {
        await browser.close();
      }
    });
  });
}
