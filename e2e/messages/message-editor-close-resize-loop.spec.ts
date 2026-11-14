import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Closing the message editor raises no "ResizeObserver loop completed with undelivered
// notifications." The edited row shrinks back to its message, virtual-core reports that from its
// ResizeObserver callback, and the ledger renders the moved rows in a microtask, inside the
// browser's ResizeObserver loop. That render also mounted the row the shorter row brought into
// the window, and virtual-core observed it there, at the depth of the row just reported: the
// browser skipped that observation and reported the loop. Arrow Up edits the reader's last message
// and Cancel closes the editor, three times, then the reader types in the composer, on a phone
// (390 by 844, touch) and a desktop (1280 by 800), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of a slot (scripts/e2e-slot.sh).
const PASSWORD = 'editor-close-resize-loop-spec-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Review Desk';
const FILLER_ROOMS = 24;
const HISTORY = 24;
const LAST = 'Please check the summary before it goes out.';
const ROUNDS = 3;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

type Account = MatrixSession & { username: string };

const registerAndLogin = (name: string): Promise<Account> =>
  registerDisposableUser(`rloop_${name}_${RUN}`, PASSWORD);

type World = { reader: Account; roomId: string };

/** 24 other rooms, and a room with 24 messages from two people, then the reader's last one. */
const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const member = await registerAndLogin(`member_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Review room ${index + 1}` })
    )
  );
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromMember = index % 2 === 0;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, (fromMember ? member : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromMember
        ? `Note ${index}: the review notes for this week are filed with the summaries.`
        : `Note ${index}: anything left to review before the weekly summary goes out?`,
    });
  }
  await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, { msgtype: 'm.text', body: LAST });
  return { reader, roomId };
};

/** The loop errors the page reported since it loaded. */
const loopErrors = (page: Page) =>
  page.evaluate(() => (window as unknown as { resizeLoops: string[] }).resizeLoops.slice());

const check = async (page: Page, world: World, label: string) => {
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    world.roomId
  );
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(LAST).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  // Opening the room is another spec's (room-open-resize-loop); this one starts from here.
  const opened = (await loopErrors(page)).length;
  const editor = page.locator('[data-editable-name="MessageEditor"]');
  for (let round = 1; round <= ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await composer.click();
    // eslint-disable-next-line no-await-in-loop
    await composer.press('ArrowUp');
    // eslint-disable-next-line no-await-in-loop
    await expect(editor).toBeVisible({ timeout: 15_000 });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    // eslint-disable-next-line no-await-in-loop
    await expect(editor).toHaveCount(0);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }
  await composer.click();
  await composer.pressSequentially('Draft for later');
  await page.waitForTimeout(500);
  expect(
    (await loopErrors(page)).slice(opened),
    `ResizeObserver loop errors in ${label} after the editor closed`
  ).toEqual([]);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext({ ...options, baseURL });
    try {
      // Chromium reports the loop only to the page's error listeners, WebKit as a page error too.
      // eslint-disable-next-line no-await-in-loop
      await context.addInitScript(() => {
        const resizeLoops: string[] = [];
        Object.assign(window, { resizeLoops });
        window.addEventListener('error', (event) => {
          if (/ResizeObserver loop/.test(event.message)) resizeLoops.push(event.message);
        });
      });
      // eslint-disable-next-line no-await-in-loop
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        if (!/ResizeObserver loop/.test(error.message)) pageErrors.push(error.message);
      });
      // eslint-disable-next-line no-await-in-loop
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      // eslint-disable-next-line no-await-in-loop
      await check(page, world, `${engine} ${viewport}`);
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'closing the message editor raises no ResizeObserver loop error';

test(`${TITLE} (Chromium)`, async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
