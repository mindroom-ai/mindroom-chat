import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { standInVisualViewport } from '../helpers/keyboardViewport';
import { touch } from '../helpers/touch';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A phone's on-screen keyboard and the composer. A reader who read back a little with a finger and
// returned to the newest message, then taps the composer, still sees that message right above it
// once the keyboard is up, with no Jump to Latest:
// both when the browser keeps the page full height and shrinks only the visual viewport (Safari on
// iOS, played here by a stand-in visualViewport) and when it shrinks the page itself (the iOS
// app's web view, Chrome on Android). Tapping Send keeps the text box focused, so the keyboard
// stays up for the next message, also when the send opens a thread from the Compact cards. Checked
// in a room with an address and 40 messages among 25 rooms, on a phone (390 by 844, touch), in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'phone-keyboard-spec-password';
const RUN = Date.now().toString(36);

const PHONE_SIZE = { width: 390, height: 844 };
const PHONE: BrowserContextOptions = { viewport: PHONE_SIZE, hasTouch: true, isMobile: true };
// WebKit plays Safari on an iPhone, so the timeline takes its iOS paths there.
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1';
// The visible height an iPhone's keyboard leaves in portrait.
const KEYBOARD_VISIBLE = 508;
const LANDSCAPE_SIZE = { width: 844, height: 390 };
// What Safari's keyboard leaves of an iPhone held sideways, its toolbars collapsed.
const LANDSCAPE_KEYBOARD_VISIBLE = 98;
// The home indicator's inset at the bottom of an iPhone without a browser toolbar (the iOS app).
const HOME_INDICATOR = 34;
const ROOM = 'Release checklist';
const TOPICS = [
  'the load test',
  'the security review',
  'the API reference',
  'the migration guide',
  'the billing page',
  'the status page',
  'the onboarding emails',
  'the mobile release notes',
];

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

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `pkb_${name}_${RUN}`;
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
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

const message = (index: number) =>
  `Update ${index}: ${TOPICS[index % TOPICS.length]} is ${
    index % 3 === 0
      ? 'done, and the notes are in the shared folder for anyone who wants the details'
      : 'still open; I will post again once the last two items are checked'
  }.`;

/**
 * 25 other rooms, and one room with 40 messages, more than a phone shows at once. The room has an
 * address, as a space's lobby does, so the app's links to it name its alias.
 */
const seed = async (name: string) => {
  const reader = await registerAndLogin(name);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Team room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM,
    alias: `release-checklist-${reader.username}`,
  });
  for (let index = 1; index <= 40; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: message(index),
    });
  }
  return { reader, roomId };
};

type World = Awaited<ReturnType<typeof seed>>;

const textBox = (page: Page) => page.locator('[data-editable-name="RoomInput"]');
const jumpToLatest = (page: Page) => page.getByRole('button', { name: 'Jump to Latest' });
const newestRow = (page: Page) => page.getByText(message(40), { exact: true });

