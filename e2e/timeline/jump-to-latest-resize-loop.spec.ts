import { expect, test, webkit, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, sendRoomMessage, type MatrixSession } from '../helpers/matrix';

// Jump to Latest from the top of a room's history raises no "ResizeObserver loop completed with
// undelivered notifications." page error. Rows that settle after they mount (link previews that
// find nothing, long messages that fold) make virtual-core correct the scroll position in its
// ResizeObserver callback, and the timeline renders that correction before the paint, inside the
// browser's ResizeObserver loop. That render used to resize the timeline's scroll content as
// well, which its scrollbar, minimap and follow-growth observer watch, after the rows inside it
// had been reported, and WebKit reported the loop on every jump. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit on a desktop and a phone,
// against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'resize-loop-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const LOOP_ERROR = /ResizeObserver loop/;

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

type Account = MatrixSession & { username: string };

const register = async (name: string): Promise<Account> => {
  const username = `rol_${name}_${RUN}`;
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
      { timeout: 90_000 }
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
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'Jump to Latest from the top of the history raises no ResizeObserver loop error';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(DESKTOP);
  await jumpFromTheTop(page, 'c');
});

for (const phone of [false, true]) {
  test(`${TITLE} (WebKit, ${phone ? 'phone' : 'desktop'})`, async ({ baseURL }) => {
    test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(300_000);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    let browser: Browser | undefined;
    try {
      browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
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
