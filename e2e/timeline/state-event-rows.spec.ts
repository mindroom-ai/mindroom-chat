import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// The rows for a new room name, topic or avatar carry an icon like the membership rows, so all
// their lines start in one column. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit, against the disposable homeserver of `just hs-up` or of a slot
// of scripts/e2e-slot.sh.
const PASSWORD = 'state-rows-spec-password';
const RUN = Date.now().toString(36);
const VIEWPORT = { width: 1280, height: 800 };
const SHOTS = process.env.STATE_ROWS_SHOTS;

test.use({
  viewport: VIEWPORT,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = (name: string) => registerDisposableUser(`ser_${name}_${RUN}`, PASSWORD);

const linesShareAColumn = async (page: Page, name: string) => {
  const reader = await register(name);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Ferry log ${name} ${RUN}`,
  });
  await sendStateEvent(HOMESERVER, reader.accessToken, roomId, 'm.room.topic', '', {
    topic: 'Departures and arrivals of the harbor ferry',
  });
  const newest = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The morning ferry left on time.',
  });
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

  const rows = {
    joined: page.locator('[data-message-id]', { hasText: 'joined the room' }).first(),
    name: page.locator('[data-message-id]', { hasText: 'changed the room name' }).first(),
    topic: page.locator('[data-message-id]', { hasText: 'changed the topic' }).first(),
  };
  await expect(rows.name).toBeVisible({ timeout: 30_000 });
  await expect(rows.topic).toBeVisible();
  await expect(rows.joined).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/state-rows-${name}.png` });
  // Where each row's sender name starts.
  const start = (row: typeof rows.joined) =>
    row.locator('b').first().evaluate((element) => element.getBoundingClientRect().left);
  const joined = await start(rows.joined);
  expect(await start(rows.name), 'room name row').toBeCloseTo(joined, 0);
  expect(await start(rows.topic), 'room topic row').toBeCloseTo(joined, 0);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'room name and topic rows line up with the membership rows';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await linesShareAColumn(page, 'c');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL });
    await linesShareAColumn(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