const openRoom = async (page: Page, world: World) => {
  await page.evaluate((to) => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}`);
  await expect(newestRow(page)).toBeVisible({ timeout: 60_000 });
  await expect(jumpToLatest(page)).toBeHidden({ timeout: 15_000 });
};

/** The composer's rounded box around the text box and its buttons. */
const composerBox = (page: Page) =>
  textBox(page).evaluate((editable) => {
    let box = editable.parentElement;
    while (box) {
      const style = getComputedStyle(box);
      if (style.overflow === 'hidden' && style.borderTopLeftRadius !== '0px') break;
      box = box.parentElement;
    }
    const rect = box?.getBoundingClientRect();
    return { top: rect?.top ?? NaN, bottom: rect?.bottom ?? NaN, height: rect?.height ?? NaN };
  });

/** Where the newest message is, and the band the reader sees above the composer. */
const readBottom = async (page: Page) => {
  const row = await newestRow(page).boundingBox();
  const composer = await composerBox(page);
  const root = await page.locator('#root').boundingBox();
  return {
    rowTop: row?.y ?? NaN,
    rowBottom: row ? row.y + row.height : NaN,
    composerTop: composer.top,
    visibleTop: root?.y ?? NaN,
    visibleBottom: root ? root.y + root.height : NaN,
  };
};

/** The newest message shows in full between the top of the screen and the composer. */
const expectNewestAboveComposer = async (page: Page, label: string) => {
  // The scrolled-away state settles half a second after the view moves.
  await page.waitForTimeout(1_500);
  const bottom = await readBottom(page);
  console.log(`${label}: ${JSON.stringify(bottom)}`);
  expect(
    bottom.rowBottom,
    `${label}: the newest message ends above the composer`
  ).toBeLessThanOrEqual(bottom.composerTop + 1);
  expect(bottom.rowTop, `${label}: the newest message is on screen`).toBeGreaterThanOrEqual(
    bottom.visibleTop
  );
  expect(bottom.composerTop, `${label}: the composer is above the keyboard`).toBeLessThan(
    bottom.visibleBottom
  );
  await expect(jumpToLatest(page), `${label}: no Jump to Latest`).toBeHidden();
};

/**
 * The reader drags the conversation back a little and returns to the newest message: from then on
 * the position is theirs, and only the timeline's own pins keep them at the bottom.
 */
const readBackAndReturn = async (page: Page) => {
  await touch(newestRow(page), [
    { type: 'start' },
    { type: 'move', dx: 0, dy: 30 },
    { type: 'scroll', by: -300 },
    { type: 'wait', ms: 150 },
    { type: 'move', dx: 0, dy: 0 },
    { type: 'scroll', by: 600 },
    { type: 'end' },
  ]);
  await page.waitForTimeout(1_000);
  await expect(jumpToLatest(page)).toBeHidden();
};

/** Safari: the page keeps its height, the visual viewport shrinks, then pans to the text box. */
const checkSafariKeyboard = async (page: Page, world: World, engine: string) => {
  await openRoom(page, world);
  await readBackAndReturn(page);
  await textBox(page).tap();
  await expect(textBox(page)).toBeFocused();
  await page.evaluate((visible) => {
    window.__setKeyboardViewport?.(visible, 0, 'resize');
    window.__setKeyboardViewport?.(visible, window.innerHeight - visible, 'scroll');
  }, KEYBOARD_VISIBLE);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
    )
    .toBe(`${KEYBOARD_VISIBLE}px`);
  await expectNewestAboveComposer(page, `${engine} Safari keyboard`);
};

/** The iOS app and Chrome on Android: the page itself gets shorter. */
const checkResizingKeyboard = async (page: Page, world: World, engine: string) => {
  await openRoom(page, world);
  await readBackAndReturn(page);
  await textBox(page).tap();
  await expect(textBox(page)).toBeFocused();
  await page.setViewportSize({ width: PHONE_SIZE.width, height: KEYBOARD_VISIBLE });
  await expectNewestAboveComposer(page, `${engine} resizing keyboard`);
};

/** Send keeps the focus in the text box, so the keyboard stays up for the next message. */
const checkSendKeepsFocus = async (page: Page, world: World, engine: string) => {
  await openRoom(page, world);
  await textBox(page).tap();
  const text = `Second pass on ${engine} looks good`;
  await page.keyboard.type(text);
  await page.getByRole('button', { name: 'Send message' }).tap();
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(textBox(page)).not.toContainText(text);
  await expect(textBox(page), `${engine}: the text box keeps the focus after Send`).toBeFocused();
};

/**
 * In the Compact view a message sent from the composer opens its own thread, at the room's
 * address. The text box had the focus (the keyboard was up), and the opened thread's composer
 * keeps it, so the keyboard stays up for the reply.
 */
const checkCompactSendKeepsFocus = async (page: Page, world: World, engine: string) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.evaluate((to) => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}`);
  await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 60_000 });
  await textBox(page).tap();
  await expect(textBox(page)).toBeFocused();
  const text = `A new thread from the ${engine} cards`;
  await page.keyboard.type(text);
  await page.getByRole('button', { name: 'Send message' }).tap();
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  // Until the server confirms the root, the thread has its local ID; then the address takes the
  // confirmed one.
  await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toMatch(/^\$/);
  await expect(textBox(page)).not.toContainText(text);
  await expect(
    textBox(page),
    `${engine}: the opened thread's text box keeps the focus`
  ).toBeFocused();
};

const appHeight = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'));

