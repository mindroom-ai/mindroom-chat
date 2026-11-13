import { expect, test, type Browser, type Page } from '@playwright/test';
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

// Jump to Latest from the top of a room's history raises no "ResizeObserver loop completed with
// undelivered notifications." page error. Rows that settle after they mount (link previews that
// find nothing, long messages that fold) make virtual-core correct the scroll position in its
// ResizeObserver callback, and the timeline renders that correction before the paint, inside the
// browser's ResizeObserver loop. That render used to resize the timeline's scroll content as
// well, which its scrollbar, minimap and follow-growth observer watch, after the rows inside it
// had been reported, and WebKit reported the loop on every jump. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit on a desktop and a phone,
// against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'resize-loop-spec-password';
const RUN = Date.now().toString(36);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const LOOP_ERROR = /ResizeObserver loop/;

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

type Account = MatrixSession & { username: string };

// Accounts stay unique when a run repeats a test in the same worker.
let accounts = 0;
const register = async (name: string): Promise<Account> => {
  accounts += 1;
  const username = `rol_${name}_${RUN}_${accounts}`;
  return registerDisposableUser(username, PASSWORD);
};

const REPORT = 'The tide report lists water levels, wind and the berth plan for the day. ';

/** A room of 100 messages from two accounts: short notes, long reports and links. */
const seedRoom = async (name: string) => {
  const reader = await register(`${name}_reader`);
  const writer = await register(`${name}_writer`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Harbor log ${name} ${RUN}`,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  let newest = '';
  for (let index = 1; index <= 100; index += 1) {
    const who = index % 3 === 0 ? reader : writer;
    let body = `Entry ${index}: crane two loaded the containers for berth four.`;
    if (index % 5 === 0) body = `Entry ${index}: ${REPORT.repeat(4)}`;
    if (index % 9 === 0) body = `Entry ${index}: the berth plan is at https://example.org/berths/${index}`;
    if (index % 13 === 0) body = `Entry ${index}: full report.\n\n${REPORT.repeat(12)}`;
    // eslint-disable-next-line no-await-in-loop
    newest = await sendRoomMessage(HOMESERVER, who.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
  }
  return { reader, roomId, newest };
};

/** The timeline's scroll area. */
const scroller = (page: Page) =>
  page.evaluateHandle(() => {
    let element = document.querySelector<HTMLElement>(
      '[data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('Timeline scroller missing');
    return element;
  });

const jumpFromTheTop = async (page: Page, name: string) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { reader, roomId, newest } = await seedRoom(name);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.locator(`[data-message-id="${newest}"]`)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2_000);

  // Up to the start of the room, where its creation shows.
  await expect
    .poll(
      async () => {
        await (
          await scroller(page)
        ).evaluate((element) => {
          element.scrollTop = 0;
        });
        await page.waitForTimeout(400);
        return page.getByText('Entry 1:', { exact: false }).first().isVisible();
      },
      // Paging back through 100 messages takes a loaded phone WebKit more than a minute.
      { timeout: 150_000 }
    )
    .toBe(true);
  await page.waitForTimeout(1_000);

  const jump = page.getByRole('button', { name: 'Jump to Latest' });
  await expect(jump).toBeVisible();
  const before = errors.length;
  await jump.click();
  await expect(page.locator(`[data-message-id="${newest}"]`)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2_500);
  expect(errors.slice(before).filter((message) => LOOP_ERROR.test(message))).toEqual([]);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'Jump to Latest from the top of the history raises no ResizeObserver loop error';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(DESKTOP);
  await jumpFromTheTop(page, 'c');
});

for (const phone of [false, true]) {
  test(`${TITLE} (WebKit, ${phone ? 'phone' : 'desktop'})`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(300_000);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    let browser: Browser | undefined;
    try {
      browser = await launchWebKit();
      const context = await browser.newContext({
        viewport: phone ? PHONE : DESKTOP,
        hasTouch: phone,
        baseURL,
      });
      await jumpFromTheTop(await context.newPage(), phone ? 'wp' : 'wd');
    } finally {
      await browser?.close();
    }
  });
}
