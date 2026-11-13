import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A message the reader sends is read: the "New Messages" line never stands above it. The reader
// sends from the composer at the bottom of a read room, scrolls up, and another account writes;
// back at the bottom the line stands above that account's message, not above the reader's own.
// Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit,
// against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'unread-own-spec-password';
const RUN = Date.now().toString(36);
const HISTORY = 60;
const VIEWPORT = { width: 1280, height: 800 };

test.use({
  viewport: VIEWPORT,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = (name: string) => registerDisposableUser(`uno_${name}_${RUN}`, PASSWORD);

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

/** How far the timeline's scroll area is above its bottom, in px. */
const scrollGap = async (page: Page) =>
  (await scroller(page)).evaluate((element) =>
    Math.round(element.scrollHeight - element.clientHeight - element.scrollTop)
  );

/** Scrolls the timeline by `deltaY` at a time until `until(gap)` holds. */
const scrollUntil = async (page: Page, deltaY: number, until: (gap: number) => boolean) => {
  await expect
    .poll(
      async () => {
        const gap = await scrollGap(page);
        if (!until(gap)) {
          await (await scroller(page)).evaluate((element, delta) => {
            element.scrollBy(0, delta);
          }, deltaY);
          await page.waitForTimeout(200);
        }
        return until(gap);
      },
      { timeout: 30_000 }
    )
    .toBe(true);
};

/** The text of the rows the "New Messages" lines stand above. */
const unreadLineRows = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="separator"]'))
      .filter((separator) => separator.textContent?.includes('New Messages'))
      .map(
        (separator) =>
          separator.parentElement?.querySelector<HTMLElement>('[data-message-id]')?.textContent ??
          '?'
      )
  );

const ownMessageIsRead = async (page: Page, name: string) => {
  const reader = await register(`${name}_reader`);
  const writer = await register(`${name}_writer`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Pier notes ${name} ${RUN}`,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  let newest = '';
  for (let index = 1; index <= HISTORY; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    newest = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: [
        `Pier note ${index}: the ferry left on time and the gangway is clear.`,
        'The harbor master signed the log for the morning watch.',
        'Nothing else to report.',
      ].join('\n'),
    });
  }
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(newest)}`,
    { method: 'POST', accessToken: reader.accessToken, body: JSON.stringify({}) }
  );

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
  await expect.poll(() => scrollGap(page), { timeout: 20_000 }).toBeLessThanOrEqual(2);

  // The reader writes at the bottom, as in any conversation.
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await composer.click();
  await page.keyboard.type('My own note: the gangway is mine to check tonight.');
  await page.keyboard.press('Enter');
  const own = page.locator('[data-message-id^="$"]', { hasText: 'My own note' });
  await expect(own).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2_000);

  // Away from the bottom, another account writes.
  await scrollUntil(page, -600, (gap) => gap > 1_500);
  await page.waitForTimeout(1_000);
  await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Missed note: the night ferry is cancelled.',
  });
  await expect(page.getByRole('button', { name: 'Jump to Unread' })).toBeVisible({
    timeout: 30_000,
  });

  await scrollUntil(page, 1_200, (gap) => gap <= 2);
  await expect(page.locator('[data-message-id]', { hasText: 'Missed note' })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);
  const lines = await unreadLineRows(page);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('Missed note');
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'the New Messages line never stands above a message the reader sent';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(240_000);
  await ownMessageIsRead(page, 'c');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL });
    await ownMessageIsRead(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