/** Safari's visual viewport: its height and pan, and its width when it lags the layout's. */
const setVisualViewport = (page: Page, height: number, offsetTop: number, width?: number) =>
  page.evaluate(
    ([nextHeight, nextOffsetTop, nextWidth]) =>
      window.__setKeyboardViewport?.(nextHeight ?? 0, nextOffsetTop ?? 0, 'resize', nextWidth),
    [height, offsetTop, width] as const
  );

/** Whether anything covers the composer's box: the element at each sampled point is inside it. */
const composerUncovered = (page: Page) =>
  textBox(page).evaluate((editable) => {
    let box = editable.parentElement;
    while (box) {
      const style = getComputedStyle(box);
      if (style.overflow === 'hidden' && style.borderTopLeftRadius !== '0px') break;
      box = box.parentElement;
    }
    if (!box) return ['no composer box'];
    const rect = box.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    return [rect.top + 4, rect.top + rect.height / 2, rect.bottom - 4]
      .map((y) => ({ y, hit: document.elementFromPoint(x, y) }))
      .filter(({ hit }) => !hit || !box?.contains(hit))
      .map(
        ({ y, hit }) => `${Math.round(y)}: ${hit?.tagName ?? 'nothing'} ${hit?.className ?? ''}`
      );
  });

/** The bottom of the room's floating header (its top when it is not shown). */
const headerBottom = (page: Page) =>
  page.evaluate(() => {
    // The room area holds the floating header first, then the conversation, which ends in the
    // footer.
    const area = document.querySelector('[data-room-footer]')?.parentElement?.parentElement;
    const header = area?.firstElementChild?.getBoundingClientRect();
    return header ? header.top + header.height : NaN;
  });

/**
 * Sideways, the keyboard leaves a short band: the whole composer is in it, uncovered, and the
 * conversation shows above it, ending in the newest message.
 */
const checkLandscapeKeyboard = async (page: Page, world: World, engine: string) => {
  await openRoom(page, world);
  await page.setViewportSize(LANDSCAPE_SIZE);
  await expect(textBox(page)).toBeVisible();
  await textBox(page).tap();
  await expect(textBox(page)).toBeFocused();
  await setVisualViewport(page, LANDSCAPE_KEYBOARD_VISIBLE, 0);
  await expect.poll(() => appHeight(page)).toBe(`${LANDSCAPE_KEYBOARD_VISIBLE}px`);
  await page.waitForTimeout(1_000);
  const box = await composerBox(page);
  const header = await headerBottom(page);
  const row = await newestRow(page).boundingBox();
  const rowShown = row
    ? Math.min(row.y + row.height, box.top) - Math.max(row.y, Math.max(0, header))
    : 0;
  console.log(`${engine} landscape keyboard: ${JSON.stringify({ box, header, row, rowShown })}`);
  expect(box.top, `${engine}: the composer starts in the band`).toBeGreaterThanOrEqual(-1);
  expect(box.bottom, `${engine}: the composer ends above the keyboard`).toBeLessThanOrEqual(
    LANDSCAPE_KEYBOARD_VISIBLE + 1
  );
  expect(await composerUncovered(page), `${engine}: nothing covers the composer`).toEqual([]);
  // A line of the newest message at least.
  expect(rowShown, `${engine}: the newest message shows above the composer`).toBeGreaterThanOrEqual(
    16
  );
};

/**
 * Turned sideways and back with the keyboard up. Safari reports the upright layout before its
 * visual viewport, which keeps the sideways size for a while (or, on a loaded phone, until the
 * keyboard closes): the page is not cut to that sliver. Once the viewport catches up, the newest
 * message is right above the composer again.
 */
const checkRotationWithKeyboard = async (page: Page, world: World, engine: string) => {
  await openRoom(page, world);
  await readBackAndReturn(page);
  await textBox(page).tap();
  await expect(textBox(page)).toBeFocused();
  await setVisualViewport(page, KEYBOARD_VISIBLE, PHONE_SIZE.height - KEYBOARD_VISIBLE);
  await expect.poll(() => appHeight(page)).toBe(`${KEYBOARD_VISIBLE}px`);

  await page.setViewportSize(LANDSCAPE_SIZE);
  await setVisualViewport(page, LANDSCAPE_KEYBOARD_VISIBLE, 0, LANDSCAPE_SIZE.width);
  await expect.poll(() => appHeight(page)).toBe(`${LANDSCAPE_KEYBOARD_VISIBLE}px`);

  await page.setViewportSize(PHONE_SIZE);
  await page.waitForTimeout(1_500);
  const root = await page.locator('#root').boundingBox();
  console.log(`${engine} upright, viewport still sideways: ${JSON.stringify(root)}`);
  expect(root?.height, `${engine}: the page is not cut to the sideways viewport`).toBeGreaterThan(
    PHONE_SIZE.height - 2
  );
  await expect(newestRow(page)).toBeVisible();

  await setVisualViewport(
    page,
    KEYBOARD_VISIBLE,
    PHONE_SIZE.height - KEYBOARD_VISIBLE,
    PHONE_SIZE.width
  );
  await expect.poll(() => appHeight(page)).toBe(`${KEYBOARD_VISIBLE}px`);
  await expectNewestAboveComposer(page, `${engine} upright again`);
};

/**
 * Without a browser toolbar (the iOS app) the home indicator's inset sits under the footer, not
 * inside the composer's box: the box keeps its height and ends above the inset.
 */
const checkHomeIndicatorInset = async (page: Page, world: World) => {
  await openRoom(page, world);
  const before = await composerBox(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 0, left: 0, right: 0, bottom: HOME_INDICATOR },
  });
  // Either the box grows by the inset or it moves up by it.
  await expect
    .poll(async () => {
      const box = await composerBox(page);
      return Math.round(box.height - before.height + (before.bottom - box.bottom));
    })
    .toBeGreaterThanOrEqual(HOME_INDICATOR - 1);
  const after = await composerBox(page);
  console.log(`home indicator: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  expect(after.height, 'the composer box keeps its height').toBeLessThanOrEqual(before.height + 1);
  expect(after.bottom, 'the composer box ends above the inset').toBeLessThanOrEqual(
    before.bottom - HOME_INDICATOR + 1
  );
};

/** A page in a new phone context; Chromium on macOS now and then starts one without touch. */
const newPhonePage = async (browser: Browser, options: BrowserContextOptions) => {
  for (let attempt = 1; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext({ ...PHONE, ...options });
    // eslint-disable-next-line no-await-in-loop
    const page = await context.newPage();
    // eslint-disable-next-line no-await-in-loop
    if (await page.evaluate(() => matchMedia('(hover: none)').matches)) return { context, page };
    // eslint-disable-next-line no-await-in-loop
    await context.close();
  }
  const context = await browser.newContext({ ...PHONE, ...options });
  return { context, page: await context.newPage() };
};

type Check = (page: Page, world: World, engine: string) => Promise<void>;

let accounts = 0;

const run = async (browser: Browser, baseURL: string | undefined, engine: string, check: Check) => {
  accounts += 1;
  const world = await seed(`reader${accounts}_${engine}`);
  const { context, page } = await newPhonePage(browser, {
    baseURL,
    ...(engine === 'webkit' ? { userAgent: IPHONE_SAFARI } : {}),
  });
  try {
    await standInVisualViewport(context);
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await check(page, world, engine);
  } finally {
    await context.close();
  }
};

const CHECKS: [string, Check][] = [
  ['the newest message stays above the composer when Safari’s keyboard opens', checkSafariKeyboard],
  [
    'the newest message stays above the composer when the keyboard shrinks the page',
    checkResizingKeyboard,
  ],
  ['Send keeps the text box focused', checkSendKeepsFocus],
  ['the whole composer shows in the band a sideways keyboard leaves', checkLandscapeKeyboard],
  ['turning the phone with the keyboard up never leaves a blank page', checkRotationWithKeyboard],
  ['a send from the Compact cards keeps the keyboard up', checkCompactSendKeepsFocus],
];

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the home indicator inset stays outside the composer box (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await run(browser, baseURL, 'chromium', checkHomeIndicatorInset);
});

for (const [name, check] of CHECKS) {
  test(`${name} (Chromium)`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    await run(browser, baseURL, 'chromium', check);
  });

  test(`${name} (WebKit)`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    const browser = await launchWebKit();
    try {
      await run(browser, baseURL, 'webkit', check);
    } finally {
      await browser.close();
    }
  });
}
